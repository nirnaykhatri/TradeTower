import { DCAFuturesStrategy } from './DCAFuturesStrategy';
import { ComboConfig } from '../types/strategyConfig';
import { TradeOrder } from '@trading-tower/shared';
import { PRICE_TOLERANCE } from '../constants/strategy.constants';

/**
 * Combo Bot Strategy (DCA Entry + Grid Exit)
 * 
 * Extends DCA Futures to use Martingale/Safety Orders for entry (averaging down),
 * but uses a Grid of Limit Orders for profit taking (distributing exit).
 * 
 * This strategy accumulates position using DCA methodology with progressively
 * larger buy orders (safety orders) as price decreases, then exits through
 * a calculated grid of limit sell orders for systematic profit taking.
 * 
 * Key Features:
 * - DCA-based entry with safety orders
 * - Grid-based exit with multiple profit levels
 * - Automatic grid recalculation on each entry
 * - Proper cleanup on exit events
 */
export class ComboStrategy extends DCAFuturesStrategy {
    private profitGridOrders: Map<string, TradeOrder> = new Map();

    /**
     * Get active orders currently managed by this strategy
     * @returns Map of active orders indexed by order ID
     */
    getActiveOrders(): Map<string, TradeOrder> {
        const combined = new Map<string, TradeOrder>(super.getActiveOrders());
        for (const [id, order] of this.profitGridOrders) {
            combined.set(id, order);
        }
        return combined;
    }

    protected get comboConfig(): ComboConfig {
        return this.config as unknown as ComboConfig;
    }

    /**
     * Handle order filled event with profit grid management.
     * When we buy (Base or Safety), we update the Sell Grid.
     * When we sell (Grid Hit), we record profit.
     * 
     * @param order The filled TradeOrder
     * @returns Promise<void>
     */
    async onOrderFilled(order: TradeOrder): Promise<void> {
        // 1. Let DCA strategy handle the entry side (updating avgPrice, safety orders count)
        // We only call super if it's a BUY (DCA entry) or if it handles logic we need.
        // But DCAFutures.onOrderFilled might trigger 'executeExit' if TP is hit.
        // We should ensure standard TP is disabled in config.

        await super.onOrderFilled(order);

        // 2. If it was a DCA Buy (Base or Safety), we need to restructure the Profit Grid
        const isEntry = (this.comboConfig.strategy === 'LONG' && order.side === 'buy') ||
            (this.comboConfig.strategy === 'SHORT' && order.side === 'sell');

        if (isEntry) {
            console.log(`[Combo] Entry filled. Re-calculating Profit Grid.`);
            await this.placeProfitGrid();
        } else {
            // It was a Sell (Profit Grid hit)
            // Record manual profit (DCA strategy might not track this correctly if it wasn't a full exit)
            // But super.onOrderFilled handles "Partial Sells" nicely IF we treat them as trades.
            // We just need to remove it from our map.
            if (this.profitGridOrders.has(order.id)) {
                this.profitGridOrders.delete(order.id);
                console.log(`[Combo] Grid Profit Level Hit!`);
            }
        }
    }

    /**
     * Places a grid of Limit Close orders above the current Average Entry.
     * Cancels existing grid orders and places new ones based on position size.
     * 
     * @returns Promise<void>
     */
    private async placeProfitGrid(): Promise<void> {
        try {
            // 1. Cancel existing grid
            for (const id of this.profitGridOrders.keys()) {
                try {
                    await this.cancelOrderWithRetry(id, this.bot.pair);
                } catch (e) {
                    // Ignore if already filled/gone
                }
            }
            this.profitGridOrders.clear();

            const totalPos = this.totalAmountFilled; // From BaseDCAStrategy
            if (totalPos <= 0) return;

            const { gridLevels, gridStep, strategy } = this.comboConfig;

            // Amount per grid level (simple distribution)
            const amountPerLevel = totalPos / gridLevels;

            // Distance calculation
            const startPrice = this.avgEntryPrice;
            const factor = strategy === 'LONG' ? 1 : -1;

            for (let i = 1; i <= gridLevels; i++) {
                const priceReq = startPrice * (1 + (gridStep * i / 100) * factor);
                const side = strategy === 'LONG' ? 'sell' : 'buy';

                try {
                    const order = await this.executeOrderWithRetry({
                        userId: this.bot.userId,
                        botId: this.bot.id,
                        pair: this.bot.pair,
                        side,
                        type: 'limit',
                        price: priceReq,
                        amount: amountPerLevel
                    });
                    this.profitGridOrders.set(order.id, order);
                } catch (e) {
                    console.error(`[Combo] Failed to place profit grid level ${i}:`, e);
                }
            }
        } catch (error) {
            await this.handleStrategyError(error as Error, 'placeProfitGrid');
        }
    }

    /**
     * Override executeExit to ensure we protect our Grid state if panic sell happens.
     * Clears profit grid orders on exit.
     * 
     * @param reason Reason for exit
     * @returns Promise<void>
     */
    protected async executeExit(reason: string): Promise<void> {
        // If standard DCA wants to exit (e.g. Stop Loss), we let it.
        // It calls cancelAllActiveOrders.
        await super.executeExit(reason);
        this.profitGridOrders.clear();
    }
}

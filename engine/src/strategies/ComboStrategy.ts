import { DCAFuturesStrategy } from './DCAFuturesStrategy';
import { ComboConfig } from '../types/strategyConfig';
import { TradeOrder } from '@trading-tower/shared';

/**
 * Combo Bot (DCA Entry + Grid Exit)
 * Extends DCA Futures to use Martingale/Safety Orders for entry (averaging down),
 * but uses a Grid of Limit Orders for profit taking (distributing exit).
 */
export class ComboStrategy extends DCAFuturesStrategy {
    private profitGridOrders: Map<string, TradeOrder> = new Map();

    protected get comboConfig(): ComboConfig {
        return this.config as unknown as ComboConfig;
    }

    /**
     * Override onOrderFilled to manage the Profit Grid.
     * When we buy (Base or Safety), we update the Sell Grid.
     * When we sell (Grid Hit), we record profit and potentially replenish?
     * Bitsgap Combo usually just exits. But if it's "Grid", maybe it scalps?
     * For now, standard Combo is: Accumulate via DCA, Sell off via Grid.
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
     */
    private async placeProfitGrid() {
        // 1. Cancel existing grid
        for (const [id, order] of this.profitGridOrders) {
            try {
                await this.exchange.cancelOrder(id, this.bot.pair);
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
                const order = await this.exchange.createOrder({
                    userId: this.bot.userId,
                    botId: this.bot.id,
                    pair: this.bot.pair,
                    side,
                    type: 'limit',
                    price: priceReq,
                    amount: amountPerLevel,
                    reduceOnly: true // Important for Futures Exit
                });
                this.profitGridOrders.set(order.id, order);
            } catch (e) {
                console.error(`[Combo] Failed to place profit grid level ${i}:`, e);
            }
        }
    }

    /**
     * Override executeExit to ensure we protect our Grid state if panic sell happens
     */
    protected async executeExit(reason: string) {
        // If standard DCA wants to exit (e.g. Stop Loss), we let it.
        // It calls cancelAllActiveOrders.
        await super.executeExit(reason);
        this.profitGridOrders.clear();
    }
}

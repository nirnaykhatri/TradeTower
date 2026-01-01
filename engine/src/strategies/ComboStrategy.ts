import { BTDStrategy } from './BTDStrategy';
import { ComboConfig } from '../types/strategyConfig';
import { TradeOrder } from '@trading-tower/shared';

/**
 * Combo Bot (Grid + DCA Hybrid)
 * Extends BTD with advanced position management and dynamic rebalancing.
 */
export class ComboStrategy extends BTDStrategy {
    private currentPositionAmount: number = 0;

    protected get comboConfig(): ComboConfig {
        return this.config as ComboConfig;
    }

    async onOrderFilled(order: TradeOrder): Promise<void> {
        // Track position size
        if (order.side === 'buy') {
            this.currentPositionAmount += order.amount;
        } else {
            this.currentPositionAmount -= (order.filledAmount || order.amount);
        }

        // 1. Position Size Limit Check
        // If we reached the limit, we skip placing a new sell (if that's desired) or just stop buying.
        // Usually, limit affects new Buys.

        // --- Standard BTD logic for grid flipping ---
        // If it's a Buy, it places a Sell. If it's a Sell, it places a Buy.
        // We override this to respect position limits.

        const gridIndex = this.gridLevels.findIndex(p => Math.abs(p - order.price) / p < 0.001);
        if (gridIndex === -1) {
            await this.recordTrade(order);
            return;
        }

        if (order.side === 'buy') {
            await this.recordTrade(order);
            // Filled a dip buy, place sell at next level up
            if (gridIndex + 1 < this.gridLevels.length) {
                const sellPrice = this.gridLevels[gridIndex + 1];
                await this.placeGridOrder('sell', sellPrice, Math.abs(order.amount));
            }
        } else {
            await this.recordTrade(order);
            // Filled a sell, check if we can place buy back at level below
            if (gridIndex - 1 >= 0) {
                const buyPrice = this.gridLevels[gridIndex - 1];
                const investmentPerLevel = this.config.investment / this.config.gridLevels;
                const buyAmount = investmentPerLevel / buyPrice;

                // Respect Position Size Limit
                if (!this.comboConfig.positionSizeLimit || (this.currentPositionAmount + buyAmount <= this.comboConfig.positionSizeLimit)) {
                    await this.placeGridOrder('buy', buyPrice, buyAmount);
                } else {
                    console.log(`[ComboBot] Position size limit ${this.comboConfig.positionSizeLimit} reached. Skipping buy back at ${buyPrice}.`);
                }
            }
        }
    }

    protected async placeGridOrder(side: 'buy' | 'sell', price: number, amount: number) {
        try {
            const order = await this.exchange.createOrder({
                userId: this.bot.userId,
                botId: this.bot.id,
                pair: this.bot.pair,
                side,
                type: 'limit',
                price,
                amount
            });
            this.activeOrders.set(order.id, order);
        } catch (e) {
            console.error(`[ComboBot] Failed to place ${side} at ${price}:`, e);
        }
    }

    async onPriceUpdate(price: number): Promise<void> {
        await super.onPriceUpdate(price);

        // --- Dynamic Rebalancing ---
        // If the price moves too far from the center of the grid, 
        // and rebalancing is enabled, we shift the grid.
        if (this.comboConfig.dynamicRebalancing) {
            const gridCenter = (this.currentLowPrice + this.currentHighPrice) / 2;
            const deviation = Math.abs(price - gridCenter) / gridCenter;

            // If price deviates more than 20% of range, rebalance
            const range = this.currentHighPrice - this.currentLowPrice;
            if (deviation > 0.2) {
                console.log(`[ComboBot] Dynamic Rebalancing: Price ${price} deviated from center. Re-centering grid.`);
                await this.rebalanceGrid(price);
            }
        }
    }

    private async rebalanceGrid(newCenter: number) {
        // Cancel all existing grid orders
        for (const orderId of this.activeOrders.keys()) {
            await this.exchange.cancelOrder(orderId, this.bot.pair).catch(() => { });
        }
        this.activeOrders.clear();

        // Recalculate range around new center
        const halfRange = (this.currentHighPrice - this.currentLowPrice) / 2;
        this.currentLowPrice = newCenter - halfRange;
        this.currentHighPrice = newCenter + halfRange;

        // Recalculate grid levels
        await this.calculateAsymmetricGrid();

        // Place new orders relative to current price
        const ticker = await this.exchange.getTicker(this.bot.pair);
        await this.placeGridOrders(ticker.lastPrice);
    }
}

import { BaseStrategy } from './BaseStrategy';
import { BTDConfig } from '../types/strategyConfig';
import { TradeOrder } from '@trading-tower/shared';
import { PRICE_TOLERANCE } from '../constants/strategy.constants';

/**
 * Buy The Dip (BTD) Strategy
 * 
 * Grid-based strategy that places buy orders at support levels
 * and sells at resistance levels to "buy dips" and "sell rebounds".
 * 
 * Features:
 * - Asymmetric grid levels between low and high price
 * - Automatic trailing down to catch deeper dips
 * - Optional trailing up to capture uptrends
 * - Scalping profits on each dip-rebound cycle
 */
export class BTDStrategy extends BaseStrategy<BTDConfig> {
    /** All grid price levels sorted ascending */
    protected gridLevels: number[] = [];
    
    /** Active limit orders on exchange */
    protected activeOrders: Map<string, TradeOrder> = new Map();
    
    /** Current lowest price in grid range */
    protected currentLowPrice: number;
    
    /** Current highest price in grid range */
    protected currentHighPrice: number;
    
    /** Calculated step size between grid levels */
    protected gridStepValue: number = 0;

    constructor(bot: any, exchange: any, config: BTDConfig) {
        super(bot, exchange, config);
        this.currentLowPrice = config.lowPrice;
        this.currentHighPrice = config.highPrice;
    }

    /**
     * Initialize strategy
     * 
     * Calculates all grid price levels based on configured
     * low, high, and number of grid levels.
     */
    async initialize(): Promise<void> {
        await this.calculateAsymmetricGrid();
    }

    /**
     * Calculate asymmetric grid levels
     * 
     * Evenly distributes grid levels between currentLowPrice
     * and currentHighPrice.
     * 
     * @remarks
     * Grid step size is used for trailing logic.
     * If price moves beyond the grid range by one step,
     * the grid shifts in that direction.
     */
    protected async calculateAsymmetricGrid(): Promise<void> {
        const { gridLevels } = this.config;
        const range = this.currentHighPrice - this.currentLowPrice;
        this.gridStepValue = range / (gridLevels - 1);

        this.gridLevels = [];
        for (let i = 0; i < gridLevels; i++) {
            this.gridLevels.push(this.currentLowPrice + i * this.gridStepValue);
        }
        this.gridLevels.sort((a, b) => a - b);
    }

    /**
     * Start strategy execution
     * 
     * Places initial buy orders at all grid levels below current price.
     */
    async start(): Promise<void> {
        await this.updateBotStatus('running');
        const ticker = await this.exchange.getTicker(this.bot.pair);
        this.lastPrice = ticker.lastPrice;

        await this.placeGridOrders(ticker.lastPrice);
    }

    /**
     * Get all active orders
     * 
     * @returns Map of active orders indexed by order ID
     */
    protected getActiveOrders(): Map<string, TradeOrder> {
        return this.activeOrders;
    }

    /**
     * Place grid orders at levels below current price
     * 
     * For Buy The Dip, we only place buy orders below the current
     * price to catch downward price movement.
     * 
     * @param currentPrice Current market price
     */
    protected async placeGridOrders(currentPrice: number): Promise<void> {
        const investment = this.config.investment / this.config.gridLevels;

        for (const price of this.gridLevels) {
            // BTD only places BUY orders first
            if (price < currentPrice * (1 - PRICE_TOLERANCE)) {
                await this.placeOrder('buy', price, investment / price);
            }
        }
    }

    /**
     * Place a limit order at specified price
     * 
     * @param side Order side (buy or sell)
     * @param price Limit price
     * @param amount Order amount
     */
    protected async placeOrder(side: 'buy' | 'sell', price: number, amount: number): Promise<void> {
        if (this.isPaused) return;

        try {
            const order = await this.executeOrderWithRetry({
                userId: this.bot.userId,
                botId: this.bot.id,
                pair: this.bot.pair,
                side,
                type: 'limit',
                price,
                amount
            });
            this.activeOrders.set(order.id, order);
        } catch (error) {
            await this.handleStrategyError(error as Error, `placeOrder(${side} @ ${price})`);
        }
    }

    /**
     * Cancel all active orders
     */
    public async cancelAllActiveOrders(): Promise<void> {
        const orders = this.getActiveOrders();
        for (const [id, order] of orders) {
            await this.cancelOrderWithRetry(id, order.pair).catch((error) => {
                console.warn(`[BTD] Failed to cancel order ${id}:`, error?.message);
            });
        }
        this.activeOrders.clear();
    }

    /**
     * Handle real-time price updates
     * 
     * Monitors for trailing conditions:
     * - If price falls below grid range, trails down
     * - If price rises above grid range, trails up
     * 
     * @param price Current market price
     */
    async onPriceUpdate(price: number): Promise<void> {
        if (this.isPaused) return;
        this.lastPrice = price;

        // Trailing DOWN: Shifts the grid DOWN if price falls below the range
        // This is crucial for "Buy The Dip" to catch deeper dips
        if (this.config.trailing !== false && price < (this.currentLowPrice - this.gridStepValue)) {
            await this.handleTrailingDown();
        }

        // Trailing UP: Shifts grid UP if price rises above the range
        // Helps exit positions if the rebound continues
        if (this.config.trailing !== false && price > (this.currentHighPrice + this.gridStepValue)) {
            await this.handleTrailingUp();
        }
    }

    /**
     * Handle trailing down mechanism
     * 
     * When price falls below grid range:
     * 1. Cancel order at highest price level
     * 2. Shift grid down by one step
     * 3. Place new buy order at new lowest level
     * 
     * This allows bot to "follow" price downward to catch deeper dips.
     */
    private async handleTrailingDown(): Promise<void> {
        try {
            console.log(`[BTD] Trailing Down triggered.`);
            this.gridLevels.sort((a, b) => a - b);

            // Remove top level
            const topLevel = this.gridLevels[this.gridLevels.length - 1];

            // Cancel order at top level if exists
            for (const [id, order] of this.activeOrders.entries()) {
                if (Math.abs(order.price - topLevel) / topLevel < PRICE_TOLERANCE) {
                    await this.exchange.cancelOrder(id, this.bot.pair).catch(() => { });
                    this.activeOrders.delete(id);
                }
            }

            // Shift levels down
            this.gridLevels.pop();
            const newLow = this.currentLowPrice - this.gridStepValue;
            this.gridLevels.unshift(newLow);

            this.currentLowPrice = newLow;
            this.currentHighPrice -= this.gridStepValue;

            // Place new buy at the new lowest level
            const investment = this.config.investment / this.config.gridLevels;
            await this.placeOrder('buy', newLow, investment / newLow);
        } catch (error) {
            await this.handleStrategyError(error as Error, 'handleTrailingDown');
        }
    }

    /**
     * Handle trailing up mechanism
     * 
     * When price rises above grid range:
     * 1. Cancel order at lowest price level
     * 2. Shift grid up by one step
     * 3. Update range to follow the uptrend
     * 
     * Helps exit positions or reduce accumulation if price rallies.
     */
    private async handleTrailingUp(): Promise<void> {
        try {
            // Logic to follow price up
            this.gridLevels.sort((a, b) => a - b);

            // Remove bottom level
            const bottomLevel = this.gridLevels[0];

            for (const [id, order] of this.activeOrders.entries()) {
                if (Math.abs(order.price - bottomLevel) / bottomLevel < PRICE_TOLERANCE) {
                    await this.exchange.cancelOrder(id, this.bot.pair).catch(() => { });
                    this.activeOrders.delete(id);
                }
            }

            this.gridLevels.shift();
            const newHigh = this.currentHighPrice + this.gridStepValue;
            this.gridLevels.push(newHigh);

            this.currentLowPrice += this.gridStepValue;
            this.currentHighPrice = newHigh;
        } catch (error) {
            await this.handleStrategyError(error as Error, 'handleTrailingUp');
        }
    }

    /**
     * Handle order fill event
     * 
     * When a buy order fills, places sell order at next grid level.
     * When a sell order fills, places buy order at previous grid level.
     * Updates realized PnL on each complete buy-sell cycle.
     * 
     * @param order Filled order details
     */
    async onOrderFilled(order: TradeOrder): Promise<void> {
        try {
            this.activeOrders.delete(order.id);
            await this.recordTrade(order);

            if (this.isPaused) return;

            const gridIndex = this.gridLevels.findIndex(p => Math.abs(p - order.price) / p < PRICE_TOLERANCE);
            if (gridIndex === -1) return;

            if (order.side === 'buy') {
                // Buy the Dip executed.
                // Place a Sell limit above to capture the rebound
                if (gridIndex + 1 < this.gridLevels.length) {
                    const sellPrice = this.gridLevels[gridIndex + 1];
                    await this.placeOrder('sell', sellPrice, order.amount);
                }
            } else {
                // Sold the rebound. Re-open buy limit for the next dip.
                if (gridIndex - 1 >= 0) {
                    const buyPrice = this.gridLevels[gridIndex - 1];
                    
                    // Calculate profit for this dip-rebound cycle
                    const profit = (order.price - buyPrice) * order.amount;
                    if (profit > 0) {
                        this.bot.performance.botProfit += profit;
                        this.bot.performance.realizedPnL += profit;
                    }

                    await this.placeOrder('buy', buyPrice, order.amount);
                }
            }

            this.bot.performance.totalTrades++;
        } catch (error) {
            await this.handleStrategyError(error as Error, 'onOrderFilled');
        }
    }

    /**
     * Increase investment amount
     * 
     * When additional capital is added:
     * 1. Cancel all pending orders
     * 2. Call parent class to update investment
     * 3. Recalculate and replace all grid orders
     * 
     * @param amount Amount to increase investment by
     */
    async increaseInvestment(amount: number): Promise<void> {
        console.log(`[BTD] Increasing investment by ${amount}. Re-allocating orders...`);
        await this.cancelAllActiveOrders();
        await super.increaseInvestment(amount);
        const ticker = await this.exchange.getTicker(this.bot.pair);
        await this.placeGridOrders(ticker.lastPrice);
    }
}

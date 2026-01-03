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

    /** Buy context keyed by sell order id for base profit calculation */
    private orderMetadata: Map<string, { buyPrice: number; buyAmount: number }> = new Map();
    
    /** Current lowest price in grid range */
    protected currentLowPrice: number;
    
    /** Current highest price in grid range */
    protected currentHighPrice: number;
    
    /** Calculated step size between grid levels (down/up may differ when asymmetric) */
    protected gridStepValueDown: number = 0;
    protected gridStepValueUp: number = 0;

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
        // Initialize a coarse grid using configured range; we will refine with live price in start()
        await this.calculateAsymmetricGrid((this.config.highPrice + this.config.lowPrice) / 2);
    }

    /**
    * Calculate grid levels
    * 
    * User can either provide:
    * 1) low/high + gridStep% (range-driven), or
    * 2) levelsDown/levelsUp + gridStep% (count-driven; low/high derived).
     */
    protected async calculateAsymmetricGrid(anchorPrice: number): Promise<void> {
        const { gridLevels, gridStep, lowPrice, highPrice } = this.config;

        // Validate configuration combinations
        if ((this.config.levelsDown !== undefined || this.config.levelsUp !== undefined) && !gridStep) {
            throw new Error('[BTD] levelsDown/levelsUp require gridStep% to be specified');
        }
        if (!gridStep && (!lowPrice || !highPrice)) {
            throw new Error('[BTD] Either (low/high prices) or (gridStep + levels) must be provided');
        }

        const totalSteps = Math.max(gridLevels - 1, 1);

        // Determine split between levels below and above anchor
        const explicitDown = this.config.levelsDown;
        const explicitUp = this.config.levelsUp;

        let levelsDown: number;
        let levelsUp: number;

        if (explicitDown !== undefined && explicitUp !== undefined) {
            const totalExplicit = explicitDown + explicitUp;
            const ratio = totalExplicit > totalSteps ? totalSteps / totalExplicit : 1;
            levelsDown = Math.round(explicitDown * ratio);
            levelsDown = Math.min(Math.max(levelsDown, 0), totalSteps);
            levelsUp = Math.max(0, totalSteps - levelsDown);
        } else {
            const distribution = this.config.levelsDistribution ?? 50;
            levelsDown = Math.round(totalSteps * distribution / 100);
            levelsDown = Math.min(Math.max(levelsDown, 0), totalSteps);
            levelsUp = Math.max(0, totalSteps - levelsDown);
        }

        // Step sizes: percentage gap if provided, otherwise derive from price bounds
        if (gridStep && gridStep > 0) {
            const step = anchorPrice * (gridStep / 100);
            this.gridStepValueDown = step;
            this.gridStepValueUp = step;

            // When explicit levels are provided, compute range from anchor and step counts
            if (explicitDown !== undefined && explicitUp !== undefined) {
                this.currentLowPrice = anchorPrice - levelsDown * step;
                this.currentHighPrice = anchorPrice + levelsUp * step;
            }
        } else {
            const range = this.currentHighPrice - this.currentLowPrice;
            const step = range / totalSteps;
            this.gridStepValueDown = step;
            this.gridStepValueUp = step;
        }

        const buyLevels: number[] = [];
        for (let i = levelsDown; i >= 1; i--) {
            buyLevels.push(anchorPrice - i * this.gridStepValueDown);
        }

        const sellLevels: number[] = [];
        for (let i = 1; i <= levelsUp; i++) {
            sellLevels.push(anchorPrice + i * this.gridStepValueUp);
        }

        this.gridLevels = [...buyLevels, anchorPrice, ...sellLevels].sort((a, b) => a - b);
    }

    /**
    * Start strategy execution
    * 
    * Seeds initial sell orders above current price (base-funded start).
     */
    async start(): Promise<void> {
        await this.updateBotStatus('running');
        const ticker = await this.exchange.getTicker(this.bot.pair);
        this.lastPrice = ticker.lastPrice;

        await this.calculateAsymmetricGrid(ticker.lastPrice);
        await this.placeInitialSellOrders(ticker.lastPrice);
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
    * Place initial grid sells above current price (base-funded start)
    * 
    * @param currentPrice Current market price
     */
    protected async placeInitialSellOrders(currentPrice: number): Promise<void> {
        const amountPerLevel = this.config.investment / this.config.gridLevels;

        for (const price of this.gridLevels) {
            if (price > currentPrice * (1 + PRICE_TOLERANCE)) {
                await this.placeOrder('sell', price, amountPerLevel);
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
    protected async placeOrder(side: 'buy' | 'sell', price: number, amount: number): Promise<TradeOrder | undefined> {
        if (this.isPaused) return;
        const adjustedPrice = side === 'buy'
            ? price * (1 - this.feeBuffer)
            : price * (1 + this.feeBuffer);

        try {
            const order = await this.executeOrderWithRetry({
                userId: this.bot.userId,
                botId: this.bot.id,
                pair: this.bot.pair,
                side,
                type: 'limit',
                price: adjustedPrice,
                amount
            });
            this.activeOrders.set(order.id, order);
            return order;
        } catch (error) {
            await this.handleStrategyError(error as Error, `placeOrder(${side} @ ${price})`);
            return undefined;
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
        if (this.config.trailing !== false && price < (this.currentLowPrice - this.gridStepValueDown)) {
            await this.handleTrailingDown();
        }

        // Trailing UP: Shifts grid UP if price rises above the range
        // Helps exit positions if the rebound continues
        if (this.config.trailing !== false && price > (this.currentHighPrice + this.gridStepValueUp)) {
            await this.handleTrailingUp();
        }
    }

    /**
     * Handle trailing down mechanism
     * 
     * When price falls below grid range:
     * 1. Cancel highest sell order
     * 2. Shift entire grid down by one step
     * 3. Place new sell order at new highest level (maintains grid count)
     * 
     * This allows bot to "follow" price downward to catch deeper dips.
     */
    private async handleTrailingDown(): Promise<void> {
        try {
            console.log(`[BTD] Trailing Down triggered.`);
            this.gridLevels.sort((a, b) => a - b);

            // Remove highest sell level
            const topLevel = this.gridLevels[this.gridLevels.length - 1];
            for (const [id, order] of this.activeOrders.entries()) {
                if (order.side === 'sell' && Math.abs(order.price - topLevel) / topLevel < PRICE_TOLERANCE) {
                    await this.exchange.cancelOrder(id, this.bot.pair).catch(() => { });
                    this.activeOrders.delete(id);
                    this.orderMetadata.delete(id);
                }
            }

            // Shift levels down by one down-step
            this.gridLevels.pop();
            const newLow = this.currentLowPrice - this.gridStepValueDown;
            this.gridLevels = this.gridLevels.map(level => level - this.gridStepValueDown);
            this.gridLevels.unshift(newLow);

            this.currentLowPrice = newLow;
            this.currentHighPrice -= this.gridStepValueDown;

            // Place new sell at the new highest level to maintain grid count
            const amountPerLevel = this.config.investment / this.config.gridLevels;
            await this.placeOrder('sell', this.currentHighPrice, amountPerLevel);
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
                    this.orderMetadata.delete(id);
                }
            }

            this.gridLevels.shift();
            const newHigh = this.currentHighPrice + this.gridStepValueUp;
            this.gridLevels.push(newHigh);

            this.currentLowPrice += this.gridStepValueUp;
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
                // Buy the Dip executed → place sell above and track buy context
                if (gridIndex + 1 < this.gridLevels.length) {
                    const sellPrice = this.gridLevels[gridIndex + 1];
                    const sellOrder = await this.placeOrder('sell', sellPrice, order.amount);
                    if (sellOrder) {
                        this.orderMetadata.set(sellOrder.id, {
                            buyPrice: order.price,
                            buyAmount: order.amount
                        });
                    }
                }
            } else {
                // Sell filled: realize profit using stored buy context if present
                const buyContext = this.orderMetadata.get(order.id);
                if (buyContext) {
                    const grossQuoteProfit = (order.price - buyContext.buyPrice) * order.amount;
                    const feeCost = (order.price + buyContext.buyPrice) * order.amount * this.feeBuffer; // approx round trip
                    const netQuoteProfit = grossQuoteProfit - feeCost;
                    const baseProfit = netQuoteProfit / order.price;
                    if (baseProfit > 0) {
                        this.bot.performance.botProfit += baseProfit;
                        order.profit = baseProfit;
                    }
                    this.orderMetadata.delete(order.id);
                }

                // Re-open buy limit for the next dip
                if (gridIndex - 1 >= 0) {
                    const buyPrice = this.gridLevels[gridIndex - 1];
                    await this.placeOrder('buy', buyPrice, order.amount);
                }
            }

            this.bot.performance.totalTrades++;
        } catch (error) {
            await this.handleStrategyError(error as Error, 'onOrderFilled');
        }
    }

    /**
     * Handle order cancellation event from WebSocket
     * Removes the cancelled order from activeOrders tracking map
     * @param orderId The exchange order ID
     * @param pair The trading pair
     */
    async onOrderCancelled(orderId: string, pair: string): Promise<void> {
        const wasTracked = this.activeOrders.delete(orderId);
        this.orderMetadata.delete(orderId);
        if (wasTracked) {
            console.log(`[Bot ${this.bot.id}] BTD order ${orderId} cancelled and removed from tracking`);
        } else {
            console.log(`[Bot ${this.bot.id}] Cancelled order ${orderId} not found in tracking map`);
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
        await this.calculateAsymmetricGrid(ticker.lastPrice);
        await this.placeInitialSellOrders(ticker.lastPrice);
    }
}

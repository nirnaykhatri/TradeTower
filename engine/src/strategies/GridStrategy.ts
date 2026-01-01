import { BaseStrategy, ExitMode } from './BaseStrategy';
import { GridConfig } from '../types/strategyConfig';
import { TradeOrder, validateGridConfig } from '@trading-tower/shared';
import {
    PRICE_TOLERANCE,
    MAX_FILL_HISTORY,
    PUMP_PROTECTION_THRESHOLD,
    PUMP_PROTECTION_WINDOW_MS
} from '../constants/strategy.constants';

/**
 * Grid Trading Strategy
 * Places buy and sell orders at fixed price intervals (grid levels)
 * Profits from price oscillation within a range
 */
export class GridStrategy extends BaseStrategy<GridConfig> {
    private gridLevels: number[] = [];
    private buyOrders: Map<string, TradeOrder> = new Map();
    private sellOrders: Map<string, TradeOrder> = new Map();
    private currentLowPrice: number;
    private currentHighPrice: number;
    private gridStepValue: number = 0;
    private lastFills: number[] = [];

    constructor(bot: any, exchange: any, config: GridConfig) {
        super(bot, exchange, config);
        this.currentLowPrice = config.lowPrice;
        this.currentHighPrice = config.highPrice;
    }

    /**
     * Initialize grid strategy - validates config and calculates grid levels
     */
    async initialize(): Promise<void> {
        validateGridConfig(this.config);
        this.calculateGrid();
    }

    private calculateGrid() {
        const priceDiff = this.currentHighPrice - this.currentLowPrice;
        this.gridStepValue = priceDiff / (this.config.gridLevels - 1);

        this.gridLevels = [];
        for (let i = 0; i < this.config.gridLevels; i++) {
            this.gridLevels.push(this.currentLowPrice + i * this.gridStepValue);
        }
    }

    async start(): Promise<void> {
        await this.updateBotStatus('running');
        const ticker = await this.exchange.getTicker(this.bot.pair);
        this.lastPrice = ticker.lastPrice;

        if (this.bot.performance.initialPrice === 0) {
            this.bot.performance.initialPrice = ticker.lastPrice;
        }

        await this.placeInitialOrders(ticker.lastPrice);
    }

    private async placeInitialOrders(currentPrice: number) {
        const investmentPerLevel = this.config.investment / (this.config.gridLevels / 2);

        for (const price of this.gridLevels) {
            if (price < currentPrice * 0.999) {
                await this.placeOrder('buy', price, investmentPerLevel / price);
            } else if (price > currentPrice * 1.001) {
                await this.placeOrder('sell', price, investmentPerLevel / price);
            }
        }
    }

    private async placeOrder(side: 'buy' | 'sell', price: number, amount: number) {
        if (this.isPaused) return;

        // --- Pump Protection Check ---
        if (this.config.pumpProtection && this.detectUnusualVelocity()) {
            console.warn(`[GridBot] Pump Protection Triggered. Halting order placement.`);
            return;
        }

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
            if (side === 'buy') this.buyOrders.set(order.id, order);
            else this.sellOrders.set(order.id, order);
        } catch (error) {
            console.error(`[GridBot] Failed to place ${side} order at ${price}:`, error);
        }
    }

    /**
     * Detect unusual market velocity (pump protection)
     * @returns true if too many fills occurred in short time window
     */
    private detectUnusualVelocity(): boolean {
        if (this.lastFills.length < PUMP_PROTECTION_THRESHOLD) return false;
        const now = Date.now();
        const recentFills = this.lastFills.filter(t => now - t < PUMP_PROTECTION_WINDOW_MS);
        return recentFills.length >= PUMP_PROTECTION_THRESHOLD;
    }

    /**
     * Get all active orders for cancellation
     */
    protected getActiveOrders(): Map<string, TradeOrder> {
        const allOrders = new Map<string, TradeOrder>();
        this.buyOrders.forEach((order, id) => allOrders.set(id, order));
        this.sellOrders.forEach((order, id) => allOrders.set(id, order));
        return allOrders;
    }

    /**
     * Override to clear local order maps after base class cancellation
     */
    protected async cancelAllActiveOrders(): Promise<void> {
        await super.cancelAllActiveOrders();
        this.buyOrders.clear();
        this.sellOrders.clear();
    }

    async onPriceUpdate(price: number): Promise<void> {
        if (this.isPaused) return;
        this.lastPrice = price;

        this.updatePerformanceMetrics(price);

        // Advanced Take Profit / Stop Loss Settings
        if (this.config.stopLossEnabled && this.config.stopLoss && price <= this.config.stopLoss) {
            console.log(`[GridBot] Stop Loss ${this.config.stopLoss} triggered.`);
            await this.stop('MARKET_SELL');
            return;
        }

        if (this.config.takeProfitEnabled && this.config.takeProfit && price >= this.config.takeProfit) {
            console.log(`[GridBot] Take Profit ${this.config.takeProfit} triggered.`);
            await this.stop('MARKET_SELL');
            return;
        }

        if (this.config.trailingUp && price > (this.currentHighPrice + this.gridStepValue)) {
            await this.handleTrailingUp();
        }

        if (this.config.trailingDown && price < (this.currentLowPrice - this.gridStepValue)) {
            await this.handleTrailingDown();
        }
    }

    /**
     * Professional Increase Investment (Bitsgap Style)
     * Adds quote funds and re-allocates order sizes across the grid.
     */
    async increaseInvestment(amount: number): Promise<void> {
        console.log(`[GridBot] Increasing investment by ${amount}. Re-allocating grid orders...`);

        // 1. Cancel all active orders
        await this.cancelAllActiveOrders();

        // 2. Update investment and balances via BaseStrategy
        await super.increaseInvestment(amount);

        // 3. Re-place orders with the new (increased) order size
        const ticker = await this.exchange.getTicker(this.bot.pair);
        await this.placeInitialOrders(ticker.lastPrice);
    }

    /**
     * Handle trailing up - shifts grid range upward
     * Cancels lowest buy order and places new sell order at top
     */
    private async handleTrailingUp() {
        this.gridLevels.sort((a, b) => a - b);
        const lowestLevel = this.gridLevels[0];

        let lowestOrder: TradeOrder | null = null;
        for (const order of this.buyOrders.values()) {
            if (Math.abs(order.price - lowestLevel) / lowestLevel < PRICE_TOLERANCE) {
                lowestOrder = order;
                break;
            }
        }

        if (lowestOrder) {
            await this.cancelOrderWithRetry(lowestOrder.id, this.bot.pair);
            this.buyOrders.delete(lowestOrder.id);

            try {
                const fill = await this.executeOrderWithRetry({
                    userId: this.bot.userId,
                    botId: this.bot.id,
                    pair: this.bot.pair,
                    side: 'buy',
                    type: 'market',
                    amount: lowestOrder.amount
                });
                await this.onOrderFilled(fill);
            } catch (error) {
                await this.handleStrategyError(error as Error, 'trailingUp market buy');
            }
        }

        this.gridLevels.shift();
        const newHigh = this.currentHighPrice + this.gridStepValue;
        this.gridLevels.push(newHigh);

        this.currentLowPrice += this.gridStepValue;
        this.currentHighPrice = newHigh;

        const investmentPerLevel = this.config.investment / (this.config.gridLevels / 2);
        await this.placeOrder('sell', newHigh, investmentPerLevel / newHigh);
    }

    /**
     * Handle trailing down - shifts grid range downward
     * Cancels highest sell order and places new buy order at bottom
     */
    private async handleTrailingDown() {
        this.gridLevels.sort((a, b) => a - b);
        const highestLevel = this.gridLevels[this.gridLevels.length - 1];

        let highestOrder: TradeOrder | null = null;
        for (const order of this.sellOrders.values()) {
            if (Math.abs(order.price - highestLevel) / highestLevel < PRICE_TOLERANCE) {
                highestOrder = order;
                break;
            }
        }

        if (highestOrder) {
            await this.cancelOrderWithRetry(highestOrder.id, this.bot.pair);
            this.sellOrders.delete(highestOrder.id);

            try {
                const fill = await this.executeOrderWithRetry({
                    userId: this.bot.userId,
                    botId: this.bot.id,
                    pair: this.bot.pair,
                    side: 'sell',
                    type: 'market',
                    amount: highestOrder.amount
                });
                await this.onOrderFilled(fill);
            } catch (error) {
                await this.handleStrategyError(error as Error, 'trailingDown market sell');
            }
        }

        this.gridLevels.pop();
        const newLow = this.currentLowPrice - this.gridStepValue;
        this.gridLevels.unshift(newLow);

        this.currentLowPrice = newLow;
        this.currentHighPrice -= this.gridStepValue;

        const investmentPerLevel = this.config.investment / (this.config.gridLevels / 2);
        await this.placeOrder('buy', newLow, investmentPerLevel / newLow);
    }

    /**
     * Handle order filled event
     * Updates balances, calculates profits, and places counter orders
     * @param order The filled order
     */
    async onOrderFilled(order: TradeOrder): Promise<void> {
        this.buyOrders.delete(order.id);
        this.sellOrders.delete(order.id);
        this.lastFills.push(Date.now());
        if (this.lastFills.length > MAX_FILL_HISTORY) this.lastFills.shift();

        const perf = this.bot.performance;

        if (order.side === 'buy') {
            const totalCost = (this.avgCostBasis * perf.baseBalance) + (order.price * order.amount);
            perf.baseBalance += order.amount;
            perf.quoteBalance -= (order.amount * order.price);
            this.avgCostBasis = totalCost / (perf.baseBalance || 1);
        } else {
            const gridIndex = this.gridLevels.findIndex(p => Math.abs(p - order.price) / p < PRICE_TOLERANCE);
            if (gridIndex > 0) {
                const buyLevelPrice = this.gridLevels[gridIndex - 1];
                const profit = (order.price - buyLevelPrice) * order.amount;
                perf.botProfit += profit;
                perf.realizedPnL += profit;
            }

            perf.baseBalance -= order.amount;
            perf.quoteBalance += (order.amount * order.price);
        }

        await this.recordTrade(order);

        if (this.isPaused) return;

        const gridIndex = this.gridLevels.findIndex(p => Math.abs(p - order.price) / p < PRICE_TOLERANCE);
        if (gridIndex === -1) return;

        if (order.side === 'buy') {
            if (gridIndex + 1 < this.gridLevels.length) {
                const sellPrice = this.gridLevels[gridIndex + 1];
                await this.placeOrder('sell', sellPrice, order.amount);
            }
        } else {
            if (gridIndex - 1 >= 0) {
                const buyPrice = this.gridLevels[gridIndex - 1];
                await this.placeOrder('buy', buyPrice, order.amount);
            }
        }
    }
}

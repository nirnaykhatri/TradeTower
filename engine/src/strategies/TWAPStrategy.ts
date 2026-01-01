import { BaseStrategy } from './BaseStrategy';
import { TWAPConfig } from '../types/strategyConfig';
import { TradeOrder } from '@trading-tower/shared';
import { PRICE_TOLERANCE } from '../constants/strategy.constants';

/**
 * TWAP (Time Weighted Average Price) Strategy
 * 
 * Executes a large order by dividing it into equal slices executed at
 * regular time intervals. This minimizes market impact and achieves an
 * average price close to the TWAP over the execution period.
 * 
 * Supports both buy and sell operations with optional:
 * - Price limit to avoid unfavorable execution prices
 * - Random slice variation to avoid detection
 * - Duration-based or interval-based execution
 * 
 * Key Features:
 * - Configurable execution duration and frequency
 * - Random slice variation (±10%) for natural execution patterns
 * - Price limit support for buy/sell constraints
 * - Automatic stop when target amount is executed
 */
export class TWAPStrategy extends BaseStrategy<TWAPConfig> {
    private timer: NodeJS.Timeout | null = null;
    private totalTargetAmount: number = 0;
    private totalExecutedAmount: number = 0;
    private startTimeAt: number = 0;
    private sliceSize: number = 0;
    private totalIntervals: number = 0;
    private currentInterval: number = 0;

    /**
     * Get active orders currently managed by this strategy
     * @returns Map of active orders (empty for TWAP as orders are market orders)
     */
    getActiveOrders(): Map<string, TradeOrder> {
        // TWAP uses market orders so there are no pending orders
        // Return empty map for consistency with other strategies
        return new Map();
    }

    /**
     * Initialize the TWAP strategy with calculation of slice size and intervals
     * @returns Promise<void>
     */
    async initialize(): Promise<void> {
        this.totalTargetAmount = this.config.totalAmount;
        this.totalIntervals = Math.max(1, Math.floor((this.config.duration * 60) / this.config.frequency));
        this.sliceSize = this.totalTargetAmount / this.totalIntervals;
        console.log(`[TWAP] Initialized: ${this.totalTargetAmount} into ${this.totalIntervals} slices.`);
    }

    /**
     * Start the TWAP execution by setting up timer and executing first slice
     * @returns Promise<void>
     */
    async start(): Promise<void> {
        await this.updateBotStatus('running');
        this.startTimeAt = Date.now();
        this.currentInterval = 0;
        this.timer = setInterval(async () => {
            if (!this.isPaused) await this.executeSlice();
        }, this.config.frequency * 1000);
        await this.executeSlice();
    }

    /**
     * Execute a single TWAP slice with optional price limit checking
     * Includes random variation to slice size for natural execution patterns
     * 
     * @returns Promise<void>
     */
    private async executeSlice(): Promise<void> {
        if (this.isPaused) return;

        const elapsedMinutes = (Date.now() - this.startTimeAt) / 60000;
        if (this.currentInterval >= this.totalIntervals ||
            this.totalExecutedAmount >= this.totalTargetAmount ||
            elapsedMinutes >= this.config.duration) {
            await this.stop();
            return;
        }

        const ticker = await this.exchange.getTicker(this.bot.pair);
        const price = ticker.lastPrice;

        if (this.config.priceLimit) {
            if (this.config.direction === 'BUY' && price > this.config.priceLimit) return;
            if (this.config.direction === 'SELL' && price < this.config.priceLimit) return;
        }

        const randFactor = 0.9 + Math.random() * 0.2;
        let adjustedSlice = this.sliceSize * randFactor;
        const remaining = this.totalTargetAmount - this.totalExecutedAmount;
        if (adjustedSlice > remaining) adjustedSlice = remaining;

        try {
            await this.executeOrderWithRetry({
                userId: this.bot.userId,
                botId: this.bot.id,
                pair: this.bot.pair,
                side: this.config.direction === 'BUY' ? 'buy' : 'sell',
                type: 'market',
                amount: adjustedSlice
            });
            this.currentInterval++;
        } catch (error) {
            await this.handleStrategyError(error as Error, 'executeSlice');
        }
    }

    /**
     * Cancel all active orders by clearing the execution timer
     * @returns Promise<void>
     */
    protected async cancelAllActiveOrders(): Promise<void> {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    /**
     * Handle price update events
     * Current implementation updates last price for monitoring
     * 
     * @param price Current market price
     * @returns Promise<void>
     */
    async onPriceUpdate(price: number): Promise<void> {
        this.lastPrice = price;
    }

    /**
     * Handle order filled events with execution tracking
     * Updates total executed amount and stops when target is reached
     * 
     * @param order The filled TradeOrder
     * @returns Promise<void>
     */
    async onOrderFilled(order: TradeOrder): Promise<void> {
        this.totalExecutedAmount += (order.filledAmount || order.amount);
        await this.recordTrade(order);
        if (this.totalExecutedAmount >= this.totalTargetAmount) {
            await this.stop();
        }
    }
}

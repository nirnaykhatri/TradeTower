import { BaseStrategy } from './BaseStrategy';
import { TWAPConfig } from '../types/strategyConfig';
import { TradeOrder } from '@trading-tower/shared';

export class TWAPStrategy extends BaseStrategy<TWAPConfig> {
    private timer: NodeJS.Timeout | null = null;
    private totalTargetAmount: number = 0;
    private totalExecutedAmount: number = 0;
    private startTimeAt: number = 0;
    private sliceSize: number = 0;
    private totalIntervals: number = 0;
    private currentInterval: number = 0;

    async initialize(): Promise<void> {
        this.totalTargetAmount = this.config.totalAmount;
        this.totalIntervals = Math.max(1, Math.floor((this.config.duration * 60) / this.config.frequency));
        this.sliceSize = this.totalTargetAmount / this.totalIntervals;
        console.log(`[TWAP] Initialized: ${this.totalTargetAmount} into ${this.totalIntervals} slices.`);
    }

    async start(): Promise<void> {
        await this.updateBotStatus('running');
        this.startTimeAt = Date.now();
        this.currentInterval = 0;
        this.timer = setInterval(async () => {
            if (!this.isPaused) await this.executeSlice();
        }, this.config.frequency * 1000);
        await this.executeSlice();
    }

    private async executeSlice() {
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
            await this.exchange.createOrder({
                userId: this.bot.userId,
                botId: this.bot.id,
                pair: this.bot.pair,
                side: this.config.direction === 'BUY' ? 'buy' : 'sell',
                type: 'market',
                amount: adjustedSlice,
                extendedHours: false,
            });
            this.currentInterval++;
        } catch (error) {
            console.error(`[TWAP] Slice execution failed:`, error);
        }
    }

    protected async cancelAllActiveOrders() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    async onPriceUpdate(price: number): Promise<void> {
        this.lastPrice = price;
    }

    async onOrderFilled(order: TradeOrder): Promise<void> {
        this.totalExecutedAmount += (order.filledAmount || order.amount);
        await this.recordTrade(order);
        if (this.totalExecutedAmount >= this.totalTargetAmount) {
            await this.stop();
        }
    }
}

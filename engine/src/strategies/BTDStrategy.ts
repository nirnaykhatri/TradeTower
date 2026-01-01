import { BaseStrategy } from './BaseStrategy';
import { BTDConfig } from '../types/strategyConfig';
import { TradeOrder } from '@trading-tower/shared';

export class BTDStrategy extends BaseStrategy<BTDConfig> {
    protected gridLevels: number[] = [];
    protected activeOrders: Map<string, TradeOrder> = new Map();
    protected currentLowPrice: number;
    protected currentHighPrice: number;
    protected gridStepValue: number = 0;

    constructor(bot: any, exchange: any, config: BTDConfig) {
        super(bot, exchange, config);
        this.currentLowPrice = config.lowPrice;
        this.currentHighPrice = config.highPrice;
    }

    async initialize(): Promise<void> {
        await this.calculateAsymmetricGrid();
    }

    protected async calculateAsymmetricGrid() {
        const { gridLevels } = this.config;
        const range = this.currentHighPrice - this.currentLowPrice;
        this.gridStepValue = range / (gridLevels - 1);

        this.gridLevels = [];
        for (let i = 0; i < gridLevels; i++) {
            this.gridLevels.push(this.currentLowPrice + i * this.gridStepValue);
        }
        this.gridLevels.sort((a, b) => a - b);
    }

    async start(): Promise<void> {
        await this.updateBotStatus('running');
        const ticker = await this.exchange.getTicker(this.bot.pair);
        this.lastPrice = ticker.lastPrice;

        await this.placeGridOrders(ticker.lastPrice);
    }

    protected async placeGridOrders(currentPrice: number) {
        const investment = this.config.investment / this.config.gridLevels;

        for (const price of this.gridLevels) {
            // BTD only places BUY orders first
            if (price < currentPrice * 0.999) {
                await this.placeOrder('buy', price, investment / price);
            }
        }
    }

    protected async placeOrder(side: 'buy' | 'sell', price: number, amount: number) {
        if (this.isPaused) return;

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
        } catch (error) {
            console.error(`[BTD] Failed to place ${side} at ${price}:`, error);
        }
    }

    protected async cancelAllActiveOrders() {
        for (const id of this.activeOrders.keys()) {
            await this.exchange.cancelOrder(id, this.bot.pair).catch(() => { });
        }
        this.activeOrders.clear();
    }

    async onPriceUpdate(price: number): Promise<void> {
        if (this.isPaused) return;
        this.lastPrice = price;

        // Trailing DOWN: Shifts the grid DOWN if price falls below the range
        // This is crucial for "Buy The Dip" to catch deeper dips
        if (this.config.trailing !== false && price < (this.currentLowPrice - this.gridStepValue)) {
            await this.handleTrailingDown();
        }

        // Trailing UP (Optional, usually for selling recovery)
        if (this.config.trailing !== false && price > (this.currentHighPrice + this.gridStepValue)) {
            // BTD often focuses on accumulation, but trailing up helps exit if the rebound continues
            await this.handleTrailingUp();
        }
    }

    private async handleTrailingDown() {
        console.log(`[BTD] Trailing Down triggered.`);
        this.gridLevels.sort((a, b) => a - b);

        // Remove top level
        const topLevel = this.gridLevels[this.gridLevels.length - 1];

        // Cancel order at top level if exists (unlikely in BTD as we buy down, but good for cleanup)
        for (const [id, order] of this.activeOrders.entries()) {
            if (Math.abs(order.price - topLevel) / topLevel < 0.001) {
                await this.exchange.cancelOrder(id, this.bot.pair).catch(() => { });
                this.activeOrders.delete(id);
            }
        }

        // Shift Levels Logic
        this.gridLevels.pop();
        const newLow = this.currentLowPrice - this.gridStepValue;
        this.gridLevels.unshift(newLow);

        this.currentLowPrice = newLow;
        this.currentHighPrice -= this.gridStepValue;

        // Place new buy at the new low bottom
        const investment = this.config.investment / this.config.gridLevels;
        await this.placeOrder('buy', newLow, investment / newLow);
    }

    private async handleTrailingUp() {
        // Logic to follow price up
        this.gridLevels.sort((a, b) => a - b);

        // Remove bottom level
        const bottomLevel = this.gridLevels[0];

        for (const [id, order] of this.activeOrders.entries()) {
            if (Math.abs(order.price - bottomLevel) / bottomLevel < 0.001) {
                await this.exchange.cancelOrder(id, this.bot.pair).catch(() => { });
                this.activeOrders.delete(id);
            }
        }

        this.gridLevels.shift();
        const newHigh = this.currentHighPrice + this.gridStepValue;
        this.gridLevels.push(newHigh);

        this.currentLowPrice += this.gridStepValue;
        this.currentHighPrice = newHigh;

        // Usually we don't place buy orders ABOVE current price in BTD, 
        // but if the grid shifts up, we might re-populate the levels below current price 
        // or place sell orders if we are in profit. 
        // For pure accumulation BTD, we might just shift the range.
    }

    async onOrderFilled(order: TradeOrder): Promise<void> {
        this.activeOrders.delete(order.id);
        await this.recordTrade(order);

        if (this.isPaused) return;

        const gridIndex = this.gridLevels.findIndex(p => Math.abs(p - order.price) / p < 0.001);
        if (gridIndex === -1) return;

        if (order.side === 'buy') {
            // Executed Buy the Dip.
            // BTD Strategy typically places a Sell limit above to capture the rebound ("Scalping the dip")
            if (gridIndex + 1 < this.gridLevels.length) {
                const sellPrice = this.gridLevels[gridIndex + 1];
                await this.placeOrder('sell', sellPrice, order.amount);
            }
        } else {
            // Sold the rebound. Re-open buy limit for the next dip.

            // Calculate Profit for this "Buy Low -> Sell High" mini-cycle
            // BTD profit is realized in Quote currency (e.g. USDT)
            if (gridIndex - 1 >= 0) {
                const buyPrice = this.gridLevels[gridIndex - 1]; // The Buy that started this
                // Approximate profit matching
                const profit = (order.price - buyPrice) * order.amount;
                if (profit > 0) {
                    this.bot.performance.botProfit += profit;
                    this.bot.performance.realizedPnL += profit;
                }

                await this.placeOrder('buy', buyPrice, order.amount);
            }
        }

        this.bot.performance.totalTrades++;
    }

    async increaseInvestment(amount: number): Promise<void> {
        console.log(`[BTD] Increasing investment by ${amount}. Re-allocating orders...`);
        await this.cancelAllActiveOrders();
        await super.increaseInvestment(amount);
        const ticker = await this.exchange.getTicker(this.bot.pair);
        await this.placeGridOrders(ticker.lastPrice);
    }
}

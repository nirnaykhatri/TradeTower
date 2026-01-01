import { BaseStrategy, ExitMode } from './BaseStrategy';
import { FuturesGridConfig } from '../types/strategyConfig';
import { TradeOrder } from '@trading-tower/shared';

export class FuturesGridStrategy extends BaseStrategy<FuturesGridConfig> {
    private gridLevels: number[] = [];
    private activeOrders: Map<string, TradeOrder> = new Map();
    private currentPositionSize: number = 0;
    private currentLowPrice: number;
    private currentHighPrice: number;
    private gridStepValue: number = 0;

    constructor(bot: any, exchange: any, config: FuturesGridConfig) {
        super(bot, exchange, config);
        this.currentLowPrice = config.lowPrice;
        this.currentHighPrice = config.highPrice;
    }

    async initialize(): Promise<void> {
        this.calculateGrid();
    }

    private calculateGrid() {
        const { gridQuantity, gridMode } = this.config;
        this.gridLevels = [];

        if (gridMode === 'ARITHMETIC') {
            this.gridStepValue = (this.currentHighPrice - this.currentLowPrice) / (gridQuantity - 1);
            for (let i = 0; i < gridQuantity; i++) {
                this.gridLevels.push(this.currentLowPrice + i * this.gridStepValue);
            }
        } else {
            const ratio = Math.pow(this.currentHighPrice / this.currentLowPrice, 1 / (gridQuantity - 1));
            for (let i = 0; i < gridQuantity; i++) {
                this.gridLevels.push(this.currentLowPrice * Math.pow(ratio, i));
            }
        }
        this.gridLevels.sort((a, b) => a - b);
    }

    async start(): Promise<void> {
        await this.updateBotStatus('running');
        const ticker = await this.exchange.getTicker(this.bot.pair);
        this.lastPrice = ticker.lastPrice;
        await this.placeInitialGrid(ticker.lastPrice);
    }

    private async placeInitialGrid(currentPrice: number) {
        const totalCapital = this.config.investment * this.config.leverage;
        const amountPerLevel = totalCapital / this.config.gridQuantity;

        for (const price of this.gridLevels) {
            let side: 'buy' | 'sell' | null = null;
            if (this.config.strategyType === 'LONG') {
                side = price < currentPrice ? 'buy' : 'sell';
            } else if (this.config.strategyType === 'SHORT') {
                side = price > currentPrice ? 'sell' : 'buy';
            } else {
                if (price < currentPrice) side = 'buy';
                else if (price > currentPrice) side = 'sell';
            }
            if (side) {
                await this.placeGridOrder(side, price, amountPerLevel / price);
            }
        }
    }

    private async placeGridOrder(side: 'buy' | 'sell', price: number, amount: number) {
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
        } catch (e) {
            console.error(`[FuturesGrid] Level placement failed at ${price}:`, e);
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

        if (this.config.gridMode === 'ARITHMETIC') {
            if (this.config.trailingUp && price > (this.currentHighPrice + this.gridStepValue)) {
                await this.handleTrailingUp();
            }
            if (this.config.trailingDown && price < (this.currentLowPrice - this.gridStepValue)) {
                await this.handleTrailingDown();
            }
        }

        if (this.config.takeProfit && price >= this.config.takeProfit) await this.stop('MARKET_SELL');
        if (this.config.stopLoss && price <= this.config.stopLoss) await this.stop('MARKET_SELL');
    }

    private async handleTrailingUp() {
        this.gridLevels.sort((a, b) => a - b);
        const lowestLevel = this.gridLevels[0];

        for (const [id, order] of this.activeOrders.entries()) {
            if (Math.abs(order.price - lowestLevel) / lowestLevel < 0.001) {
                await this.exchange.cancelOrder(id, this.bot.pair).catch(() => { });
                this.activeOrders.delete(id);
                try {
                    const fill = await this.exchange.createOrder({
                        userId: this.bot.userId,
                        botId: this.bot.id,
                        pair: this.bot.pair,
                        side: 'buy',
                        type: 'market',
                        amount: order.amount
                    });
                    this.currentPositionSize += fill.amount;
                    await this.recordTrade(fill);
                } catch (e) { }
                break;
            }
        }

        this.gridLevels.shift();
        const newHigh = this.currentHighPrice + this.gridStepValue;
        this.gridLevels.push(newHigh);
        this.currentLowPrice += this.gridStepValue;
        this.currentHighPrice = newHigh;

        const amountPerLevel = (this.config.investment * this.config.leverage) / this.config.gridQuantity;
        await this.placeGridOrder('sell', newHigh, amountPerLevel / newHigh);
    }

    private async handleTrailingDown() {
        this.gridLevels.sort((a, b) => a - b);
        const highestLevel = this.gridLevels[this.gridLevels.length - 1];

        for (const [id, order] of this.activeOrders.entries()) {
            if (Math.abs(order.price - highestLevel) / highestLevel < 0.001) {
                await this.exchange.cancelOrder(id, this.bot.pair).catch(() => { });
                this.activeOrders.delete(id);
                try {
                    const fill = await this.exchange.createOrder({
                        userId: this.bot.userId,
                        botId: this.bot.id,
                        pair: this.bot.pair,
                        side: 'sell',
                        type: 'market',
                        amount: order.amount
                    });
                    this.currentPositionSize -= fill.amount;
                    await this.recordTrade(fill);
                } catch (e) { }
                break;
            }
        }

        this.gridLevels.pop();
        const newLow = this.currentLowPrice - this.gridStepValue;
        this.gridLevels.unshift(newLow);
        this.currentLowPrice = newLow;
        this.currentHighPrice -= this.gridStepValue;

        const amountPerLevel = (this.config.investment * this.config.leverage) / this.config.gridQuantity;
        await this.placeGridOrder('buy', newLow, amountPerLevel / newLow);
    }

    async onOrderFilled(order: TradeOrder): Promise<void> {
        this.activeOrders.delete(order.id);
        if (order.side === 'buy') this.currentPositionSize += order.amount;
        else this.currentPositionSize -= order.amount;

        await this.recordTrade(order);

        if (this.isPaused) return;

        const gridIndex = this.gridLevels.findIndex(p => Math.abs(p - order.price) / p < 0.001);
        if (gridIndex === -1) return;

        if (order.side === 'buy') {
            if (gridIndex + 1 < this.gridLevels.length) {
                const sellPrice = this.gridLevels[gridIndex + 1];
                await this.placeGridOrder('sell', sellPrice, order.amount);
            }
        } else {
            if (gridIndex - 1 >= 0) {
                const buyPrice = this.gridLevels[gridIndex - 1];
                await this.placeGridOrder('buy', buyPrice, order.amount);
            }
        }
    }

    async increaseInvestment(amount: number): Promise<void> {
        console.log(`[FuturesGrid] Increasing investment by ${amount}. Re-allocating orders...`);
        await this.cancelAllActiveOrders();
        await super.increaseInvestment(amount);
        const ticker = await this.exchange.getTicker(this.bot.pair);
        await this.placeInitialGrid(ticker.lastPrice);
    }
}

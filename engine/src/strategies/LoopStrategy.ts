import { BaseStrategy } from './BaseStrategy';
import { LoopConfig } from '../types/strategyConfig';
import { TradeOrder } from '@trading-tower/shared';

export class LoopStrategy extends BaseStrategy<LoopConfig> {
    private activeOrders: Map<string, TradeOrder> = new Map();
    private orderMap: Map<string, number> = new Map();

    async initialize(): Promise<void> {
        console.log(`[LoopBot] Initialized for ${this.bot.pair}`);
    }

    async start(): Promise<void> {
        await this.updateBotStatus('running');
        const ticker = await this.exchange.getTicker(this.bot.pair);
        this.lastPrice = ticker.lastPrice;

        const investmentPerSlice = this.config.investment / this.config.orderCount;

        for (let i = 0; i < this.config.orderCount; i++) {
            const drop = (i + 1) * this.config.orderDistance;
            const price = ticker.lastPrice * (1 - drop / 100);

            if (price < this.config.lowPrice) break;
            await this.placeBuy(price, investmentPerSlice / price);
        }
    }

    private async placeBuy(price: number, amount: number) {
        if (this.isPaused) return;
        try {
            const order = await this.exchange.createOrder({
                userId: this.bot.userId,
                botId: this.bot.id,
                pair: this.bot.pair,
                side: 'buy',
                type: 'limit',
                price,
                amount
            });
            this.activeOrders.set(order.id, order);
        } catch (e) {
            console.error(`[LoopBot] Failed to place buy at ${price}:`, e);
        }
    }

    private async placeSell(buyOrder: TradeOrder) {
        if (this.isPaused) return;
        const tpMultiplier = 1 + (this.config.takeProfit || 1) / 100;
        const sellPrice = buyOrder.price * tpMultiplier;

        try {
            const order = await this.exchange.createOrder({
                userId: this.bot.userId,
                botId: this.bot.id,
                pair: this.bot.pair,
                side: 'sell',
                type: 'limit',
                price: sellPrice,
                amount: buyOrder.amount
            });
            this.activeOrders.set(order.id, order);
            this.orderMap.set(order.id, buyOrder.price);
        } catch (e) {
            console.error(`[LoopBot] Failed to place sell at ${sellPrice}:`, e);
        }
    }

    protected async cancelAllActiveOrders() {
        for (const id of this.activeOrders.keys()) {
            await this.exchange.cancelOrder(id, this.bot.pair).catch(() => { });
        }
        this.activeOrders.clear();
        this.orderMap.clear();
    }

    async onPriceUpdate(price: number): Promise<void> {
        this.lastPrice = price;
    }

    async onOrderFilled(order: TradeOrder): Promise<void> {
        this.activeOrders.delete(order.id);
        await this.recordTrade(order);

        if (this.isPaused) return;

        if (order.side === 'buy') {
            await this.placeSell(order);
        } else {
            const originalBuyPrice = this.orderMap.get(order.id);
            if (originalBuyPrice) {
                this.orderMap.delete(order.id);
                await this.placeBuy(originalBuyPrice, order.amount);
            }
        }
    }
}

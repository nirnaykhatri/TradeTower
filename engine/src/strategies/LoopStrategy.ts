import { BaseStrategy } from './BaseStrategy';
import { LoopConfig } from '../types/strategyConfig';
import { TradeOrder } from '@trading-tower/shared';

export class LoopStrategy extends BaseStrategy<LoopConfig> {
    private activeOrders: Map<string, TradeOrder> = new Map();
    // Maps SellOrder ID -> Original Buy Price (to recreate the loop)
    private orderMap: Map<string, number> = new Map();

    async initialize(): Promise<void> {
        console.log(`[LoopBot] Initialized for ${this.bot.pair}`);
    }

    async start(): Promise<void> {
        await this.updateBotStatus('running');
        const ticker = await this.exchange.getTicker(this.bot.pair);
        this.lastPrice = ticker.lastPrice;

        const investmentPerSlice = this.config.investment / this.config.orderCount;

        // Place initial buy orders below market
        for (let i = 0; i < this.config.orderCount; i++) {
            const drop = (i + 1) * this.config.orderDistance;
            const price = ticker.lastPrice * (1 - drop / 100);

            if (price < this.config.lowPrice) break;

            // Loop bot places LIMIT BUYS
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
        // Trailing Up Logic (Simulated for Loop)
        // If price moves up past the current grid range, we could theoretically move the grid up
        // However, standard LOOP logic is fixed-range recurring trades.
        // We will stick to the core "Buy Low -> Sell High -> Re-Buy Low" loop.
    }

    async onOrderFilled(order: TradeOrder): Promise<void> {
        this.activeOrders.delete(order.id);
        const profit = this.calculateTradeProfit(order);

        // Reinvestment Logic
        if (order.side === 'sell' && this.config.reinvestProfit && profit > 0) {
            // For LOOP, reinvestment usually means increasing the order size of the next BUY
            // We will handle this by adding profit to the original amount
            console.log(`[LoopBot] Reinvesting profit: ${profit}`);
            // Note: In a real loop, you'd calculate the new amount based on (originalCost + profit) / originalPrice
        }

        if (order.side === 'sell' && profit > 0) {
            this.bot.performance.botProfit += profit;
            this.bot.performance.realizedPnL += profit;
        }

        // Count trades
        this.bot.performance.totalTrades++;

        await this.recordTrade(order);

        if (this.isPaused) return;

        if (order.side === 'buy') {
            // Cycle Step 1 Complete: Bought Low -> Place Sell High
            await this.placeSell(order);
        } else {
            // Cycle Step 2 Complete: Sold High -> Re-place Buy Low (The Loop)
            const originalBuyPrice = this.orderMap.get(order.id);
            if (originalBuyPrice) {
                this.orderMap.delete(order.id);

                // Calculate new amount if reinvesting
                let newAmount = order.amount;
                if (this.config.reinvestProfit) {
                    const tradeRevenue = order.amount * order.price;
                    const tradeCost = order.amount * originalBuyPrice;
                    const tradeProfit = tradeRevenue - tradeCost;
                    newAmount = (tradeCost + tradeProfit) / originalBuyPrice;
                }

                await this.placeBuy(originalBuyPrice, newAmount);
            }
        }
    }

    private calculateTradeProfit(order: TradeOrder): number {
        if (order.side === 'buy') return 0;
        const buyPrice = this.orderMap.get(order.id);
        if (!buyPrice) return 0;
        return (order.price - buyPrice) * order.amount;
    }
}

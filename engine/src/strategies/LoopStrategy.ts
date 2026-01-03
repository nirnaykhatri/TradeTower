import { BaseStrategy } from './BaseStrategy';
import { LoopConfig } from '../types/strategyConfig';
import { TradeOrder } from '@trading-tower/shared';
import { PRICE_TOLERANCE } from '../constants/strategy.constants';

/**
 * Loop Strategy (Recurring Buy/Sell Grid)
 * 
 * Implements a recurring trading loop that continuously buys at lower prices
 * and sells at higher prices within a defined range. The strategy divides
 * capital into multiple orders placed at regular intervals below the market.
 * 
 * When a buy order fills, a corresponding sell order is placed at a target
 * profit level. Once the sell completes, the loop repeats by placing a new
 * buy order at the same price, effectively creating a cycle.
 * 
 * Key Features:
 * - Fixed-range grid-based buy orders
 * - Individual profit targets per buy
 * - Reinvestment option to compound profits
 * - Continuous cycling until manual stop
 */
export class LoopStrategy extends BaseStrategy<LoopConfig> {
    private activeOrders: Map<string, TradeOrder> = new Map();
    // Maps SellOrder ID -> Original Buy Price (to recreate the loop)
    private orderMap: Map<string, number> = new Map();

    /**
     * Get active orders currently managed by this strategy
     * @returns Map of active orders indexed by order ID
     */
    getActiveOrders(): Map<string, TradeOrder> {
        return this.activeOrders;
    }

    /**
     * Initialize the Loop strategy
     * @returns Promise<void>
     */
    async initialize(): Promise<void> {
        console.log(`[LoopBot] Initialized for ${this.bot.pair}`);
    }

    /**
     * Start the loop strategy by placing initial grid of buy orders
     * @returns Promise<void>
     */
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

    /**
     * Place a buy order at the specified price and amount
     * @param price Order price
     * @param amount Order amount
     * @returns Promise<void>
     */
    private async placeBuy(price: number, amount: number): Promise<void> {
        if (this.isPaused) return;
        try {
            const order = await this.executeOrderWithRetry({
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
            await this.handleStrategyError(e as Error, 'placeBuy');
        }
    }

    /**
     * Place a sell order for the corresponding buy order at profit target
     * @param buyOrder The buy order to pair with sell
     * @returns Promise<void>
     */
    private async placeSell(buyOrder: TradeOrder): Promise<void> {
        if (this.isPaused) return;
        const tpMultiplier = 1 + (this.config.takeProfit || 1) / 100;
        const sellPrice = buyOrder.price * tpMultiplier * (1 + this.feeBuffer * 2);

        try {
            const order = await this.executeOrderWithRetry({
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
            await this.handleStrategyError(e as Error, 'placeSell');
        }
    }

    /**
     * Cancel all active orders and clear tracking maps
     * @returns Promise<void>
     */
    protected async cancelAllActiveOrders(): Promise<void> {
        for (const id of this.activeOrders.keys()) {
            await this.cancelOrderWithRetry(id, this.bot.pair).catch(() => { });
        }
        this.activeOrders.clear();
        this.orderMap.clear();
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
        // Trailing Up Logic (Simulated for Loop)
        // If price moves up past the current grid range, we could theoretically move the grid up
        // However, standard LOOP logic is fixed-range recurring trades.
        // We will stick to the core "Buy Low -> Sell High -> Re-Buy Low" loop.
    }

    /**
     * Handle order filled events with profit calculation and loop cycling
     * Updates performance metrics and creates the next order in the loop cycle
     * 
     * @param order The filled TradeOrder
     * @returns Promise<void>
     */
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
            order.profit = profit;
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
                    const reinvestPercent = this.config.reinvestProfitPercent ?? 100;
                    const reinvestProfit = tradeProfit * (reinvestPercent / 100);
                    newAmount = (tradeCost + reinvestProfit) / originalBuyPrice;
                }

                await this.placeBuy(originalBuyPrice, newAmount);
            }
        }
    }

    /**
     * Calculate profit for a sell order based on original buy price
     * @param order The sell order to calculate profit for
     * @returns Profit amount in quote currency
     */
    private calculateTradeProfit(order: TradeOrder): number {
        if (order.side === 'buy') return 0;
        const buyPrice = this.orderMap.get(order.id);
        if (!buyPrice) return 0;
        return (order.price - buyPrice) * order.amount;
    }

    /**
     * Handle order cancellation event from WebSocket
     * Removes the cancelled order from activeOrders and orderMap tracking
     * @param orderId The exchange order ID
     * @param pair The trading pair
     */
    async onOrderCancelled(orderId: string, pair: string): Promise<void> {
        const wasActive = this.activeOrders.delete(orderId);
        const wasInOrderMap = this.orderMap.delete(orderId);
        
        if (wasActive || wasInOrderMap) {
            console.log(
                `[Bot ${this.bot.id}] Loop order ${orderId} cancelled and removed from tracking`
            );
        } else {
            console.log(`[Bot ${this.bot.id}] Cancelled order ${orderId} not found in tracking maps`);
        }
    }
}

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
/**
 * Grid level state for tracking buy/sell orders at specific price levels
 */
interface GridLevel {
    price: number;
    buyOrderId?: string;
    sellOrderId?: string;
    amount: number;
}

export class LoopStrategy extends BaseStrategy<LoopConfig> {
    private activeOrders: Map<string, TradeOrder> = new Map();
    // Maps SellOrder ID -> Original Buy Price (to recreate the loop)
    private orderMap: Map<string, number> = new Map();
    // Fixed entry price that anchors the entire grid (set at launch, never changes)
    private entryPrice: number = 0;
    // Grid structure: price level -> GridLevel state
    private gridLevels: Map<number, GridLevel> = new Map();
    // Track all price levels that have ever existed (for gap detection)
    // Limited to prevent unbounded growth (max ~200 levels for typical grid)
    private allKnownLevels: Set<number> = new Set();
    private readonly MAX_KNOWN_LEVELS = 500; // Safety limit to prevent memory leak

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
        
        // Set fixed entry price (anchor for entire grid)
        this.entryPrice = ticker.lastPrice;
        console.log(`[LoopBot] Entry Price set to: ${this.entryPrice}`);

        const investmentPerSlice = this.config.investment / this.config.orderCount;

        // Initialize grid structure and place initial buy orders below entry price
        for (let i = 0; i < this.config.orderCount; i++) {
            const drop = (i + 1) * this.config.orderDistance;
            const price = this.entryPrice * (1 - drop / 100);

            if (price < this.config.lowPrice) break;

            // Initialize grid level
            const amount = investmentPerSlice / price;
            this.gridLevels.set(price, {
                price,
                amount
            });
            // Track this level as known
            this.allKnownLevels.add(price);

            // Place initial buy order at this level
            await this.placeBuy(price, amount);
        }
        
        // Initialize sell orders above entry price
        for (let i = 0; i < this.config.orderCount; i++) {
            const rise = (i + 1) * this.config.orderDistance;
            const price = this.entryPrice * (1 + rise / 100);

            if (this.config.highPrice && price > this.config.highPrice) break;

            // Track this level as known (with safety limit check)
            if (this.allKnownLevels.size < this.MAX_KNOWN_LEVELS) {
                this.allKnownLevels.add(price);
            }

            // Place initial sell order at this level
            // For initial sells, use entryPrice as "buy price" for profit calculation
            await this.placeSell(investmentPerSlice / this.entryPrice, price, this.entryPrice);
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
            
            // Update grid level with buy order ID
            const gridLevel = this.gridLevels.get(price);
            if (gridLevel) {
                gridLevel.buyOrderId = order.id;
            }
        } catch (e) {
            await this.handleStrategyError(e as Error, 'placeBuy');
        }
    }

    /**
     * Place a sell order - prioritizes filling gaps before expanding upward
     * @param amount Order amount
     * @param targetPrice Optional specific price to place order at
     * @param buyPrice The original buy price for profit calculation
     * @returns Promise<void>
     */
    private async placeSell(amount: number, targetPrice?: number, buyPrice?: number): Promise<void> {
        if (this.isPaused) return;
        
        const sellPrice = targetPrice || this.calculateNextSellPrice();

        try {
            const order = await this.executeOrderWithRetry({
                userId: this.bot.userId,
                botId: this.bot.id,
                pair: this.bot.pair,
                side: 'sell',
                type: 'limit',
                price: sellPrice,
                amount
            });
            this.activeOrders.set(order.id, order);
            // Track buy price for profit calculation
            if (buyPrice) {
                this.orderMap.set(order.id, buyPrice);
            }
        } catch (e) {
            await this.handleStrategyError(e as Error, 'placeSell');
        }
    }

    /**
     * Calculate next sell price: fill gaps first, then expand upward
     * @returns The price level for the next sell order
     */
    private calculateNextSellPrice(): number {
        // Get all sell levels (above entry) that currently have active orders
        const activeSellLevels = Array.from(this.activeOrders.values())
            .filter(order => order.side === 'sell')
            .map(order => order.price)
            .sort((a, b) => a - b); // Sort ascending
        
        // Find gaps: known levels above entry that don't have active orders
        const sellGaps = Array.from(this.allKnownLevels)
            .filter(level => level > this.entryPrice)
            .filter(level => !activeSellLevels.includes(level))
            .sort((a, b) => b - a); // Sort descending (farthest from entry first)
        
        if (sellGaps.length > 0) {
            // Fill gap farthest from entry (highest price gap)
            console.log(`[LoopBot] Filling sell gap at ${sellGaps[0].toFixed(8)}`);
            return sellGaps[0];
        }
        
        // No gaps - expand upward
        const highestSell = activeSellLevels[activeSellLevels.length - 1] || this.entryPrice;
        const nextPrice = highestSell * (1 + this.config.orderDistance / 100);
        
        // Track new level with safety limit
        if (this.allKnownLevels.size < this.MAX_KNOWN_LEVELS) {
            this.allKnownLevels.add(nextPrice);
        } else {
            console.warn(`[LoopBot] Reached max known levels (${this.MAX_KNOWN_LEVELS}), not tracking new level`);
        }
        
        console.log(`[LoopBot] Expanding sell grid upward to ${nextPrice.toFixed(8)}`);
        return nextPrice;
    }

    /**
     * Calculate next buy price: fill gaps first, then expand downward
     * @returns The price level for the next buy order
     */
    private calculateNextBuyPrice(): number {
        // Get all buy levels (below entry) that currently have active orders
        const activeBuyLevels = Array.from(this.activeOrders.values())
            .filter(order => order.side === 'buy')
            .map(order => order.price)
            .sort((a, b) => b - a); // Sort descending
        
        // Find gaps: known levels below entry that don't have active orders
        const buyGaps = Array.from(this.allKnownLevels)
            .filter(level => level < this.entryPrice)
            .filter(level => !activeBuyLevels.includes(level))
            .sort((a, b) => a - b); // Sort ascending (farthest from entry first)
        
        if (buyGaps.length > 0) {
            // Fill gap farthest from entry (lowest price gap)
            console.log(`[LoopBot] Filling buy gap at ${buyGaps[0].toFixed(8)}`);
            return buyGaps[0];
        }
        
        // No gaps - expand downward
        const lowestBuy = activeBuyLevels[activeBuyLevels.length - 1] || this.entryPrice;
        const nextPrice = lowestBuy * (1 - this.config.orderDistance / 100);
        
        // Check boundary
        if (nextPrice < this.config.lowPrice) {
            console.log(`[LoopBot] Cannot expand below lowPrice ${this.config.lowPrice}`);
            return lowestBuy; // Return current lowest as fallback
        }
        
        // Track new level with safety limit
        if (this.allKnownLevels.size < this.MAX_KNOWN_LEVELS) {
            this.allKnownLevels.add(nextPrice);
        } else {
            console.warn(`[LoopBot] Reached max known levels (${this.MAX_KNOWN_LEVELS}), not tracking new level`);
        }
        
        console.log(`[LoopBot] Expanding buy grid downward to ${nextPrice.toFixed(8)}`);
        return nextPrice;
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
        this.gridLevels.clear();
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
     * 
     * Gap-Filling Priority Logic:
     * - BUY fills → Place SELL (fills gaps first, then expands upward)
     * - SELL fills → Place BUY (fills gaps first, then expands downward)
     * 
     * Gaps = price levels that previously had orders but are now empty.
     * Grid only expands when no gaps exist on that side.
     * Total order count remains constant.
     * 
     * @param order The filled TradeOrder
     * @returns Promise<void>
     */
    async onOrderFilled(order: TradeOrder): Promise<void> {
        this.activeOrders.delete(order.id);
        
        // Calculate profit for sell orders
        const profit = this.calculateTradeProfit(order);
        if (order.side === 'sell' && profit > 0) {
            this.bot.performance.botProfit += profit;
            order.profit = profit;
        }

        // Count trades
        this.bot.performance.totalTrades++;
        await this.recordTrade(order);

        if (this.isPaused) return;

        if (order.side === 'buy') {
            // BUY ORDER FILLED: Place sell (gap-fill priority)
            // Use the buy order's price as the buyPrice for profit calculation
            await this.placeSell(order.amount, undefined, order.price);
        } else {
            // SELL ORDER FILLED: Place buy (gap-fill priority)
            const originalBuyPrice = this.orderMap.get(order.id);
            this.orderMap.delete(order.id);

            // Calculate new amount with reinvestment
            let newAmount = order.amount;
            if (this.config.reinvestProfit && profit > 0 && originalBuyPrice) {
                const tradeRevenue = order.amount * order.price;
                const tradeCost = order.amount * originalBuyPrice;
                const tradeProfit = tradeRevenue - tradeCost;
                const reinvestPercent = this.config.reinvestProfitPercent ?? 100;
                const reinvestProfit = tradeProfit * (reinvestPercent / 100);
                newAmount = (tradeCost + reinvestProfit) / originalBuyPrice;
                
                console.log(`[LoopBot] Reinvesting ${reinvestPercent}% of profit ${tradeProfit.toFixed(4)} -> new amount: ${newAmount.toFixed(4)}`);
            }

            const nextBuyPrice = this.calculateNextBuyPrice();
            await this.placeBuy(nextBuyPrice, newAmount);
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
     * Removes the cancelled order from activeOrders, orderMap, and grid level tracking
     * @param orderId The exchange order ID
     * @param pair The trading pair
     */
    async onOrderCancelled(orderId: string, pair: string): Promise<void> {
        const order = this.activeOrders.get(orderId);
        const wasActive = this.activeOrders.delete(orderId);
        const wasInOrderMap = this.orderMap.delete(orderId);
        
        // Clear from grid level tracking
        if (order) {
            for (const gridLevel of this.gridLevels.values()) {
                if (gridLevel.buyOrderId === orderId) {
                    gridLevel.buyOrderId = undefined;
                }
                if (gridLevel.sellOrderId === orderId) {
                    gridLevel.sellOrderId = undefined;
                }
            }
        }
        
        if (wasActive || wasInOrderMap) {
            console.log(
                `[Bot ${this.bot.id}] Loop order ${orderId} cancelled and removed from tracking`
            );
        } else {
            console.log(`[Bot ${this.bot.id}] Cancelled order ${orderId} not found in tracking maps`);
        }
    }
}

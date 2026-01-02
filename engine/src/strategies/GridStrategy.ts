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
    // gridStepValue stores the percentage step as a decimal (e.g., 1% => 0.01)
    private gridStepValue: number = 0;
    private lastFills: number[] = [];

    constructor(bot: any, exchange: any, config: GridConfig) {
        super(bot, exchange, config);
        this.currentLowPrice = config.lowPrice;
        this.currentHighPrice = config.highPrice;
        // Override default feeBuffer only if not set
        if (this.feeBuffer === 0 && config.feeBuffer === undefined) {
            this.feeBuffer = 0.001; // Grid-specific default: 0.1%
        }
    }

    /**
     * Initialize grid strategy - validates config and calculates grid levels
     */
    async initialize(): Promise<void> {
        validateGridConfig(this.config);
        this.calculateGrid();
    }

    private calculateGrid() {
        this.gridStepValue = this.config.gridStep / 100; // convert percent to decimal
        const ratio = 1 + this.gridStepValue;

        this.gridLevels = [];
        for (let i = 0; i < this.config.gridLevels; i++) {
            this.gridLevels.push(this.currentLowPrice * Math.pow(ratio, i));
        }

        // Align the tracked high price to the last generated grid level for consistency
        this.currentHighPrice = this.gridLevels[this.gridLevels.length - 1];
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
        let buyCount = 0;
        let sellCount = 0;

        for (const price of this.gridLevels) {
            if (price < currentPrice * 0.999) buyCount += 1;
            else if (price > currentPrice * 1.001) sellCount += 1;
        }

        const totalOrders = buyCount + sellCount;
        if (totalOrders === 0) return;

        const investmentPerOrder = this.config.investment / totalOrders;

        for (const price of this.gridLevels) {
            if (price < currentPrice * 0.999) {
                await this.placeOrder('buy', price * (1 - this.feeBuffer), this.getOrderAmount(price, investmentPerOrder));
            } else if (price > currentPrice * 1.001) {
                await this.placeOrder('sell', price * (1 + this.feeBuffer), this.getOrderAmount(price, investmentPerOrder));
            }
        }
    }

    /**
     * Compute order amount based on configured currency (BASE or QUOTE)
     */
    private getOrderAmount(price: number, investmentPerOrder: number): number {
        return this.config.orderSizeCurrency === 'BASE'
            ? investmentPerOrder
            : investmentPerOrder / price;
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

        if (this.config.takeProfitEnabled && this.config.takeProfit) {
            const tpThreshold = this.config.takeProfit * (1 + this.feeBuffer);
            if (price >= tpThreshold) {
            console.log(`[GridBot] Take Profit ${this.config.takeProfit} triggered.`);
            await this.stop('MARKET_SELL');
            return;
            }
        }

        const trailingUpEnabled = this.config.trailingUp || this.config.highPriceTrailing;
        const bandWidth = this.currentHighPrice - this.currentLowPrice;
        const shift = bandWidth * this.gridStepValue; // Option A: additive shift by band * step%
        const upperThreshold = this.currentHighPrice + shift;
        const lowerThreshold = this.currentLowPrice - shift;

        if (trailingUpEnabled && price > upperThreshold) {
            await this.handleTrailingUp();
        }

        if (this.config.trailingDown && price < lowerThreshold) {
            await this.handleTrailingDown();
        }
    }

    /**
     * Modify grid by adding/removing levels at top/bottom without restarting.
     * highLevelsDelta > 0 adds sell levels above; lowLevelsDelta > 0 adds buy levels below.
     * Negative deltas are not supported in this minimal implementation (log and return).
     */
    async modifyGridLevels(lowLevelsDelta: number, highLevelsDelta: number): Promise<void> {
        if (lowLevelsDelta < 0 || highLevelsDelta < 0) {
            console.warn('[GridBot] Removal of levels not supported in this operation. Provide non-negative deltas.');
            return;
        }

        if (lowLevelsDelta === 0 && highLevelsDelta === 0) {
            console.log('[GridBot] No grid level changes requested.');
            return;
        }

        const ratio = 1 + this.gridStepValue;
        const perf = this.bot.performance;
        const perOrderInvestment = this.config.investment / this.config.gridLevels;

        // --- Determine how many buy levels we can afford with available quote ---
        let addLow = lowLevelsDelta;
        let requiredQuote = 0;
        for (let i = 1; i <= lowLevelsDelta; i++) {
            const price = this.currentLowPrice / Math.pow(ratio, i);
            const amount = this.getOrderAmount(price, perOrderInvestment);
            requiredQuote += price * amount;
        }
        while (addLow > 0 && requiredQuote > perf.quoteBalance) {
            // Reduce by one level and recompute requirement
            addLow -= 1;
            requiredQuote = 0;
            for (let i = 1; i <= addLow; i++) {
                const price = this.currentLowPrice / Math.pow(ratio, i);
                const amount = this.getOrderAmount(price, perOrderInvestment);
                requiredQuote += price * amount;
            }
        }
        if (addLow < lowLevelsDelta) {
            console.log(`[GridBot] Insufficient quote balance. Adding only ${addLow}/${lowLevelsDelta} buy levels.`);
        }

        // --- Determine how many sell levels we can afford with available base ---
        let addHigh = highLevelsDelta;
        let requiredBase = 0;
        for (let i = 1; i <= highLevelsDelta; i++) {
            const price = this.currentHighPrice * Math.pow(ratio, i);
            const amount = this.getOrderAmount(price, perOrderInvestment);
            requiredBase += amount;
        }
        while (addHigh > 0 && requiredBase > perf.baseBalance) {
            addHigh -= 1;
            requiredBase = 0;
            for (let i = 1; i <= addHigh; i++) {
                const price = this.currentHighPrice * Math.pow(ratio, i);
                const amount = this.getOrderAmount(price, perOrderInvestment);
                requiredBase += amount;
            }
        }
        if (addHigh < highLevelsDelta) {
            console.log(`[GridBot] Insufficient base balance. Adding only ${addHigh}/${highLevelsDelta} sell levels.`);
        }

        // --- Place new buy levels below ---
        for (let i = addLow; i >= 1; i--) {
            const price = this.currentLowPrice / Math.pow(ratio, i);
            const amount = this.getOrderAmount(price, perOrderInvestment);
            await this.placeOrder('buy', price * (1 - this.feeBuffer), amount);
            this.gridLevels.unshift(price);
        }

        // --- Place new sell levels above ---
        for (let i = 1; i <= addHigh; i++) {
            const price = this.currentHighPrice * Math.pow(ratio, i);
            const amount = this.getOrderAmount(price, perOrderInvestment);
            await this.placeOrder('sell', price * (1 + this.feeBuffer), amount);
            this.gridLevels.push(price);
        }

        // Update tracked bounds and config grid level count
        this.currentLowPrice = this.gridLevels[0];
        this.currentHighPrice = this.gridLevels[this.gridLevels.length - 1];
        this.config.gridLevels = this.gridLevels.length;

        console.log(`[GridBot] Grid modified. Added buy levels=${addLow}, sell levels=${addHigh}. New low=${this.currentLowPrice}, high=${this.currentHighPrice}, levels=${this.config.gridLevels}`);
    }

    /**
     * Professional Increase Investment (Bitsgap Style)
     * Cancels open orders, recalculates sizes with new investment, and re-places orders.
     * Recalculates percent-based metrics per Bitsgap spec.
     */
    async increaseInvestment(amount: number): Promise<void> {
        console.log(`[GridBot] Increasing investment by ${amount}. Recalculating order sizes...`);

        const perf = this.bot.performance;
        const oldInvestment = this.config.investment;
        const newInvestment = oldInvestment + amount;

        // 1) Cancel all active orders (per spec flow)
        await this.cancelAllActiveOrders();

        // 2) Update investment config and balances via base strategy
        this.config.investment = newInvestment;
        await super.increaseInvestment(amount);

        // 3) Re-place orders with updated per-order sizing using current price
        const ticker = await this.exchange.getTicker(this.bot.pair);
        await this.placeInitialOrders(ticker.lastPrice);

        // 4) Recalculate percent-based metrics based on new investment
        if (oldInvestment > 0) {
            perf.totalPnLPercent = (perf.totalPnL / newInvestment) * 100;

            const startTime = new Date(this.bot.createdAt).getTime();
            const now = Date.now();
            const diffDays = (now - startTime) / (1000 * 60 * 60 * 24);
            if (diffDays > 0.01) {
                perf.annualizedReturn = (perf.totalPnLPercent / diffDays) * 365;
            }

            console.log(`[GridBot] Metrics recalculated. Old investment: ${oldInvestment}, New: ${newInvestment}, New ROI: ${perf.totalPnLPercent.toFixed(2)}%`);
        }
    }

    /**
     * Handle trailing up - shifts grid range upward
     * Per gridbot.md: Cancels lowest buy order and places new sell order at top
     */
    private async handleTrailingUp() {
        console.log(`[GridBot] Trailing Up - Canceling lowest buy, placing new sell at top`);
        
        // Find and cancel the lowest buy order
        let lowestBuyOrder: TradeOrder | null = null;
        let lowestPrice = Infinity;
        
        for (const [id, order] of this.buyOrders) {
            if (order.price < lowestPrice) {
                lowestPrice = order.price;
                lowestBuyOrder = order;
            }
        }
        
        if (lowestBuyOrder) {
            try {
                await this.exchange.cancelOrder(lowestBuyOrder.id, this.bot.pair);
                this.buyOrders.delete(lowestBuyOrder.id);
                console.log(`[GridBot] Canceled lowest buy order at ${lowestBuyOrder.price}`);
            } catch (error) {
                console.error(`[GridBot] Failed to cancel lowest buy order:`, error);
                return;
            }
        }

        // Shift grid range up by one step
        const bandWidth = this.currentHighPrice - this.currentLowPrice;
        const shift = bandWidth * this.gridStepValue;
        this.currentLowPrice += shift;
        this.currentHighPrice += shift;

        // Recompute grid levels
        this.calculateGrid();
        
        // Place new sell order at the new top level
        const newTopPrice = this.gridLevels[this.gridLevels.length - 1];
        const orderAmount = lowestBuyOrder ? lowestBuyOrder.amount : this.getOrderAmount(newTopPrice, this.config.investment / this.config.gridLevels);
        await this.placeOrder('sell', newTopPrice * (1 + this.feeBuffer), orderAmount);
        console.log(`[GridBot] Placed new sell order at ${newTopPrice}`);
    }

    /**
     * Handle trailing down - extends grid downward per Bitsgap spec
     * Does NOT cancel orders - keeps existing sell orders and extends grid below
     * Places market buy orders and new sell orders to extend the grid
     */
    private async handleTrailingDown() {
        console.log(`[GridBot] Trailing Down - Extending grid below`);
        
        // Check if we've reached the stop trailing down price
        if (this.config.stopTrailingDownPrice && this.lastPrice <= this.config.stopTrailingDownPrice) {
            console.log(`[GridBot] Stop Trailing Down Price ${this.config.stopTrailingDownPrice} reached. Halting trail.`);
            return;
        }

        // Calculate new lower grid level (one step below current lowest)
        const newLowPrice = this.currentLowPrice * (1 - this.gridStepValue);
        
        // Calculate order size for the new level
        const investmentPerOrder = this.config.investment / this.config.gridLevels;
        const orderAmount = this.getOrderAmount(newLowPrice, investmentPerOrder);
        
        // Check available quote balance for market buy
        const perf = this.bot.performance;
        const requiredQuote = newLowPrice * orderAmount;
        
        if (perf.quoteBalance < requiredQuote) {
            console.log(`[GridBot] Insufficient quote balance (${perf.quoteBalance}) for trailing down. Required: ${requiredQuote}`);
            return;
        }
        
        try {
            // 1. Place MARKET BUY order to acquire base currency
            console.log(`[GridBot] Placing market buy order for ${orderAmount} at market price`);
            const marketBuyOrder = await this.exchange.createOrder({
                userId: this.bot.userId,
                botId: this.bot.id,
                pair: this.bot.pair,
                side: 'buy',
                type: 'market',
                price: this.lastPrice, // Market orders use current price
                amount: orderAmount
            });
            
            // Update balances for market buy
            const cost = marketBuyOrder.price * marketBuyOrder.amount;
            perf.baseBalance += marketBuyOrder.amount;
            perf.quoteBalance -= cost;
            
            // Record the market buy fee
            marketBuyOrder.fee = cost * this.feeBuffer;
            perf.botProfit -= marketBuyOrder.fee;
            await this.recordTrade(marketBuyOrder);
            
            // 2. Place new SELL order at the new lower grid level
            console.log(`[GridBot] Placing sell order at new lower level ${newLowPrice}`);
            await this.placeOrder('sell', newLowPrice * (1 + this.feeBuffer), orderAmount);
            
            // 3. Extend the grid range downward (keeping existing sell orders)
            this.currentLowPrice = newLowPrice;
            this.gridLevels.unshift(newLowPrice); // Add to beginning of array
            
            console.log(`[GridBot] Grid extended down. New low: ${this.currentLowPrice}, Grid levels: ${this.gridLevels.length}`);
            
        } catch (error) {
            console.error(`[GridBot] Failed to extend grid down:`, error);
        }
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

            // Calculate and record buy fee
            order.fee = order.price * order.amount * this.feeBuffer;
            
            // Deduct buy fee from botProfit immediately (per gridbot.md)
            perf.botProfit -= order.fee;
            
            // Record buy order in database with fee information
            await this.recordTrade(order);
        } else {
            // Match against fee-adjusted sell prices
            const adjustedGridLevels = this.gridLevels.map(p => p * (1 + this.feeBuffer));
            const gridIndex = adjustedGridLevels.findIndex(p => Math.abs(p - order.price) / p < PRICE_TOLERANCE);
            
            if (gridIndex > 0) {
                const buyLevelPrice = this.gridLevels[gridIndex - 1];
                const sellFee = order.price * order.amount * this.feeBuffer;
                const grossProfit = (order.price - buyLevelPrice) * order.amount;
                
                // Buy fee was already deducted when buy order filled
                // So profit calculation: gross profit - sell fee only
                const netProfit = grossProfit - sellFee;

                order.fee = sellFee;
                order.profit = netProfit;

                // Update botProfit with gross profit minus sell fee
                // (buy fee was already deducted)
                perf.botProfit += netProfit;
            }

            perf.baseBalance -= order.amount;
            perf.quoteBalance += (order.amount * order.price);
            
            // Record sell order in database
            await this.recordTrade(order);
        }

        if (this.isPaused) return;

        // Find grid index using fee-adjusted prices
        let gridIndex = -1;
        if (order.side === 'buy') {
            // Match buy order against fee-adjusted buy prices
            const adjustedBuyLevels = this.gridLevels.map(p => p * (1 - this.feeBuffer));
            gridIndex = adjustedBuyLevels.findIndex(p => Math.abs(p - order.price) / p < PRICE_TOLERANCE);
        } else {
            // Match sell order against fee-adjusted sell prices
            const adjustedSellLevels = this.gridLevels.map(p => p * (1 + this.feeBuffer));
            gridIndex = adjustedSellLevels.findIndex(p => Math.abs(p - order.price) / p < PRICE_TOLERANCE);
        }
        
        if (gridIndex === -1) return;

        if (order.side === 'buy') {
            if (gridIndex + 1 < this.gridLevels.length) {
                const sellPrice = this.gridLevels[gridIndex + 1];
                await this.placeOrder('sell', sellPrice * (1 + this.feeBuffer), order.amount);
            }
        } else {
            if (gridIndex - 1 >= 0) {
                const buyPrice = this.gridLevels[gridIndex - 1];
                await this.placeOrder('buy', buyPrice * (1 - this.feeBuffer), order.amount);
            }
        }
    }
}

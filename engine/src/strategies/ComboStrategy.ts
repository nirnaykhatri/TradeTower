import { DCAFuturesStrategy } from './DCAFuturesStrategy';
import { ComboConfig } from '../types/strategyConfig';
import { TradeOrder } from '@trading-tower/shared';
import { PRICE_TOLERANCE } from '../constants/strategy.constants';

/**
 * Combo Bot Strategy (DCA Entry + Grid Exit)
 * 
 * Implements Bitsgap's COMBO Bot specification:
 * https://bitsgap.com/helpdesk/article/18026929618844-What-is-COMBO-Bot
 * 
 * COMBO combines two distinct order management phases:
 * 
 * 1. **DCA Entry Phase** (inherited from DCAFuturesStrategy):
 *    - Places base order at trigger condition (IMMEDIATELY, PRICE_CHANGE, or MANUAL)
 *    - Places safety orders to average down/up with each drop/rise
 *    - Uses `averagingOrdersStep` to space safety orders
 *    - Uses `averagingOrdersQuantity` to limit number of safety orders
 *    - Stops when max orders or position size reached
 * 
 * 2. **Grid Exit Phase** (profit-taking grid):
 *    - Triggered on first entry fill
 *    - Places multiple grid orders to distribute exit across price levels
 *    - Uses `gridStep` (same % spacing as DCA step in most cases)
 *    - Uses `gridLevels` to define number of exit orders
 *    - Grid is recalculated after each averaging (entry fill)
 * 
 * **Price Range Logic** (per Bitsgap):
 * - LONG:  Buys below/at highPrice (DCA zone), sells above highPrice (Grid zone)
 * - SHORT: Sells above/at lowPrice (DCA zone), buys below lowPrice (Grid zone)
 * 
 * **Trailing Stop Loss** (enabled by default):
 * - Automatically follows favorable price movement
 * - LONG: Tracks highest price, stops if price falls by trailingStopPercent
 * - SHORT: Tracks lowest price, stops if price rises by trailingStopPercent
 * 
 * **Position Closure**:
 * - When Take Profit % or price level is hit → close entire position
 * - When Stop Loss % or price level is hit → close entire position
 * - When trailing stop is triggered → close entire position
 * - Closure is done with MARKET order to ensure execution
 * 
 * **CSV Execution Pattern** (from real bot logs):
 * - Initial: All DCA buy orders + All grid sell orders placed simultaneously
 * - Fill 1: Entry filled → Grid recalculated if position size changed
 * - Fill 2-N: More entries fill, grid continues distributing exit
 * - Final: On TP/SL, all orders canceled, position closed with market order
 */
/**
 * Grid level execution state for tracking fills and trailing
 */
interface GridLevelState {
    price: number;
    amount: number;
    lastFillTime: Date;
    executionCount: number;
}

/**
 * Grid order tracking with level information
 */
interface GridOrderInfo {
    order: TradeOrder;
    levelNumber: number;
    trailingCount: number;
}

/**
 * DCA order tracking with placement metadata
 */
interface DCAOrderInfo {
    order: TradeOrder;
    price: number;
    amount: number;
    isTrailingPlaced: boolean;
}

export class ComboStrategy extends DCAFuturesStrategy {
    /** Grid orders for profit taking */
    private profitGridOrders: Map<string, TradeOrder> = new Map();
    
    /** Highest price reached for trailing stop loss (LONG positions) */
    private highestPrice: number = Number.NEGATIVE_INFINITY;
    
    /** Lowest price reached for trailing stop loss (SHORT positions) */
    private lowestPrice: number = Number.POSITIVE_INFINITY;
    
    /** Current trailing stop loss price */
    private trailingStopPrice: number = 0;

    // ========== NEW: Trailing State Tracking ==========
    
    /** Track executed grid levels for trailing down reference */
    private executedGridLevels: Map<number, GridLevelState> = new Map();
    
    /** Active grid orders with level metadata */
    private activeGridOrders: Map<string, GridOrderInfo> = new Map();
    
    /** Active DCA orders with trailing metadata */
    private activeDCAOrders: Map<string, DCAOrderInfo> = new Map();
    
    /** Track DCA prices that have been filled */
    private executedDCAPrices: number[] = [];
    
    /** Last grid order fill price for trailing down detection */
    private lastGridFillPrice: number = 0;
    
    /** Last DCA fill price for tracking */
    private lastDCAFillPrice: number = 0;
    
    /** Current position average price (DCA price) */
    private currentPositionAvgPrice: number = 0;
    
    /** Trailing down triggered flag */
    private trailingDownTriggered: boolean = false;
    
    /** Grid suspended due to insufficient gap */
    private gridSuspended: boolean = false;
    
    /** Base order size for volume calculations */
    private baseOrderSize: number = 0;
    
    /** Current grid amount per level (recalculated after DCA fills) */
    private currentGridAmount: number = 0;

    /**
     * Get active orders: combines DCA entry orders + Grid exit orders
     * @returns Map of all active orders (entry + exit)
     */
    getActiveOrders(): Map<string, TradeOrder> {
        const combined = new Map<string, TradeOrder>(super.getActiveOrders());
        for (const [id, order] of this.profitGridOrders) {
            combined.set(id, order);
        }
        return combined;
    }

    protected get comboConfig(): ComboConfig {
        return this.config as unknown as ComboConfig;
    }

    /**
     * Initialize COMBO strategy
     * Sets up initial price tracking for trailing stop loss
     */
    async initialize(): Promise<void> {
        await super.initialize();
        
        // Initialize price tracking for trailing stop loss
        const ticker = await this.exchange.getTicker(this.bot.pair);
        this.highestPrice = ticker.lastPrice;
        this.lowestPrice = ticker.lastPrice;
        
        // Initialize trailing stop price if trailing is enabled
        if (this.shouldUseTrailingStopLoss()) {
            this.initializeTrailingStopLoss(ticker.lastPrice);
        }
    }

    /**
     * Check if trailing stop loss is enabled (default: true per Bitsgap docs)
     */
    private shouldUseTrailingStopLoss(): boolean {
        return this.comboConfig.trailingStopLoss !== false; // Default true
    }

    /**
     * Initialize trailing stop loss price
     */
    private initializeTrailingStopLoss(currentPrice: number): void {
        const isLong = this.comboConfig.strategy === 'LONG';
        if (isLong) {
            this.trailingStopPrice = currentPrice * (1 - (this.comboConfig.trailingStopPercent || 1) / 100);
        } else {
            this.trailingStopPrice = currentPrice * (1 + (this.comboConfig.trailingStopPercent || 1) / 100);
        }
    }

    /**
     * Handle price updates with TP/SL checking and trailing stop loss adjustment
     * 
     * Checks COMBO-specific exit conditions BEFORE calling parent to avoid double-exit race condition.
     * 
     * Monitors:
     * - Take Profit (fixed price or % based)
     * - Stop Loss with trailing (default enabled)
     * - Grid order placement within price range
     * - Trailing Down detection for TP grid
     */
    async onPriceUpdate(price: number): Promise<void> {
        if (this.isPaused) return;
        this.lastPrice = price;

        // Update price tracking for trailing stop loss
        this.updateTrailingStopTracking(price);

        // Check COMBO-specific TP/SL FIRST to avoid parent race condition
        if (this.totalAmountFilled > 0) {
            const exitDecision = this.evaluateExitConditions(price);
            if (exitDecision) {
                await this.executeExit(exitDecision);
                return;
            }
            
            // Check for Trailing Down condition (price reversal)
            await this.checkTrailingDownCondition(price);
        }

        // Now allow parent for liquidation monitoring and DCA logic
        await super.onPriceUpdate(price);
    }

    /**
     * Update trailing stop loss price tracking
     */
    private updateTrailingStopTracking(price: number): void {
        const isLong = this.comboConfig.strategy === 'LONG';
        
        if (isLong) {
            if (price > this.highestPrice) {
                this.highestPrice = price;
                // Update trailing stop when new high is reached
                if (this.shouldUseTrailingStopLoss()) {
                    const newTrailingStop = price * (1 - (this.comboConfig.trailingStopPercent || 1) / 100);
                    if (newTrailingStop > this.trailingStopPrice) {
                        this.trailingStopPrice = newTrailingStop;
                    }
                }
            }
        } else {
            if (price < this.lowestPrice) {
                this.lowestPrice = price;
                // Update trailing stop when new low is reached (short)
                if (this.shouldUseTrailingStopLoss()) {
                    const newTrailingStop = price * (1 + (this.comboConfig.trailingStopPercent || 1) / 100);
                    if (newTrailingStop < this.trailingStopPrice) {
                        this.trailingStopPrice = newTrailingStop;
                    }
                }
            }
        }
    }

    /**
     * Evaluate exit conditions and return decision if exit is needed
     * @returns Exit reason if exit needed, null otherwise
     */
    private evaluateExitConditions(price: number): string | null {
        if (this.checkTakeProfitCondition(price)) {
            return 'Take Profit Target Reached';
        }
        if (this.checkStopLossCondition(price)) {
            return 'Stop Loss Triggered';
        }
        return null;
    }

    /**
     * Check if Take Profit condition is met
     * Supports both percentage and fixed price targets
     */
    private checkTakeProfitCondition(currentPrice: number): boolean {
        if (this.avgEntryPrice === 0) return false;

        const isLong = this.comboConfig.strategy === 'LONG';
        const factor = isLong ? 1 : -1;
        const feePctBuffer = this.feeBuffer * 100 * 2; // round-trip fee allowance
        const priceBufferFactor = isLong
            ? 1 + this.feeBuffer * 2
            : Math.max(0, 1 - this.feeBuffer * 2);

        // Check by price target if specified
        if (this.comboConfig.takeProfitType === 'PRICE' && this.comboConfig.takeProfitPrice) {
            const target = this.comboConfig.takeProfitPrice;
            const adjustedTarget = target * priceBufferFactor;
            const tpReached = isLong ? currentPrice >= adjustedTarget : currentPrice <= adjustedTarget;
            if (tpReached) return true;
        }

        // Check by percentage if specified
        if (this.comboConfig.takeProfitType === 'PERCENT' && this.comboConfig.takeProfitPercent) {
            const pnlPercent = ((currentPrice - this.avgEntryPrice) / this.avgEntryPrice) * 100 * factor;
            if (pnlPercent >= (this.comboConfig.takeProfitPercent + feePctBuffer)) return true;
        }

        // Default to percent-based if type not specified but percent is set
        if (!this.comboConfig.takeProfitType && this.comboConfig.takeProfitPercent) {
            const pnlPercent = ((currentPrice - this.avgEntryPrice) / this.avgEntryPrice) * 100 * factor;
            if (pnlPercent >= (this.comboConfig.takeProfitPercent + feePctBuffer)) return true;
        }

        return false;
    }

    /**
     * Check if Stop Loss condition is met
     * Supports both percentage and fixed price levels (with trailing enabled by default)
     */
    private checkStopLossCondition(currentPrice: number): boolean {
        if (this.avgEntryPrice === 0) return false;

        const isLong = this.comboConfig.strategy === 'LONG';
        const factor = isLong ? 1 : -1;

        // Check trailing stop loss (enabled by default per Bitsgap docs)
        if (this.shouldUseTrailingStopLoss()) {
            const trailingTriggered = isLong ? currentPrice <= this.trailingStopPrice : currentPrice >= this.trailingStopPrice;
            if (trailingTriggered) return true;
        }

        // Check fixed price stop loss if specified
        if (this.comboConfig.stopLossType === 'PRICE' && this.comboConfig.stopLossPrice) {
            const slTriggered = isLong ? currentPrice <= this.comboConfig.stopLossPrice : currentPrice >= this.comboConfig.stopLossPrice;
            if (slTriggered) return true;
        }

        // Check percentage-based stop loss if specified
        if (this.comboConfig.stopLossType === 'PERCENT' && this.comboConfig.stopLossPercent) {
            const lossPercent = ((currentPrice - this.avgEntryPrice) / this.avgEntryPrice) * 100 * factor;
            if (lossPercent <= -this.comboConfig.stopLossPercent) return true;
        }

        // Default to percent-based if type not specified but percent is set
        if (!this.comboConfig.stopLossType && this.comboConfig.stopLossPercent) {
            const lossPercent = ((currentPrice - this.avgEntryPrice) / this.avgEntryPrice) * 100 * factor;
            if (lossPercent <= -this.comboConfig.stopLossPercent) return true;
        }

        return false;
    }

    /**
     * Handle order fill event with profit grid management
     * 
     * When entry (DCA Buy/Sell) is filled:
     * - Update position tracking
     * - Recalculate profit grid
     * - TRAILING DOWN FOR DCA: Extend DCA grid below current lowest
     * 
     * When exit (Grid) is filled:
     * - Record profit
     * - Remove from grid tracking
     * - TRAILING UP: Place NEW order at same level (Bitsgap COMBO mechanism)
     */
    async onOrderFilled(order: TradeOrder): Promise<void> {
        // Check if this is a DCA order before parent processes it
        const dcaInfo = this.activeDCAOrders.get(order.id);
        const isDCAOrder = dcaInfo !== undefined;
        
        // Let DCA strategy handle entry-side logic (position averaging, safety orders)
        await super.onOrderFilled(order);

        // Determine if this was an entry or exit order
        const isEntry = (this.comboConfig.strategy === 'LONG' && order.side === 'buy') ||
            (this.comboConfig.strategy === 'SHORT' && order.side === 'sell');

        if (isEntry) {
            console.log(`[Combo] Entry filled at ${order.price}. Position: ${this.totalAmountFilled}. Recalculating profit grid.`);
            // Initialize base order size on first entry
            if (this.baseOrderSize === 0) {
                this.baseOrderSize = order.amount;
            }
            
            // If this was a DCA order, implement Trailing Down for DCA
            if (isDCAOrder) {
                await this.trailingDownDCA(order, dcaInfo);
            }
            
            // On entry fill: recalculate and place profit grid
            // VOLUME RECALCULATION: After DCA fill, grid amounts are recalculated
            // as currentPosition / activeGridLevels (per Bitsgap COMBO spec)
            await this.placeProfitGrid();
        } else {
            // On profit grid fill: TRAILING UP mechanism
            const orderInfo = this.activeGridOrders.get(order.id);
            if (orderInfo) {
                await this.handleGridFill(order, orderInfo);
            } else if (this.profitGridOrders.has(order.id)) {
                // Fallback for legacy tracking
                this.profitGridOrders.delete(order.id);
                console.log(`[Combo] Profit grid level filled at ${order.price}. Remaining position.`);
            }
        }
    }

    /**
     * Handle grid order fill with Trailing Up mechanism
     * 
     * Per Bitsgap COMBO spec:
     * - Track the fill in executedGridLevels
     * - Calculate NEW order amount = currentPosition / activeGridLevels
     * - Place NEW order at SAME price level (Trailing Up for TP)
     * - Cancel lowest DCA and place new DCA closer to grid (Trailing Up for DCA)
     * - Increment execution count for this level
     */
    private async handleGridFill(order: TradeOrder, orderInfo: GridOrderInfo): Promise<void> {
        const levelNumber = orderInfo.levelNumber;
        const fillPrice = order.price;
        
        console.log(`[Combo Trailing] Grid level ${levelNumber} filled at ${fillPrice}. Amount: ${order.amount}`);
        
        // Update executed grid levels tracking
        const levelState = this.executedGridLevels.get(levelNumber) || {
            price: fillPrice,
            amount: order.amount,
            lastFillTime: new Date(),
            executionCount: 0
        };
        levelState.executionCount++;
        levelState.lastFillTime = new Date();
        this.executedGridLevels.set(levelNumber, levelState);
        
        // Remove filled order from tracking
        this.activeGridOrders.delete(order.id);
        this.profitGridOrders.delete(order.id);
        
        // Update last grid fill price for trailing down detection
        this.lastGridFillPrice = fillPrice;
        
        // TRAILING UP FOR DCA: Cancel lowest DCA order and place new one closer to grid
        await this.trailingUpDCA(fillPrice);
        
        // TRAILING UP FOR TP: Place NEW order at same level
        // Recalculate amount based on remaining position
        const remainingPosition = this.totalAmountFilled;
        if (remainingPosition > 0) {
            const activeGridCount = this.comboConfig.gridLevels;
            const newAmount = remainingPosition / activeGridCount;
            this.currentGridAmount = newAmount;
            
            const isLong = this.comboConfig.strategy === 'LONG';
            const side = isLong ? 'sell' : 'buy';
            const adjustedPrice = side === 'sell'
                ? fillPrice * (1 + this.feeBuffer)
                : fillPrice * (1 - this.feeBuffer);
            
            try {
                const newOrder = await this.executeOrderWithRetry({
                    userId: this.bot.userId,
                    botId: this.bot.id,
                    pair: this.bot.pair,
                    side,
                    type: 'limit',
                    price: adjustedPrice,
                    amount: newAmount
                });
                
                // Track new order
                const newOrderInfo: GridOrderInfo = {
                    order: newOrder,
                    levelNumber: levelNumber,
                    trailingCount: orderInfo.trailingCount + 1
                };
                this.activeGridOrders.set(newOrder.id, newOrderInfo);
                this.profitGridOrders.set(newOrder.id, newOrder);
                
                console.log(`[Combo Trailing] Placed NEW grid order at level ${levelNumber}: ${side} ${newAmount} @ ${fillPrice} (trail count: ${newOrderInfo.trailingCount})`);
            } catch (e) {
                console.error(`[Combo Trailing] Failed to place trailing grid order at level ${levelNumber}:`, (e as Error)?.message);
            }
        } else {
            console.log(`[Combo Trailing] Position closed. No trailing order placed.`);
        }
    }

    /**
     * Trailing Up for DCA: Cancel lowest DCA and place new DCA closer to grid
     * 
     * Per Bitsgap COMBO spec:
     * - Find and cancel the lowest DCA order (furthest from profit zone)
     * - Place NEW DCA at gridPrice - gridStep% (pulls DCA grid upward)
     * - Only applies to LONG strategy (SHORT uses opposite logic)
     */
    private async trailingUpDCA(gridFillPrice: number): Promise<void> {
        const isLong = this.comboConfig.strategy === 'LONG';
        
        // Find lowest DCA order (furthest from current price)
        let lowestDCAOrder: DCAOrderInfo | null = null;
        let lowestPrice = isLong ? Infinity : -Infinity;
        
        for (const [orderId, dcaInfo] of this.activeDCAOrders) {
            const dcaPrice = dcaInfo.price;
            // LONG: lowest = smallest price, SHORT: lowest = highest price
            if ((isLong && dcaPrice < lowestPrice) || (!isLong && dcaPrice > lowestPrice)) {
                lowestPrice = dcaPrice;
                lowestDCAOrder = dcaInfo;
            }
        }
        
        if (!lowestDCAOrder) {
            console.log(`[Combo Trailing] No DCA orders to trail up.`);
            return;
        }
        
        // Cancel lowest DCA order
        try {
            await this.cancelOrderWithRetry(lowestDCAOrder.order.id, this.bot.pair);
            this.activeDCAOrders.delete(lowestDCAOrder.order.id);
            console.log(`[Combo Trailing] Cancelled lowest DCA order at ${lowestPrice}`);
        } catch (e) {
            console.error(`[Combo Trailing] Failed to cancel lowest DCA:`, (e as Error)?.message);
            return;
        }
        
        // Calculate new DCA price: gridStep% below (LONG) or above (SHORT) the filled grid level
        const direction = isLong ? -1 : 1;
        const newDCAPrice = gridFillPrice * (1 + (this.comboConfig.gridStep / 100) * direction);
        
        // Place new DCA order at calculated price
        const side = isLong ? 'buy' : 'sell';
        const dcaAmount = this.calculateDCAAmount();
        
        try {
            const newDCAOrder = await this.executeOrderWithRetry({
                userId: this.bot.userId,
                botId: this.bot.id,
                pair: this.bot.pair,
                side,
                type: 'limit',
                price: newDCAPrice,
                amount: dcaAmount
            });
            
            // Track new DCA order
            const dcaInfo: DCAOrderInfo = {
                order: newDCAOrder,
                price: newDCAPrice,
                amount: dcaAmount,
                isTrailingPlaced: true
            };
            this.activeDCAOrders.set(newDCAOrder.id, dcaInfo);
            
            console.log(`[Combo Trailing] Placed NEW DCA order: ${side} ${dcaAmount} @ ${newDCAPrice} (gridStep below grid fill)`);
        } catch (e) {
            console.error(`[Combo Trailing] Failed to place trailing DCA order:`, (e as Error)?.message);
        }
    }

    /**
     * Calculate DCA order amount based on current strategy
     * Uses parent DCA strategy logic if available
     */
    private calculateDCAAmount(): number {
        // Use base order size or calculate from config
        if (this.baseOrderSize > 0) {
            return this.baseOrderSize;
        }
        
        // Fallback: use averagingOrdersAmount from config
        return this.comboConfig.averagingOrdersAmount || this.comboConfig.baseOrderAmount || 0.01;
    }

    /**
     * Trailing Down for DCA: When DCA fills, place NEW DCA below current lowest
     * 
     * Per Bitsgap COMBO spec:
     * - When DCA order fills, extend grid by placing NEW DCA order
     * - Place at price below (LONG) or above (SHORT) current lowest DCA
     * - Check 3x max investment limit
     * - Track filled DCA in executedDCAPrices
     */
    private async trailingDownDCA(filledOrder: TradeOrder, dcaInfo: DCAOrderInfo): Promise<void> {
        const fillPrice = filledOrder.price;
        const isLong = this.comboConfig.strategy === 'LONG';
        
        console.log(`[Combo Trailing Down DCA] DCA filled at ${fillPrice}. Extending DCA grid.`);
        
        // Track filled DCA price
        this.executedDCAPrices.push(fillPrice);
        this.lastDCAFillPrice = fillPrice;
        
        // Remove filled DCA from active tracking
        this.activeDCAOrders.delete(filledOrder.id);
        
        // Calculate total investment so far
        const totalInvested = this.totalQuoteAssetSpent;
        const baseOrderAmount = this.comboConfig.baseOrderAmount || 0;
        const averagingOrdersAmount = this.comboConfig.averagingOrdersAmount || 0;
        const maxInvestment = (baseOrderAmount + averagingOrdersAmount) * 3; // 3x limit per Bitsgap
        
        if (totalInvested >= maxInvestment) {
            console.log(`[Combo Trailing Down DCA] Max investment limit (3x) reached. Total: ${totalInvested} >= ${maxInvestment}. Skipping trailing.`);
            return;
        }
        
        // Find current lowest DCA order
        let lowestDCAPrice = isLong ? Infinity : -Infinity;
        
        for (const [orderId, dcaOrder] of this.activeDCAOrders) {
            const dcaPrice = dcaOrder.price;
            // LONG: lowest = smallest price, SHORT: lowest = highest price
            if ((isLong && dcaPrice < lowestDCAPrice) || (!isLong && dcaPrice > lowestDCAPrice)) {
                lowestDCAPrice = dcaPrice;
            }
        }
        
        // Calculate new DCA price: one gridStep below (LONG) or above (SHORT) current lowest
        const direction = isLong ? -1 : 1;
        const newDCAPrice = lowestDCAPrice !== Infinity && lowestDCAPrice !== -Infinity
            ? lowestDCAPrice * (1 + (this.comboConfig.gridStep / 100) * direction)
            : fillPrice * (1 + (this.comboConfig.gridStep / 100) * direction); // Fallback if no other DCA orders
        
        // Place new DCA order
        const side = isLong ? 'buy' : 'sell';
        const dcaAmount = this.calculateDCAAmount();
        
        // Check if new investment would exceed limit
        const newInvestment = totalInvested + (dcaAmount * newDCAPrice);
        if (newInvestment > maxInvestment) {
            console.log(`[Combo Trailing Down DCA] New DCA would exceed 3x limit. Skipping. Would be: ${newInvestment} > ${maxInvestment}`);
            return;
        }
        
        try {
            const newDCAOrder = await this.executeOrderWithRetry({
                userId: this.bot.userId,
                botId: this.bot.id,
                pair: this.bot.pair,
                side,
                type: 'limit',
                price: newDCAPrice,
                amount: dcaAmount
            });
            
            // Track new DCA order
            const newDcaInfo: DCAOrderInfo = {
                order: newDCAOrder,
                price: newDCAPrice,
                amount: dcaAmount,
                isTrailingPlaced: true
            };
            this.activeDCAOrders.set(newDCAOrder.id, newDcaInfo);
            
            console.log(`[Combo Trailing Down DCA] Placed NEW DCA order below current lowest: ${side} ${dcaAmount} @ ${newDCAPrice}`);
        } catch (e) {
            console.error(`[Combo Trailing Down DCA] Failed to place trailing down DCA order:`, (e as Error)?.message);
        }
    }

    /**
     * Check for Trailing Down condition (price reversal detection)
     * 
     * Per Bitsgap COMBO spec:
     * - Detects when price drops by gridStep% from last grid fill (LONG)
     * - Detects when price rises by gridStep% from last grid fill (SHORT)
     * - Cancels highest grid order and replaces at previous fill level
     * - Resets grid lower to follow price reversal
     */
    private async checkTrailingDownCondition(currentPrice: number): Promise<void> {
        if (this.lastGridFillPrice === 0 || this.trailingDownTriggered) {
            return;
        }
        
        const isLong = this.comboConfig.strategy === 'LONG';
        const gridStepPercent = this.comboConfig.gridStep;
        
        // Calculate price movement percentage from last grid fill
        const priceChangePercent = ((currentPrice - this.lastGridFillPrice) / this.lastGridFillPrice) * 100;
        
        // LONG: Detect drop (negative change >= gridStep)
        // SHORT: Detect rise (positive change >= gridStep)
        const reversal = isLong 
            ? priceChangePercent <= -gridStepPercent
            : priceChangePercent >= gridStepPercent;
        
        if (!reversal) {
            return;
        }
        
        console.log(`[Combo Trailing Down] Price reversal detected: ${priceChangePercent.toFixed(2)}% from last grid fill ${this.lastGridFillPrice}`);
        this.trailingDownTriggered = true;
        
        // Find highest grid order (furthest from current price)
        let highestGridOrder: GridOrderInfo | null = null;
        let highestLevel = -1;
        
        for (const [orderId, gridInfo] of this.activeGridOrders) {
            if (gridInfo.levelNumber > highestLevel) {
                highestLevel = gridInfo.levelNumber;
                highestGridOrder = gridInfo;
            }
        }
        
        if (!highestGridOrder) {
            console.log(`[Combo Trailing Down] No grid orders to trail down.`);
            this.trailingDownTriggered = false;
            return;
        }
        
        // Cancel highest grid order
        try {
            await this.cancelOrderWithRetry(highestGridOrder.order.id, this.bot.pair);
            this.activeGridOrders.delete(highestGridOrder.order.id);
            this.profitGridOrders.delete(highestGridOrder.order.id);
            console.log(`[Combo Trailing Down] Cancelled highest grid order at level ${highestLevel}`);
        } catch (e) {
            console.error(`[Combo Trailing Down] Failed to cancel highest grid:`, (e as Error)?.message);
            this.trailingDownTriggered = false;
            return;
        }
        
        // Find previous fill level price to place new order
        let previousFillPrice = 0;
        let previousFillLevel = -1;
        
        for (const [level, state] of this.executedGridLevels) {
            if (level < highestLevel && level > previousFillLevel) {
                previousFillLevel = level;
                previousFillPrice = state.price;
            }
        }
        
        if (previousFillPrice === 0) {
            console.log(`[Combo Trailing Down] No previous fill level found. Using lastGridFillPrice.`);
            previousFillPrice = this.lastGridFillPrice;
        }
        
        // Place new grid order at previous fill level
        const side = isLong ? 'sell' : 'buy';
        const newAmount = this.currentGridAmount > 0 ? this.currentGridAmount : this.totalAmountFilled / this.comboConfig.gridLevels;
        const adjustedPrice = side === 'sell'
            ? previousFillPrice * (1 + this.feeBuffer)
            : previousFillPrice * (1 - this.feeBuffer);
        
        try {
            const newOrder = await this.executeOrderWithRetry({
                userId: this.bot.userId,
                botId: this.bot.id,
                pair: this.bot.pair,
                side,
                type: 'limit',
                price: adjustedPrice,
                amount: newAmount
            });
            
            // Track new order (reuse the cancelled level number)
            const newOrderInfo: GridOrderInfo = {
                order: newOrder,
                levelNumber: highestLevel,
                trailingCount: highestGridOrder.trailingCount + 1
            };
            this.activeGridOrders.set(newOrder.id, newOrderInfo);
            this.profitGridOrders.set(newOrder.id, newOrder);
            
            console.log(`[Combo Trailing Down] Placed NEW grid order at previous fill level: ${side} ${newAmount} @ ${previousFillPrice}`);
            
            // Reset trailing flag after successful trail
            this.trailingDownTriggered = false;
        } catch (e) {
            console.error(`[Combo Trailing Down] Failed to place trailing down order:`, (e as Error)?.message);
            this.trailingDownTriggered = false;
        }
    }

    /**
     * Check if grid should be suspended due to insufficient gap with DCA orders
     * 
     * Per Bitsgap COMBO spec:
     * - Monitor gap between lowest grid and highest DCA
     * - If gap < gridStep%, suspend grid to prevent overlap
     * - Returns suspension decision with reason
     */
    private checkGridSuspension(): { shouldSuspend: boolean; reason: string } {
        const isLong = this.comboConfig.strategy === 'LONG';
        const gridStepPercent = this.comboConfig.gridStep;
        const basePrice = this.avgEntryPrice > 0 ? this.avgEntryPrice : this.lastPrice;
        
        // Calculate lowest grid price (first level)
        const direction = isLong ? 1 : -1;
        const lowestGridPrice = basePrice * (1 + (gridStepPercent / 100) * direction);
        
        // Find highest DCA order price
        let highestDCAPrice = isLong ? -Infinity : Infinity;
        let hasDCAOrders = false;
        
        for (const [orderId, dcaOrder] of this.activeDCAOrders) {
            hasDCAOrders = true;
            const dcaPrice = dcaOrder.price;
            // LONG: highest = largest price, SHORT: highest = smallest price
            if ((isLong && dcaPrice > highestDCAPrice) || (!isLong && dcaPrice < highestDCAPrice)) {
                highestDCAPrice = dcaPrice;
            }
        }
        
        // If no DCA orders, don't suspend
        if (!hasDCAOrders) {
            return { shouldSuspend: false, reason: '' };
        }
        
        // Calculate gap percentage between grid and DCA
        // LONG: gap = (lowestGrid - highestDCA) / highestDCA * 100
        // SHORT: gap = (highestDCA - lowestGrid) / lowestGrid * 100
        const gapPercent = isLong
            ? ((lowestGridPrice - highestDCAPrice) / highestDCAPrice) * 100
            : ((highestDCAPrice - lowestGridPrice) / lowestGridPrice) * 100;
        
        // Suspend if gap < gridStep%
        if (gapPercent < gridStepPercent) {
            return {
                shouldSuspend: true,
                reason: `Gap ${gapPercent.toFixed(2)}% < gridStep ${gridStepPercent}%. Grid: ${lowestGridPrice.toFixed(8)}, DCA: ${highestDCAPrice.toFixed(8)}`
            };
        }
        
        return { shouldSuspend: false, reason: '' };
    }

    /**
     * Place grid of profit-taking limit orders
     * 
     * Per Bitsgap COMBO specification:
     * - LONG: Grid orders above entry price to take profit (uses +gridStep for each level)
     * - SHORT: Grid orders below entry price to take profit (uses -gridStep for each level)
     * 
     * Price boundaries are SOFT limits:
     * - LONG: Grid should ideally be above highPrice (profit zone), but minimum above entry
     * - SHORT: Grid should ideally be below lowPrice (profit zone), but minimum below entry
     * 
     * CSV execution pattern shows:
     * - Multiple grid levels placed simultaneously on first entry fill
     * - Grid levels calculated from average entry price
     * - Each grid level sized to distribute total position evenly
     * 
     * State tracking for Trailing Up mechanism:
     * - Track each order in activeGridOrders with level metadata
     * - Initialize currentGridAmount for volume recalculation
     * 
     * GRID SUSPENSION:
     * - Check gap between grid and DCA zones
     * - If gap < gridStep%, suspend grid placement to avoid overlap
     */
    private async placeProfitGrid(): Promise<void> {
        try {
            // Cancel existing grid orders to recalculate (necessary when averaging)
            for (const id of this.profitGridOrders.keys()) {
                try {
                    await this.cancelOrderWithRetry(id, this.bot.pair);
                } catch (e) {
                    // Ignore if already filled/gone
                }
            }
            this.profitGridOrders.clear();
            this.activeGridOrders.clear();

            const totalPos = this.totalAmountFilled;
            if (totalPos <= 0) return;

            const config = this.comboConfig;
            const isLong = config.strategy === 'LONG';

            // Check grid suspension condition
            const suspensionCheck = this.checkGridSuspension();
            if (suspensionCheck.shouldSuspend) {
                console.warn(`[Combo Grid Suspension] Grid suspended. ${suspensionCheck.reason}`);
                this.gridSuspended = true;
                return;
            }
            this.gridSuspended = false;

            // Amount per grid level (distribute current position evenly across grid levels)
            const amountPerLevel = totalPos / config.gridLevels;
            this.currentGridAmount = amountPerLevel;

            // Base price for grid calculation: use average entry price as reference
            const basePrice = this.avgEntryPrice > 0 ? this.avgEntryPrice : this.lastPrice;
            this.currentPositionAvgPrice = basePrice;

            let placedCount = 0;

            // Place grid levels starting from first level (i=1)
            for (let i = 1; i <= config.gridLevels; i++) {
                // Calculate grid level price: each level moves by gridStep %
                // LONG: gridStep moves UPWARD (profitable sells above entry)
                // SHORT: gridStep moves DOWNWARD (profitable buys below entry)
                const direction = isLong ? 1 : -1;
                const gridPrice = basePrice * (1 + (config.gridStep * i / 100) * direction);

                // Soft price boundary validation
                // Allow some flexibility but warn if significantly outside range
                const aboveHighPrice = gridPrice > config.highPrice;
                const belowLowPrice = gridPrice < config.lowPrice;

                if ((isLong && belowLowPrice) || (!isLong && aboveHighPrice)) {
                    console.warn(`[Combo] Grid level ${i} price ${gridPrice} outside trading range [${config.lowPrice}, ${config.highPrice}]. Skipping.`);
                    continue;
                }

                const side = isLong ? 'sell' : 'buy';
                const adjustedPrice = side === 'sell'
                    ? gridPrice * (1 + this.feeBuffer)
                    : gridPrice * (1 - this.feeBuffer);

                try {
                    const order = await this.executeOrderWithRetry({
                        userId: this.bot.userId,
                        botId: this.bot.id,
                        pair: this.bot.pair,
                        side,
                        type: 'limit',
                        price: adjustedPrice,
                        amount: amountPerLevel
                    });
                    
                    // Track order with level metadata for Trailing Up
                    const orderInfo: GridOrderInfo = {
                        order: order,
                        levelNumber: i,
                        trailingCount: 0
                    };
                    this.activeGridOrders.set(order.id, orderInfo);
                    this.profitGridOrders.set(order.id, order);
                    placedCount++;
                    console.log(`[Combo] Placed grid level ${i}/${config.gridLevels}: ${side} ${amountPerLevel} @ ${gridPrice}`);
                } catch (e) {
                    console.error(`[Combo] Failed to place grid level ${i}:`, (e as Error)?.message);
                }
            }

            console.log(`[Combo] Grid recalculation complete: ${placedCount}/${config.gridLevels} levels placed. Total position: ${totalPos}`);
        } catch (error) {
            await this.handleStrategyError(error as Error, 'placeProfitGrid');
        }
    }

    /**
     * Execute full position exit
     * 
     * Per Bitsgap docs: "When either the Take Profit or Stop Loss level is reached, the bot will:
     * - Cancel all active orders
     * - Place a market order to close the position"
     * 
     * Clears both DCA entry orders and profit grid orders.
     */
    protected async executeExit(reason: string): Promise<void> {
        console.log(`[Combo] Exiting position: ${reason}`);
        
        try {
            // Cancel all active orders (both entry and grid)
            const allOrders = this.getActiveOrders();
            for (const [id, order] of allOrders) {
                await this.cancelOrderWithRetry(id, order.pair).catch((e) => {
                    console.warn(`[Combo] Failed to cancel order ${id}:`, e?.message);
                });
            }

            // Close entire position at market price
            if (this.totalAmountFilled > 0) {
                const side = this.comboConfig.strategy === 'LONG' ? 'sell' : 'buy';
                const exitOrder = await this.executeOrderWithRetry({
                    userId: this.bot.userId,
                    botId: this.bot.id,
                    pair: this.bot.pair,
                    side,
                    type: 'market',
                    amount: this.totalAmountFilled
                });
                await this.recordTrade(exitOrder);
            }

            // Clear tracking
            this.profitGridOrders.clear();
            this.activeGridOrders.clear();
            this.activeDCAOrders.clear();
            this.executedGridLevels.clear();
            this.executedDCAPrices = [];
            this.lastGridFillPrice = 0;
            this.lastDCAFillPrice = 0;
            this.trailingDownTriggered = false;
            this.gridSuspended = false;
            this.totalAmountFilled = 0;
            this.avgEntryPrice = 0;

            // Update bot status
            await this.updateBotStatus('stopped');
        } catch (error) {
            await this.handleStrategyError(error as Error, `executeExit(${reason})`);
            throw error;
        }
    }

    /**
     * Override to track DCA orders in activeDCAOrders map
     * 
     * Calls parent's syncSafetyOrders and then tracks orders for trailing mechanism
     */
    protected async syncSafetyOrders(): Promise<void> {
        await super.syncSafetyOrders();
        
        // Track active DCA orders for trailing
        for (const [orderId, order] of this.activeOrders) {
            if (!this.activeDCAOrders.has(orderId) && !this.profitGridOrders.has(orderId)) {
                // This is a DCA order
                const dcaInfo: DCAOrderInfo = {
                    order: order,
                    price: order.price,
                    amount: order.amount,
                    isTrailingPlaced: false
                };
                this.activeDCAOrders.set(orderId, dcaInfo);
            }
        }
    }

    /**
     * Override to track individual DCA order placement
     * 
     * Ensures each placed DCA order is tracked in activeDCAOrders
     */
    protected async placeNextSafetyOrder(index: number): Promise<void> {
        const beforeSize = this.activeOrders.size;
        await super.placeNextSafetyOrder(index);
        const afterSize = this.activeOrders.size;
        
        // If a new order was placed, find and track it
        if (afterSize > beforeSize) {
            for (const [orderId, order] of this.activeOrders) {
                if (!this.activeDCAOrders.has(orderId) && !this.profitGridOrders.has(orderId)) {
                    const dcaInfo: DCAOrderInfo = {
                        order: order,
                        price: order.price,
                        amount: order.amount,
                        isTrailingPlaced: false
                    };
                    this.activeDCAOrders.set(orderId, dcaInfo);
                    console.log(`[Combo Trailing] Tracked DCA order ${index}: ${order.side} ${order.amount} @ ${order.price}`);
                    break;
                }
            }
        }
    }
}

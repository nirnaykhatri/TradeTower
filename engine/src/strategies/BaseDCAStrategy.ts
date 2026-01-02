import { BaseStrategy, ExitMode } from './BaseStrategy';
import { TradeOrder, indicatorService, botRepository, ValidationError, CriticalStrategyError } from '@trading-tower/shared';
import {
    MAX_FILL_HISTORY,
    PUMP_PROTECTION_THRESHOLD,
    PUMP_PROTECTION_WINDOW_MS,
    PRICE_TOLERANCE
} from '../constants/strategy.constants';

/**
 * Base Dollar Cost Averaging Strategy
 * 
 * Implements core DCA logic including:
 * - Base order placement with configurable conditions
 * - Safety orders (averaging) with step and amount multipliers
 * - Take profit with trailing TP support
 * - Stop loss with trailing SL support
 * - Pump protection via velocity detection
 * - Global kill switches (profit/loss limits)
 * - Position reinvestment
 * 
 * Extended by DCAStrategy (spot) and DCAFuturesStrategy (perpetuals)
 */
export abstract class BaseDCAStrategy<T extends any> extends BaseStrategy<T> {
    /** Active limit orders awaiting fill */
    protected activeOrders: Map<string, TradeOrder> = new Map();
    
    /** Maps order IDs to their safety order index */
    protected safetyOrderMap: Map<string, number> = new Map();
    
    /** All filled orders in current cycle */
    protected filledOrders: TradeOrder[] = [];

    /** Volume-weighted average entry price */
    protected avgEntryPrice: number = 0;
    
    /** Total position size in base asset */
    protected totalAmountFilled: number = 0;
    
    /** Total spent in quote asset */
    protected totalQuoteAssetSpent: number = 0;

    /** Count of filled safety orders */
    protected safetyOrdersFilledCount: number = 0;
    
    /** Next safety order index to place */
    protected nextSafetyOrderToIndex: number = 0;

    /** Whether trailing take profit is active */
    protected isTrailingTP: boolean = false;
    
    /** Peak price for trailing TP calculation */
    protected trailingTPPrice: number = 0;

    /** Current stop loss trigger price */
    protected currentSLPrice: number = 0;

    /** Whether waiting for entry condition */
    protected isWaitingForEntry: boolean = false;

    /** Peak equity for drawdown calculation */
    private peakEquity: number = 0;
    
    /** Recent fill timestamps for pump detection */
    private lastFills: number[] = [];

    /** Get DCA configuration from derived class */
    protected abstract get dcaConfig(): any;

    /**
     * Initialize DCA strategy
     * 
     * Sets up initial equity tracking for drawdown calculation.
     */
    async initialize(): Promise<void> {
        console.log(`[DCA] Initializing ${this.bot.strategyType} for ${this.bot.pair}`);
        this.peakEquity = this.bot.performance.initialInvestment + this.bot.performance.totalPnL;
    }

    /**
     * Start DCA strategy execution
     * 
     * Checks global kill switches and places base order
     * or waits for entry condition.
     */
    async start(): Promise<void> {
        await this.updateBotStatus('running');

        // Check Kill-Switches (Global Profit/Loss)
        if (this.checkGlobalKillSwitches()) return;

        const condition = this.dcaConfig.baseOrderCondition || 'IMMEDIATELY';

        if (condition === 'IMMEDIATELY') {
            await this.placeBaseOrder();
        } else {
            console.log(`[DCA] Waiting for entry condition: ${condition}`);
            this.isWaitingForEntry = true;
        }
    }

    /**
     * Check global profit/loss kill switches
     * 
     * Stops bot if:
     * - Total profit reaches target
     * - Total loss exceeds allowed limit
     * 
     * @returns True if kill switch triggered
     */
    private checkGlobalKillSwitches(): boolean {
        const perf = this.bot.performance;
        if (this.dcaConfig.targetTotalProfit && perf.totalPnL >= this.dcaConfig.targetTotalProfit) {
            console.log(`[DCA] Global Target Total Profit reached: ${perf.totalPnL}`);
            this.stop('CANCEL_ALL');
            return true;
        }
        if (this.dcaConfig.allowedTotalLoss && perf.totalPnL <= -this.dcaConfig.allowedTotalLoss) {
            console.log(`[DCA] Global Allowed Total Loss reached: ${perf.totalPnL}`);
            this.stop('MARKET_SELL');
            return true;
        }
        return false;
    }

    /**
     * Place initial base order
     * 
     * Performs pre-entry checks:
     * - Price within min/max bounds
     * - Pump protection not triggered
     * 
     * Creates market or limit order based on config.
     * Initializes stop loss if configured.
     * Places all safety orders if placeSafetyOrdersAtStart enabled.
     */
    protected async placeBaseOrder(): Promise<void> {
        if (this.isPaused) return;

        const ticker = await this.exchange.getTicker(this.bot.pair);
        const price = ticker.lastPrice;

        // Check price bounds
        if (this.dcaConfig.maxPrice && price > this.dcaConfig.maxPrice) {
            this.isWaitingForEntry = true;
            return;
        }
        if (this.dcaConfig.minPrice && price < this.dcaConfig.minPrice) {
            this.isWaitingForEntry = true;
            return;
        }

        // Check pump protection
        if (this.dcaConfig.pumpProtection && this.detectUnusualVelocity()) {
            this.isWaitingForEntry = true;
            return;
        }

        const side = this.dcaConfig.strategy === 'LONG' ? 'buy' : 'sell';
        const type = this.dcaConfig.baseOrderType?.toLowerCase() || 'market';

        try {
            if (this.bot.performance.initialPrice === 0) {
                this.bot.performance.initialPrice = price;
            }

            const order = await this.executeOrderWithRetry({
                userId: this.bot.userId,
                botId: this.bot.id,
                pair: this.bot.pair,
                side,
                type: type as any,
                amount: this.dcaConfig.baseOrderAmount,
                price: type === 'limit' ? price : undefined
            });

            this.activeOrders.set(order.id, order);
            this.isWaitingForEntry = false;

            // Set initial stop loss
            if (this.dcaConfig.stopLossPercent) {
                const factor = this.dcaConfig.strategy === 'LONG' ? -1 : 1;
                this.currentSLPrice = price * (1 + (this.dcaConfig.stopLossPercent / 100) * factor);
            }

            // Place all safety orders upfront if configured
            if (this.dcaConfig.placeSafetyOrdersAtStart) {
                await this.syncSafetyOrders();
            }
        } catch (error) {
            await this.handleStrategyError(error as Error, 'placeBaseOrder');
        }
    }

    /**
     * Detect unusual fill velocity (pump protection)
     * 
     * Checks if too many orders filled in short time window,
     * which may indicate a rapid price pump.
     * 
     * @returns True if velocity threshold exceeded
     */
    private detectUnusualVelocity(): boolean {
        if (this.lastFills.length < PUMP_PROTECTION_THRESHOLD) return false;
        const now = Date.now();
        const recent = this.lastFills.filter(t => now - t < PUMP_PROTECTION_WINDOW_MS);
        return recent.length >= PUMP_PROTECTION_THRESHOLD;
    }

    /**
     * Get current market price
     * 
     * @returns Current last price from exchange
     */
    protected async getCurrentPrice(): Promise<number> {
        const ticker = await this.exchange.getTicker(this.bot.pair);
        return ticker.lastPrice;
    }

    /**
     * Get all active orders for this strategy
     * 
     * @returns Map of active orders indexed by order ID
     */
    protected getActiveOrders(): Map<string, TradeOrder> {
        return this.activeOrders;
    }

    /**
     * Cancel all active orders and clear internal state
     */
    public async cancelAllActiveOrders(): Promise<void> {
        const orders = this.getActiveOrders();
        for (const [id, order] of orders) {
            await this.cancelOrderWithRetry(id, order.pair).catch((error) => {
                console.warn(`[DCA] Failed to cancel order ${id}:`, error?.message);
            });
        }
        this.activeOrders.clear();
        this.safetyOrderMap.clear();
    }

    /**
     * Handle real-time price updates
     * 
     * Monitors for:
     * - Entry condition satisfaction (if waiting)
     * - Take profit (with optional trailing)
     * - Stop loss (with optional trailing)
     * - Updates unrealized PnL and performance metrics
     * 
     * @param price Current market price
     */
    async onPriceUpdate(price: number): Promise<void> {
        if (this.isPaused) return;
        this.lastPrice = price;

        if (this.isWaitingForEntry) {
            if (this.dcaConfig.baseOrderCondition === 'PRICE_CHANGE' && this.dcaConfig.triggerPrice) {
                const diff = Math.abs(price - this.dcaConfig.triggerPrice) / this.dcaConfig.triggerPrice;
                if (diff < 0.005) await this.placeBaseOrder();
            } else if (this.dcaConfig.baseOrderCondition === 'INDICATOR' && this.dcaConfig.entryIndicator) {
                const signal = await this.checkIndicatorCondition(this.dcaConfig.entryIndicator, true);
                if (signal) await this.placeBaseOrder();
            }
            return;
        }

        if (this.totalAmountFilled === 0) return;

        const currentPnL = this.calculatePnL(price);
        const feePctBuffer = this.feeBuffer * 100 * 2; // round-trip fee allowance

        const perf = this.bot.performance;
        const factor = this.dcaConfig.strategy === 'LONG' ? 1 : -1;

        perf.unrealizedPnL = (price - this.avgEntryPrice) * this.totalAmountFilled * factor;
        perf.totalPnL = perf.botProfit + perf.unrealizedPnL;
        perf.totalPnLPercent = (perf.totalPnL / perf.initialInvestment) * 100;
        perf.annualizedReturn = this.calculateAnnualizedReturn();

        perf.avgEntryPrice = this.avgEntryPrice;
        perf.breakEvenPrice = this.avgEntryPrice;
        perf.filledSafetyOrders = this.safetyOrdersFilledCount;
        perf.totalSafetyOrders = this.dcaConfig.averagingOrdersQuantity;

        const currentEquity = perf.initialInvestment + perf.totalPnL;
        if (currentEquity > this.peakEquity) this.peakEquity = currentEquity;
        const currentDrawdown = ((this.peakEquity - currentEquity) / this.peakEquity) * 100;
        if (currentDrawdown > perf.drawdown) perf.drawdown = currentDrawdown;

        if (this.dcaConfig.trailingTP && this.dcaConfig.takeProfitPercent) {
            const tpThreshold = this.dcaConfig.takeProfitPercent + feePctBuffer;
            if (!this.isTrailingTP && currentPnL >= tpThreshold) {
                this.isTrailingTP = true;
                this.trailingTPPrice = price;
            }
            if (this.isTrailingTP) {
                if ((this.dcaConfig.strategy === 'LONG' && price > this.trailingTPPrice) ||
                    (this.dcaConfig.strategy === 'SHORT' && price < this.trailingTPPrice)) {
                    this.trailingTPPrice = price;
                }
                const reversal = Math.abs(price - this.trailingTPPrice) / this.trailingTPPrice * 100;
                if (reversal >= (this.dcaConfig.trailingTPStep || 0.5)) {
                    await this.executeExit('Trailing Take Profit');
                    return;
                }
            }
        } else if (this.dcaConfig.takeProfitPercent && currentPnL >= (this.dcaConfig.takeProfitPercent + feePctBuffer)) {
            let canExit = true;
            if (this.dcaConfig.takeProfitCondition) {
                canExit = await this.checkIndicatorCondition(this.dcaConfig.takeProfitCondition);
            }
            if (canExit) {
                await this.executeExit('Take Profit');
                return;
            }
        }

        if (this.dcaConfig.trailingSL && this.dcaConfig.trailingSLStep) {
            const slStepFactor = this.dcaConfig.strategy === 'LONG' ? (1 - this.dcaConfig.trailingSLStep / 100) : (1 + this.dcaConfig.trailingSLStep / 100);
            const potentialNewSL = price * slStepFactor;
            if (this.dcaConfig.strategy === 'LONG' && potentialNewSL > this.currentSLPrice) {
                this.currentSLPrice = potentialNewSL;
            } else if (this.dcaConfig.strategy === 'SHORT' && potentialNewSL < this.currentSLPrice) {
                this.currentSLPrice = potentialNewSL;
            }
        }

        if (this.currentSLPrice > 0) {
            const slTriggered = this.dcaConfig.strategy === 'LONG' ? price <= this.currentSLPrice : price >= this.currentSLPrice;
            if (slTriggered) {
                await this.executeExit('Stop Loss (Trailing)');
                return;
            }
        }
    }

    /**
     * Manually trigger averaging buy/sell
     * 
     * Allows user to manually add to position outside
     * of automated safety order logic.
     * 
     * @param amount Amount of base asset to buy/sell
     */
    async manualAveragingBuy(amount: number): Promise<void> {
        const side = this.dcaConfig.strategy === 'LONG' ? 'buy' : 'sell';
        try {
            const order = await this.executeOrderWithRetry({
                userId: this.bot.userId,
                botId: this.bot.id,
                pair: this.bot.pair,
                side,
                type: 'market',
                amount
            });
            await this.onOrderFilled(order);
        } catch (error) {
            await this.handleStrategyError(error as Error, 'manualAveragingBuy');
        }
    }

    /**
     * Check if indicator-based condition is met
     * 
     * Fetches candles, calculates indicator, and checks signal.
     * 
     * @param condition Indicator configuration
     * @param isEntry Whether checking entry (vs exit) condition
     * @returns True if condition met
     */
    protected async checkIndicatorCondition(condition: any, isEntry: boolean = false): Promise<boolean> {
        try {
            const candles = await this.exchange.getCandles(this.bot.pair, condition.timeframe, 100);
            const closePrices = candles.map((c: any) => parseFloat(c[4]));
            const signal = indicatorService.generateSignal(condition.type, closePrices, condition.config);
            const expected = isEntry
                ? (this.dcaConfig.strategy === 'LONG' ? 'BUY' : 'SELL')
                : (this.dcaConfig.strategy === 'LONG' ? 'SELL' : 'BUY');
            return signal === expected;
        } catch (error) {
            console.error('[DCA] Indicator check failed:', error);
            return false;
        }
    }

    /**
     * Calculate current position PnL percentage
     * 
     * @param currentPrice Current market price
     * @returns PnL as percentage of entry price
     */
    protected calculatePnL(currentPrice: number): number {
        if (this.avgEntryPrice === 0) return 0;
        const factor = this.dcaConfig.strategy === 'LONG' ? 1 : -1;
        return ((currentPrice - this.avgEntryPrice) / this.avgEntryPrice) * 100 * factor;
    }

    /**
     * Synchronize safety orders on the exchange
     * 
     * Places safety orders up to activeOrdersLimit or max total count.
     * Respects step multiplier and amount multiplier for martingale/anti-martingale.
     */
    protected async syncSafetyOrders(): Promise<void> {
        if (this.isPaused) return;
        const maxTotalCount = this.dcaConfig.averagingOrdersQuantity;
        const activeLimit = this.dcaConfig.activeOrdersLimitEnabled ? (this.dcaConfig.activeOrdersLimit || 1) : 1;
        let currentOnBook = this.safetyOrderMap.size;
        while (currentOnBook < activeLimit && this.nextSafetyOrderToIndex < maxTotalCount) {
            await this.placeNextSafetyOrder(this.nextSafetyOrderToIndex);
            currentOnBook++;
            this.nextSafetyOrderToIndex++;
        }
    }

    /**
     * Place next safety order (averaging order)
     * 
     * Calculates price deviation using step multiplier (martingale/anti-martingale).
     * Calculates order size using amount multiplier.
     * 
     * Pauses bot if insufficient funds detected.
     * 
     * @param index Safety order index (0-based)
     */
    protected async placeNextSafetyOrder(index: number): Promise<void> {
        const baseStep = this.dcaConfig.averagingOrdersStep;
        const stepMult = this.dcaConfig.stepMultiplier || 1.0;
        const amountMult = this.dcaConfig.amountMultiplier || 1.0;
        
        // Calculate cumulative price deviation
        let totalDeviation = 0;
        for (let i = 0; i <= index; i++) {
            totalDeviation += baseStep * Math.pow(stepMult, i);
        }
        
        const initialPrice = this.filledOrders[0]?.price || await this.getCurrentPrice();
        const side = this.dcaConfig.strategy === 'LONG' ? 'buy' : 'sell';
        const price = side === 'buy' 
            ? initialPrice * (1 - totalDeviation / 100) 
            : initialPrice * (1 + totalDeviation / 100);
        const currentAmount = this.dcaConfig.averagingOrdersAmount * Math.pow(amountMult, index);
        
        try {
            const order = await this.executeOrderWithRetry({
                userId: this.bot.userId,
                botId: this.bot.id,
                pair: this.bot.pair,
                side,
                type: 'limit',
                price,
                amount: currentAmount
            });
            
            this.activeOrders.set(order.id, order);
            this.safetyOrderMap.set(order.id, index);
        } catch (error: any) {
            console.error(`[DCA] SO ${index} failed:`, error);
            
            // Handle insufficient funds by pausing bot
            if (error?.message?.includes('Insufficient funds') || error?.code === 'INSUFFICIENT_FUNDS') {
                console.warn(`[DCA] Insufficient funds for Safety Order ${index}. Pausing bot.`);
                await this.pause();
            } else {
                await this.handleStrategyError(error as Error, `placeNextSafetyOrder(${index})`);
            }
        }
    }

    /**
     * Execute position exit
     * 
     * Closes entire position at market price.
     * Updates realized PnL.
     * Optionally reinvests profit by scaling order sizes.
     * Resets state and starts new cycle (after optional cooldown).
     * 
     * @param reason Exit reason for logging
     */
    protected async executeExit(reason: string): Promise<void> {
        console.log(`[DCA] ${reason} triggered. Closing position.`);
        await this.cancelAllActiveOrders();
        
        const side = this.dcaConfig.strategy === 'LONG' ? 'sell' : 'buy';
        
        try {
            // Close position at market
            const order = await this.executeOrderWithRetry({
                userId: this.bot.userId,
                botId: this.bot.id,
                pair: this.bot.pair,
                side,
                type: 'market',
                amount: this.totalAmountFilled
            });
            
            // Calculate realized PnL
            const realizedQuote = order.amount * order.price;
            const factor = this.dcaConfig.strategy === 'LONG' ? 1 : -1;
            const tradePnL = (realizedQuote - this.totalQuoteAssetSpent) * factor;

            order.profit = tradePnL;
            order.fee = order.fee ?? 0;
            
            this.bot.performance.botProfit += tradePnL;
            
            // Reinvest profit if enabled
            if (this.dcaConfig.reinvestProfit && tradePnL > 0) {
                const oldInvestment = (this.config as any).investment;
                const newInvestment = oldInvestment + tradePnL;
                const scaleFactor = newInvestment / oldInvestment;

                console.log(`[DCA] Reinvesting profit. Scaling investment from ${oldInvestment} to ${newInvestment} (Factor: ${scaleFactor.toFixed(4)})`);

                (this.config as any).investment = newInvestment;
                (this.config as any).baseOrderAmount *= scaleFactor;
                (this.config as any).averagingOrdersAmount *= scaleFactor;

                this.bot.config = this.config;

                // Persist updated config to database
                await botRepository.update(this.bot.id, this.bot.userId, { config: this.config });
            }
            
            await this.recordTrade(order);
            
            // Reset state for next cycle
            this.totalAmountFilled = 0;
            this.avgEntryPrice = 0;
            this.totalQuoteAssetSpent = 0;
            this.filledOrders = [];
            this.safetyOrdersFilledCount = 0;
            this.nextSafetyOrderToIndex = 0;
            this.isTrailingTP = false;
            this.currentSLPrice = 0;
            
            // Start new cycle after cooldown
            if (this.dcaConfig.cooldownSeconds) {
                this.isWaitingForEntry = false;
                setTimeout(() => { this.start(); }, this.dcaConfig.cooldownSeconds * 1000);
            } else {
                await this.start();
            }
        } catch (error) {
            await this.handleStrategyError(error as Error, 'executeExit');
        }
    }

    /**
     * Handle order fill event
     * 
     * Updates position tracking, average entry price,
     * and places next safety orders if needed.
     * 
     * @param order Filled order details
     */
    async onOrderFilled(order: TradeOrder): Promise<void> {
        this.activeOrders.delete(order.id);
        
        // Track fill timestamps for pump detection
        this.lastFills.push(Date.now());
        if (this.lastFills.length > MAX_FILL_HISTORY) {
            this.lastFills.shift();
        }
        
        // Track safety order fills
        if (this.safetyOrderMap.has(order.id)) {
            this.safetyOrderMap.delete(order.id);
            this.safetyOrdersFilledCount++;
        }
        
        const perf = this.bot.performance;
        const isPositionIncreasing = order.side === (this.dcaConfig.strategy === 'LONG' ? 'buy' : 'sell');
        
        if (isPositionIncreasing) {
            // Calculate new average entry price
            this.totalQuoteAssetSpent += (order.amount * order.price);
            this.totalAmountFilled += order.amount;
            this.avgEntryPrice = this.totalQuoteAssetSpent / this.totalAmountFilled;
            perf.baseBalance += order.amount;
        } else {
            perf.baseBalance -= order.amount;
        }
        
        this.filledOrders.push(order);
        
        try {
            await this.recordTrade(order);
            
            if (!this.isPaused) {
                await this.syncSafetyOrders();
            }
        } catch (error) {
            await this.handleStrategyError(error as Error, 'onOrderFilled');
        }
    }
}

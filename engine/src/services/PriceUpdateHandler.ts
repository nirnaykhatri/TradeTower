/**
 * Price Update Handler
 * 
 * Consolidates price update logic across strategies:
 * - Pump protection (unusual fill velocity detection)
 * - Take profit checks (normal and trailing)
 * - Stop loss checks (normal and trailing)
 * - Unrealized PnL calculation and updates
 * 
 * This service extracts duplicate logic from:
 * - DCAStrategy, DCAFuturesStrategy
 * - GridStrategy, FuturesGridStrategy
 * - BTDStrategy
 * - LoopStrategy
 */

export interface PriceUpdateConfig {
    strategy: 'LONG' | 'SHORT';
    takeProfitPercent?: number;
    takeProfitCondition?: any;
    trailingTP?: boolean;
    trailingTPStep?: number;
    stopLossPercent?: number;
    trailingSL?: boolean;
    trailingSLStep?: number;
    feeBuffer?: number;
}

export interface PerformanceMetrics {
    unrealizedPnL: number;
    totalPnL: number;
    totalPnLPercent: number;
    avgEntryPrice: number;
    breakEvenPrice: number;
    drawdown: number;
}

export interface CheckIndicatorFn {
    (condition: any, isEntry?: boolean): Promise<boolean>;
}

export interface ExitTrigger {
    type: 'TAKE_PROFIT' | 'STOP_LOSS' | 'NONE';
    reason: string;
}

export class PriceUpdateHandler {
    private config: PriceUpdateConfig;
    private isTrailingTP: boolean = false;
    private trailingTPPrice: number = 0;
    private currentSLPrice: number = 0;
    private peakEquity: number = 0;
    private lastFills: number[] = [];

    private readonly MAX_FILL_HISTORY: number = 50;
    private readonly PUMP_PROTECTION_THRESHOLD: number = 3;
    private readonly PUMP_PROTECTION_WINDOW_MS: number = 5 * 60 * 1000; // 5 minutes

    constructor(config: PriceUpdateConfig) {
        this.config = config;
    }

    /**
     * Process price update and determine if exit should be triggered
     */
    async processPriceUpdate(
        currentPrice: number,
        avgEntryPrice: number,
        totalAmountFilled: number,
        investmentAmount: number,
        checkIndicator?: CheckIndicatorFn
    ): Promise<{ trigger: ExitTrigger; metrics: PerformanceMetrics }> {
        const metrics = this.calculateMetrics(
            currentPrice,
            avgEntryPrice,
            totalAmountFilled,
            investmentAmount
        );

        let trigger: ExitTrigger = { type: 'NONE', reason: '' };

        // Check take profit
        if (this.config.takeProfitPercent) {
            const tpTrigger = await this.checkTakeProfit(
                metrics,
                checkIndicator
            );
            if (tpTrigger.type !== 'NONE') {
                return { trigger: tpTrigger, metrics };
            }
        }

        // Check stop loss
        if (this.config.stopLossPercent || this.currentSLPrice > 0) {
            const slTrigger = this.checkStopLoss(currentPrice, metrics);
            if (slTrigger.type !== 'NONE') {
                return { trigger: slTrigger, metrics };
            }
        }

        return { trigger, metrics };
    }

    /**
     * Calculate current PnL and performance metrics
     */
    private calculateMetrics(
        currentPrice: number,
        avgEntryPrice: number,
        totalAmountFilled: number,
        investmentAmount: number
    ): PerformanceMetrics {
        const pnlPercent = this.calculatePnLPercent(currentPrice, avgEntryPrice);
        const factor = this.config.strategy === 'LONG' ? 1 : -1;
        const unrealizedPnL = (currentPrice - avgEntryPrice) * totalAmountFilled * factor;

        return {
            unrealizedPnL,
            totalPnL: unrealizedPnL,
            totalPnLPercent: (unrealizedPnL / investmentAmount) * 100,
            avgEntryPrice,
            breakEvenPrice: avgEntryPrice,
            drawdown: this.peakEquity > 0 
                ? ((this.peakEquity - (investmentAmount + unrealizedPnL)) / this.peakEquity) * 100
                : 0
        };
    }

    /**
     * Calculate PnL percentage
     */
    private calculatePnLPercent(currentPrice: number, avgEntryPrice: number): number {
        if (avgEntryPrice === 0) return 0;
        const factor = this.config.strategy === 'LONG' ? 1 : -1;
        return ((currentPrice - avgEntryPrice) / avgEntryPrice) * 100 * factor;
    }

    /**
     * Check if take profit condition is met
     */
    private async checkTakeProfit(
        metrics: PerformanceMetrics,
        checkIndicator?: CheckIndicatorFn
    ): Promise<ExitTrigger> {
        const tp = this.config.takeProfitPercent;
        if (!tp) return { type: 'NONE', reason: '' };

        const feeBuffer = (this.config.feeBuffer || 0.001) * 100 * 2; // round-trip fee
        const pnlPercent = this.calculatePnLPercent(metrics.avgEntryPrice, metrics.avgEntryPrice);

        // Handle trailing take profit
        if (this.config.trailingTP && this.config.trailingTPStep) {
            const tpThreshold = tp + feeBuffer;

            if (!this.isTrailingTP && pnlPercent >= tpThreshold) {
                this.isTrailingTP = true;
                this.trailingTPPrice = metrics.avgEntryPrice;
                return { type: 'NONE', reason: '' };
            }

            if (this.isTrailingTP) {
                // Update trailing price if new high
                const isNewHigh = this.config.strategy === 'LONG' 
                    ? metrics.avgEntryPrice > this.trailingTPPrice
                    : metrics.avgEntryPrice < this.trailingTPPrice;

                if (isNewHigh) {
                    this.trailingTPPrice = metrics.avgEntryPrice;
                }

                // Check for reversal trigger
                const reversalPercent = Math.abs(
                    (metrics.avgEntryPrice - this.trailingTPPrice) / this.trailingTPPrice * 100
                );

                if (reversalPercent >= (this.config.trailingTPStep || 0.5)) {
                    this.isTrailingTP = false;
                    return {
                        type: 'TAKE_PROFIT',
                        reason: `Trailing TP reversal (${reversalPercent.toFixed(2)}% drop from high)`
                    };
                }
            }
        } else if (pnlPercent >= (tp + feeBuffer)) {
            // Normal take profit
            if (this.config.takeProfitCondition && checkIndicator) {
                const indicatorOk = await checkIndicator(this.config.takeProfitCondition, false);
                if (!indicatorOk) {
                    return { type: 'NONE', reason: '' };
                }
            }

            return { type: 'TAKE_PROFIT', reason: `TP reached: ${pnlPercent.toFixed(2)}%` };
        }

        return { type: 'NONE', reason: '' };
    }

    /**
     * Check if stop loss is triggered
     */
    private checkStopLoss(
        currentPrice: number,
        metrics: PerformanceMetrics
    ): ExitTrigger {
        // Handle trailing stop loss
        if (this.config.trailingSL && this.config.trailingSLStep) {
            const slStepFactor = this.config.strategy === 'LONG'
                ? (1 - this.config.trailingSLStep / 100)
                : (1 + this.config.trailingSLStep / 100);

            const potentialNewSL = currentPrice * slStepFactor;

            if (this.config.strategy === 'LONG' && potentialNewSL > this.currentSLPrice) {
                this.currentSLPrice = potentialNewSL;
            } else if (this.config.strategy === 'SHORT' && potentialNewSL < this.currentSLPrice) {
                this.currentSLPrice = potentialNewSL;
            }
        }

        // Check if SL is triggered
        if (this.currentSLPrice > 0) {
            const slTriggered = this.config.strategy === 'LONG'
                ? currentPrice <= this.currentSLPrice
                : currentPrice >= this.currentSLPrice;

            if (slTriggered) {
                const pnlPercent = this.calculatePnLPercent(currentPrice, metrics.avgEntryPrice);
                return {
                    type: 'STOP_LOSS',
                    reason: `SL triggered at ${pnlPercent.toFixed(2)}% loss`
                };
            }
        }

        return { type: 'NONE', reason: '' };
    }

    /**
     * Detect unusual fill velocity (pump protection)
     */
    detectUnusualVelocity(): boolean {
        if (this.lastFills.length < this.PUMP_PROTECTION_THRESHOLD) {
            return false;
        }

        const now = Date.now();
        const recent = this.lastFills.filter(
            t => now - t < this.PUMP_PROTECTION_WINDOW_MS
        );

        return recent.length >= this.PUMP_PROTECTION_THRESHOLD;
    }

    /**
     * Record a fill for pump protection tracking
     */
    recordFill(): void {
        this.lastFills.push(Date.now());
        if (this.lastFills.length > this.MAX_FILL_HISTORY) {
            this.lastFills.shift();
        }
    }

    /**
     * Set initial stop loss price
     */
    setInitialStopLoss(entryPrice: number, stopLossPercent: number): void {
        const factor = this.config.strategy === 'LONG' ? -1 : 1;
        this.currentSLPrice = entryPrice * (1 + (stopLossPercent / 100) * factor);
    }

    /**
     * Update stop loss price (for add funds scenario)
     */
    updateStopLoss(newEntryPrice: number, stopLossPercent: number): void {
        const oldSL = this.currentSLPrice;
        this.setInitialStopLoss(newEntryPrice, stopLossPercent);
        console.log(`[PriceUpdateHandler] Stop Loss updated: ${oldSL.toFixed(8)} → ${this.currentSLPrice.toFixed(8)}`);
    }

    /**
     * Get current stop loss price
     */
    getCurrentSLPrice(): number {
        return this.currentSLPrice;
    }

    /**
     * Set peak equity for drawdown calculation
     */
    setPeakEquity(equity: number): void {
        if (equity > this.peakEquity) {
            this.peakEquity = equity;
        }
    }

    /**
     * Reset state for new cycle
     */
    reset(): void {
        this.isTrailingTP = false;
        this.trailingTPPrice = 0;
        this.currentSLPrice = 0;
        this.lastFills = [];
    }

    /**
     * Update configuration
     */
    updateConfig(partialConfig: Partial<PriceUpdateConfig>): void {
        this.config = { ...this.config, ...partialConfig };
    }
}

/**
 * Position Tracker Interface
 * 
 * Consolidates all position state for DCA strategies (spot and futures).
 * Provides a single source of truth for position accounting, reducing bugs
 * from scattered state variables and enabling better encapsulation.
 * 
 * Used by BaseDCAStrategy to track:
 * - Position entry metrics (average price, total amount)
 * - Safety order progress (filled count, next index)
 * - Trailing take/stop loss state
 * - Entry condition state
 */
export interface PositionTracker {
    /** === Position Entry Metrics === */
    
    /** Volume-weighted average entry price across all fills */
    avgEntryPrice: number;
    
    /** Total position size in base asset units */
    totalAmountFilled: number;
    
    /** Total invested in quote asset (sum of all buy costs) */
    totalQuoteAssetSpent: number;

    /** === Safety Order Accounting === */
    
    /** Number of safety orders that have been filled */
    safetyOrdersFilledCount: number;
    
    /** Index of next safety order to place (0-based) */
    nextSafetyOrderToIndex: number;

    /** === Trailing Take Profit State === */
    
    /** Whether trailing take profit is currently active */
    isTrailingTP: boolean;
    
    /** Peak price reached during trailing TP (for reversal detection) */
    trailingTPPrice: number;

    /** === Stop Loss State === */
    
    /** Current trigger price for stop loss order */
    currentSLPrice: number;

    /** === Entry Condition State === */
    
    /** Whether bot is waiting for entry condition to be satisfied */
    isWaitingForEntry: boolean;

    /** === Utility Methods === */
    
    /**
     * Reset all position tracking for new cycle
     */
    reset(): void;

    /**
     * Calculate current position PnL given a price
     * @param currentPrice Current market price
     * @param strategy Strategy direction ('LONG' or 'SHORT')
     * @returns PnL as percentage
     */
    calculatePnL(currentPrice: number, strategy: 'LONG' | 'SHORT'): number;

    /**
     * Check if position is open (has filled orders)
     * @returns True if totalAmountFilled > 0
     */
    isPositionOpen(): boolean;
}

/**
 * Default PositionTracker Implementation
 * 
 * Encapsulates all position state in one object.
 * Can be extended for specialized tracking (e.g., futures liquidation tracking).
 */
export class PositionTrackerImpl implements PositionTracker {
    avgEntryPrice: number = 0;
    totalAmountFilled: number = 0;
    totalQuoteAssetSpent: number = 0;
    safetyOrdersFilledCount: number = 0;
    nextSafetyOrderToIndex: number = 0;
    isTrailingTP: boolean = false;
    trailingTPPrice: number = 0;
    currentSLPrice: number = 0;
    isWaitingForEntry: boolean = false;

    reset(): void {
        this.avgEntryPrice = 0;
        this.totalAmountFilled = 0;
        this.totalQuoteAssetSpent = 0;
        this.safetyOrdersFilledCount = 0;
        this.nextSafetyOrderToIndex = 0;
        this.isTrailingTP = false;
        this.trailingTPPrice = 0;
        this.currentSLPrice = 0;
        this.isWaitingForEntry = false;
    }

    calculatePnL(currentPrice: number, strategy: 'LONG' | 'SHORT'): number {
        if (this.totalAmountFilled === 0) return 0;

        const priceDiff = currentPrice - this.avgEntryPrice;
        const factor = strategy === 'LONG' ? 1 : -1;
        return (priceDiff * factor / this.avgEntryPrice) * 100;
    }

    isPositionOpen(): boolean {
        return this.totalAmountFilled > 0;
    }
}

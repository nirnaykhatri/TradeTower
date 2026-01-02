/**
 * Closure strategies for bot shutdown per Bitsgap Managing and Modifying Bot guide
 * - CLOSE_POSITIONS: Execute market order to close all positions and lock in PnL
 * - CANCEL_ORDERS: Cancel all open orders but keep the position in exchange
 * - LIQUIDATE: Force close everything (market order) and withdraw if possible
 */
export type BotClosureStrategy = 'CLOSE_POSITIONS' | 'CANCEL_ORDERS' | 'LIQUIDATE';

export interface BotClosureConfig {
    strategy: BotClosureStrategy;
    closeFees?: number; // Estimated fees for closing
    force?: boolean; // Force close even if it exceeds slippage limits
}

export interface IndicatorCondition {
    type: 'RSI' | 'MACD' | 'Stochastic' | 'TradingView';
    timeframe: '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d';
    config?: any; // e.g. { oversold: 30, overbought: 70 }
}

export interface GridConfig {
    lowPrice: number;
    highPrice: number;
    highPriceTrailing?: boolean;
    gridStep: number;
    gridLevels: number;
    orderSizeCurrency: 'BASE' | 'QUOTE';
    investment: number;
    feeBuffer?: number; // e.g., 0.001 = 0.1%, configurable per exchange/market
    trailingUp?: boolean;
    pumpProtection?: boolean;
    trailingDown?: boolean;
    stopTrailingDownPrice?: number; // Minimum price to stop trailing down extension
    stopLoss?: number;
    stopLossEnabled?: boolean;
    takeProfit?: number;
    takeProfitEnabled?: boolean;
}

export interface DCAConfig {
    strategy: 'LONG' | 'SHORT';
    investment: number;
    feeBuffer?: number; // 0-1% recommended; protects edge fills
    baseOrderAmount: number;
    baseOrderCondition: 'IMMEDIATELY' | 'INDICATOR' | 'TRADINGVIEW';
    baseOrderType: 'LIMIT' | 'MARKET';
    triggerPrice?: number;
    entryIndicator?: IndicatorCondition;
    entryIndicators?: IndicatorCondition[];
    averagingOrdersAmount: number;
    averagingOrdersQuantity: number;
    averagingOrdersStep: number;
    activeOrdersLimit?: number;
    activeOrdersLimitEnabled?: boolean;
    amountMultiplier?: number;
    stepMultiplier?: number;
    takeProfitPercent?: number;
    takeProfitCondition?: IndicatorCondition;
    trailingTP?: boolean;
    trailingTPStep?: number; // % step to follow
    stopLossPercent?: number;
    placeSafetyOrdersAtStart?: boolean;
    reinvestProfit?: boolean;
    reinvestProfitPercent?: number; // 0-100: % of profit to reinvest into next cycle
    cooldownSeconds?: number;
    trailingSL?: boolean;
    trailingSLStep?: number;
    maxPrice?: number;
    minPrice?: number;
    reserveFundsEnabled?: boolean; // When maxPrice is set, automatically reserve funds via limit order
    targetTotalProfit?: number;
    allowedTotalLoss?: number;
    pumpProtection?: boolean;
}

export interface BTDConfig {
    investment: number;
    feeBuffer?: number;
    lowPrice: number;
    lowPriceTrailing?: boolean;
    highPrice: number;
    gridStep: number;
    gridLevels: number;
    levelsDown: number;
    levelsUp: number;
    levelsDistribution: number;
    trailing?: boolean;
    stopLoss?: number;
    stopLossEnabled?: boolean;
    takeProfit?: number;
    takeProfitEnabled?: boolean;
}

export interface ComboConfig extends DCAFuturesConfig {
    // Price Range Configuration (defines DCA vs Grid zones per Bitsgap spec)
    lowPrice: number;      // LONG: DCA zone below this | SHORT: Grid zone below this
    highPrice: number;     // LONG: Grid zone above this | SHORT: DCA zone above this
    feeBuffer?: number;
    
    // DCA Configuration (Entry Phase - inherited from DCAFuturesConfig)
    // - averagingOrdersQuantity: Number of DCA/safety orders
    // - averagingOrdersStep: % step between DCA levels
    // - baseOrderAmount: First entry order size
    // - averagingOrdersAmount: Size of DCA orders
    
    // Grid Configuration (Exit Phase - Profit Taking)
    gridStep: number;      // % step between grid levels (same as DCA step per Bitsgap)
    gridLevels: number;    // Number of profit-taking grid levels
    
    // Take Profit Configuration (optional, can be omitted for grid-only exit)
    takeProfitType?: 'PERCENT' | 'PRICE'; // Support both % and price target
    takeProfitPrice?: number; // Fixed price target for TP
    takeProfitPercent?: number; // Percentage profit target (inherited from parent)
    
    // Stop Loss Configuration (default: trailing enabled per Bitsgap)
    stopLossType?: 'PERCENT' | 'PRICE'; // Support both % and fixed price
    stopLossPrice?: number; // Fixed price level for SL
    stopLossPercent?: number; // Percentage stop loss (inherited from parent)
    trailingStopLoss?: boolean; // Enable trailing SL (default: true per Bitsgap docs)
    trailingStopPercent?: number; // % amount to trail behind favorable price
}

export interface LoopConfig {
    investment: number;
    feeBuffer?: number;
    lowPrice: number;
    highPrice: number;
    orderDistance: number;
    orderCount: number;
    takeProfit?: number;
    reinvestProfit?: boolean;
    reinvestProfitPercent?: number; // 0-100: % of profit to reinvest
    takeProfitEnabled?: boolean;
}

export interface DCAFuturesConfig {
    strategy: 'LONG' | 'SHORT';
    feeBuffer?: number;
    initialMargin: number; // For futures
    leverage: number; // For futures
    marginType: 'CROSS' | 'ISOLATED'; // For futures
    baseOrderAmount: number;
    baseOrderCondition?: 'IMMEDIATELY' | 'INDICATOR' | 'TRADINGVIEW';
    baseOrderType?: 'LIMIT' | 'MARKET';
    entryIndicators?: IndicatorCondition[];
    averagingOrdersAmount: number;
    averagingOrdersQuantity: number;
    averagingOrdersStep: number;
    activeOrdersLimit?: number;
    activeOrdersLimitEnabled?: boolean;
    amountMultiplier?: number;
    stepMultiplier?: number;
    
    // Take Profit with type support
    takeProfitPercent?: number; // For % based TP
    takeProfitPrice?: number; // NEW: For fixed price TP
    takeProfitType?: 'PERCENT' | 'PRICE'; // NEW: Type selector
    takeProfitCondition?: IndicatorCondition;
    
    // Stop Loss with type support
    stopLossPercent?: number; // For % based SL
    stopLossPrice?: number; // NEW: For fixed price SL
    stopLossType?: 'PERCENT' | 'PRICE'; // NEW: Type selector
    
    // Trailing Stop Loss
    trailingStopLoss?: boolean; // NEW: Enable/disable trailing (default: true per Bitsgap docs)
    trailingStopPercent?: number; // NEW: % amount to trail
    
    liquidationBuffer?: number;
    placeSafetyOrdersAtStart?: boolean;
}

export interface FuturesGridConfig {
    strategyType: 'LONG' | 'SHORT' | 'NEUTRAL';
    feeBuffer?: number;
    marginType: 'ISOLATED' | 'CROSS';
    leverage: number;
    investment: number;
    lowPrice: number;
    highPrice: number;
    gridQuantity: number;
    gridMode: 'ARITHMETIC' | 'GEOMETRIC';
    triggerPrice?: number;
    stopLoss?: number;
    takeProfit?: number;
    closePositionOnStop?: boolean;
    trailingUp?: boolean;
    trailingDown?: boolean;
}

export interface TWAPConfig {
    direction: 'BUY' | 'SELL';
    feeBuffer?: number;
    totalAmount: number;
    duration: number; // minutes
    frequency: number; // seconds
    marginType: 'ISOLATED' | 'CROSS';
    leverage: number;
    reduceOnly?: boolean;
    priceLimit?: number;
}

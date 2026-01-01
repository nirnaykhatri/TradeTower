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
    trailingUp?: boolean;
    pumpProtection?: boolean;
    trailingDown?: boolean;
    stopLoss?: number;
    stopLossEnabled?: boolean;
    takeProfit?: number;
    takeProfitEnabled?: boolean;
}

export interface DCAConfig {
    strategy: 'LONG' | 'SHORT';
    investment: number;
    baseOrderAmount: number;
    baseOrderCondition: 'IMMEDIATELY' | 'PRICE_CHANGE' | 'MANUAL' | 'INDICATOR';
    baseOrderType: 'LIMIT' | 'MARKET';
    triggerPrice?: number;
    entryIndicator?: IndicatorCondition;
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
    cooldownSeconds?: number;
    trailingSL?: boolean;
    trailingSLStep?: number;
    maxPrice?: number;
    minPrice?: number;
    targetTotalProfit?: number;
    allowedTotalLoss?: number;
    pumpProtection?: boolean;
}

export interface BTDConfig {
    investment: number;
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

export interface ComboConfig extends BTDConfig {
    positionSizeLimit?: number;
    reuseCompletedOrders?: boolean;
    dynamicRebalancing?: boolean;
}

export interface LoopConfig {
    investment: number;
    lowPrice: number;
    highPrice: number;
    orderDistance: number;
    orderCount: number;
    takeProfit?: number;
    takeProfitEnabled?: boolean;
}

export interface DCAFuturesConfig {
    strategy: 'LONG' | 'SHORT';
    initialMargin: number; // For futures
    leverage: number; // For futures
    marginType: 'CROSS' | 'ISOLATED'; // For futures
    baseOrderAmount: number;
    baseOrderCondition?: 'IMMEDIATELY' | 'PRICE_CHANGE' | 'MANUAL';
    baseOrderType?: 'LIMIT' | 'MARKET';
    averagingOrdersAmount: number;
    averagingOrdersQuantity: number;
    averagingOrdersStep: number;
    activeOrdersLimit?: number;
    activeOrdersLimitEnabled?: boolean;
    amountMultiplier?: number;
    stepMultiplier?: number;
    takeProfitPercent?: number;
    takeProfitCondition?: IndicatorCondition;
    stopLossPercent?: number;
    liquidationBuffer?: number;
    placeSafetyOrdersAtStart?: boolean;
}

export interface FuturesGridConfig {
    strategyType: 'LONG' | 'SHORT' | 'NEUTRAL';
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
    totalAmount: number;
    duration: number; // minutes
    frequency: number; // seconds
    marginType: 'ISOLATED' | 'CROSS';
    leverage: number;
    reduceOnly?: boolean;
    priceLimit?: number;
}

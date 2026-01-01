/**
 * Strategy execution constants
 * Centralized constants to avoid magic numbers throughout the codebase
 */

/**
 * Price tolerance for matching orders to grid levels (0.1%)
 */
export const PRICE_TOLERANCE = 0.001;

/**
 * Maximum number of fill records to keep in history
 */
export const MAX_FILL_HISTORY = 10;

/**
 * Threshold for pump protection - number of fills in short time
 */
export const PUMP_PROTECTION_THRESHOLD = 3;

/**
 * Time window for pump protection (5 seconds)
 */
export const PUMP_PROTECTION_WINDOW_MS = 5000;

/**
 * Default take profit percentage for strategies
 */
export const DEFAULT_TAKE_PROFIT_PERCENT = 1.0;

/**
 * Default stop loss percentage for strategies
 */
export const DEFAULT_STOP_LOSS_PERCENT = 5.0;

/**
 * Minimum delay between orders (ms)
 */
export const MIN_ORDER_DELAY_MS = 100;

/**
 * Default RSI oversold level
 */
export const RSI_OVERSOLD_DEFAULT = 30;

/**
 * Default RSI overbought level
 */
export const RSI_OVERBOUGHT_DEFAULT = 70;

/**
 * Default Stochastic oversold level
 */
export const STOCHASTIC_OVERSOLD_DEFAULT = 20;

/**
 * Default Stochastic overbought level
 */
export const STOCHASTIC_OVERBOUGHT_DEFAULT = 80;

/**
 * Default MACD fast period
 */
export const MACD_FAST_PERIOD_DEFAULT = 12;

/**
 * Default MACD slow period
 */
export const MACD_SLOW_PERIOD_DEFAULT = 26;

/**
 * Default MACD signal period
 */
export const MACD_SIGNAL_PERIOD_DEFAULT = 9;

/**
 * Default RSI period
 */
export const RSI_PERIOD_DEFAULT = 14;

/**
 * Minimum investment amount (in quote currency)
 */
export const MIN_INVESTMENT_AMOUNT = 10;

/**
 * Maximum concurrent active bots per user
 */
export const MAX_CONCURRENT_BOTS = 1000;

/**
 * Performance calculation precision (decimal places)
 */
export const PERFORMANCE_PRECISION = 8;

/**
 * Minimum price change threshold for bot triggers (0.01%)
 */
export const MIN_PRICE_CHANGE_THRESHOLD = 0.0001;

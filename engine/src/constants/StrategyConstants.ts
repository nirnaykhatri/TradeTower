/**
 * Strategy Constants and Configuration
 * 
 * Centralizes all magic numbers and constants used across strategies.
 * Makes it easy to adjust behavior without touching strategy code.
 */

/**
 * DCA Strategy Constants
 */
export const DCA_CONSTANTS = {
  // Reservation order settings
  RESERVATION_PRICE_DEVIATION: 0.5,           // 50% away from market
  RESERVATION_PRICE_DEVIATION_SHORT: 1.5,    // 150% for SHORT positions
  RESERVATION_ORDER_TTL_MS: 24 * 60 * 60 * 1000, // 24 hours
  
  // Insufficient funds handling
  INSUFFICIENT_FUNDS_RETRY_INTERVAL_MS: 5 * 60 * 1000, // 5 minutes
  MAX_INSUFFICIENT_FUNDS_RETRIES: 3,                   // Give up after 3 retries
  
  // Safety order limits
  MAX_SAFETY_ORDERS: 100,
  MAX_ACTIVE_ORDERS: 100,
  
  // Profit reinvestment
  DEFAULT_REINVEST_PERCENT: 100,  // By default, reinvest all profit
  MIN_REINVEST_PERCENT: 0,        // Allow 0% (keep profit)
  MAX_REINVEST_PERCENT: 100,      // Can't reinvest >100%
} as const;

/**
 * Grid Trading Constants
 */
export const GRID_CONSTANTS = {
  // Grid calculation
  MIN_GRID_LEVELS: 5,
  MAX_GRID_LEVELS: 100,
  MIN_GRID_STEP_PERCENT: 0.1,
  MAX_GRID_STEP_PERCENT: 100,
  
  // Pump protection
  PUMP_PROTECTION_THRESHOLD: 3,              // Orders within time window
  PUMP_PROTECTION_WINDOW_MS: 5 * 60 * 1000,  // 5 minute window
  
  // Fee buffer (in percentage of order size)
  FEE_BUFFER_PERCENT: 0.1, // 0.1% buffer for fees
  MIN_FEE_BUFFER: 0,
  MAX_FEE_BUFFER: 1,
  
  // Trailing thresholds
  TRAILING_UP_THRESHOLD_PERCENT: 2.0,   // Move up if price > 2%
  TRAILING_DOWN_THRESHOLD_PERCENT: 2.0, // Move down if price < -2%
  
  // Order count limits
  MAX_ORDERS_ON_BOOK: 200,
} as const;

/**
 * BTD (Buy The Dip) Strategy Constants
 */
export const BTD_CONSTANTS = {
  // Asymmetric grid
  MIN_LEVELS_DOWN: 1,      // Minimum buys below current
  MIN_LEVELS_UP: 1,        // Minimum sells above current
  MAX_TOTAL_LEVELS: 100,
  
  // Distribution bias
  DEFAULT_LEVELS_DISTRIBUTION: 70, // 70% of levels below current price
  
  // Grid movement
  DIPPING_THRESHOLD_PERCENT: 5,  // Trailing activates at 5% drop
  RECOVERY_THRESHOLD_PERCENT: 5, // Trailing activates at 5% recovery
} as const;

/**
 * Futures Trading Constants
 */
export const FUTURES_CONSTANTS = {
  // Leverage limits
  MIN_LEVERAGE: 1,
  MAX_LEVERAGE: 125,
  
  // Margin requirements
  MIN_LIQUIDATION_BUFFER_PERCENT: 5,    // Minimum 5% buffer
  MAX_LIQUIDATION_BUFFER_PERCENT: 50,   // Maximum 50% buffer
  DEFAULT_LIQUIDATION_BUFFER_PERCENT: 10,
  
  // Positions
  MIN_POSITION_SIZE_PERCENT: 1,  // Position must be at least 1% of balance
  
  // Trailing stop loss
  MIN_TRAILING_STOP_PERCENT: 0.1,
  MAX_TRAILING_STOP_PERCENT: 50,
} as const;

/**
 * Loop Strategy Constants
 */
export const LOOP_CONSTANTS = {
  // Order placement
  MIN_ORDER_COUNT: 1,
  MAX_ORDER_COUNT: 100,
  MIN_ORDER_DISTANCE_PERCENT: 0.1,
  MAX_ORDER_DISTANCE_PERCENT: 50,
  
  // Profit reinvestment
  DEFAULT_REINVEST_PERCENT: 100,
} as const;

/**
 * Global Strategy Constants
 */
export const GLOBAL_CONSTANTS = {
  // Time-based
  PRICE_UPDATE_DEBOUNCE_MS: 100,    // Minimum time between price updates
  ORDER_STATUS_CHECK_INTERVAL_MS: 5000, // Check order status every 5s
  PERFORMANCE_UPDATE_INTERVAL_MS: 10000, // Update metrics every 10s
  
  // Price precision
  PRICE_TOLERANCE: 0.0001,           // Prices must differ by at least this
  AMOUNT_TOLERANCE: 0.00000001,      // Amounts must differ by at least this
  
  // Fill history
  MAX_FILL_HISTORY: 100,             // Keep last 100 fills for pump detection
  
  // Error handling
  DEFAULT_MAX_RETRIES: 3,
  DEFAULT_RETRY_DELAY_MS: 1000,
  MAX_RETRY_DELAY_MS: 30000,         // Cap at 30 seconds
  
  // Logging
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  ENABLE_DEBUG_LOGGING: process.env.DEBUG_LOGGING === 'true',
} as const;

/**
 * Order Placement Constants
 */
export const ORDER_PLACEMENT_CONSTANTS = {
  // Retry logic
  MAX_RETRIES: 3,
  INITIAL_RETRY_DELAY_MS: 1000,      // Start with 1 second
  EXPONENTIAL_BACKOFF_MULTIPLIER: 2, // Double delay each retry
  MAX_RETRY_DELAY_MS: 30000,         // Cap at 30 seconds
  
  // Timeouts
  ORDER_PLACEMENT_TIMEOUT_MS: 30000, // 30 second timeout
  ORDER_CANCELLATION_TIMEOUT_MS: 15000,
  
  // Batch operations
  MAX_PARALLEL_ORDERS: 10,            // Place max 10 orders in parallel
  SEQUENTIAL_ORDER_DELAY_MS: 100,    // 100ms between sequential orders
} as const;

/**
 * Configuration Validation Constants
 */
export const VALIDATION_CONSTANTS = {
  // Investment amounts
  MIN_INVESTMENT: 10,                // Minimum $10 investment
  MAX_INVESTMENT: 1000000,           // Maximum $1M per bot
  
  // Prices
  MIN_PRICE: 0.00000001,
  MAX_PRICE: 1000000,
  
  // Percentages
  MIN_PERCENT: 0,
  MAX_PERCENT: 10000,                // Allows 100x moves
  
  // Duration (in minutes)
  MIN_DURATION_MINUTES: 5,
  MAX_DURATION_MINUTES: 1440,        // 24 hours
  
  // Frequency (in seconds)
  MIN_FREQUENCY_SECONDS: 5,
  MAX_FREQUENCY_SECONDS: 3600,       // 1 hour
} as const;

/**
 * Performance Monitoring Constants
 */
export const PERFORMANCE_CONSTANTS = {
  // Drawdown calculation
  DRAWDOWN_UPDATE_INTERVAL_MS: 60000, // Update every minute
  
  // Win rate calculation
  MIN_TRADES_FOR_WIN_RATE: 5,        // Need at least 5 trades for valid win rate
  
  // Performance snapshots
  SNAPSHOT_INTERVAL_MS: 3600000,     // Every hour
  MAX_SNAPSHOTS_TO_KEEP: 168,        // Keep 1 week of hourly snapshots
} as const;

/**
 * Helper function to convert percentages to decimals
 * @example percentToDecimal(25) returns 0.25
 */
export function percentToDecimal(percent: number): number {
  return percent / 100;
}

/**
 * Helper function to convert decimals to percentages
 * @example decimalToPercent(0.25) returns 25
 */
export function decimalToPercent(decimal: number): number {
  return decimal * 100;
}

/**
 * Helper function to validate percentage
 */
export function isValidPercent(value: number, min = 0, max = 100): boolean {
  return value >= min && value <= max && !isNaN(value) && isFinite(value);
}

/**
 * Helper function to validate positive number
 */
export function isValidPositiveNumber(value: number): boolean {
  return value > 0 && !isNaN(value) && isFinite(value);
}

/**
 * Helper function to clamp value between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

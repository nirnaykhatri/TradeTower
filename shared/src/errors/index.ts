/**
 * Custom error classes for the TradeTower application
 * Provides structured error handling with proper error hierarchies
 */

/**
 * Base error class for all application errors
 */
export class AppError extends Error {
    constructor(
        message: string,
        public readonly code: string,
        public readonly statusCode: number = 500,
        public readonly isOperational: boolean = true
    ) {
        super(message);
        this.name = this.constructor.name;
        Error.captureStackTrace(this, this.constructor);
    }
}

/**
 * Validation errors for invalid input data
 */
export class ValidationError extends AppError {
    constructor(message: string, public readonly field?: string) {
        super(message, 'VALIDATION_ERROR', 400);
    }
}

/**
 * Business rule violations
 */
export class BusinessRuleError extends AppError {
    constructor(message: string) {
        super(message, 'BUSINESS_RULE_ERROR', 422);
    }
}

/**
 * Database operation errors
 */
export class DatabaseError extends AppError {
    constructor(message: string, public readonly originalError?: Error) {
        super(message, 'DATABASE_ERROR', 500);
    }
}

/**
 * Exchange connector errors (API failures, rate limits, etc.)
 */
export class ExchangeError extends AppError {
    constructor(
        message: string,
        public readonly exchange: string,
        public readonly originalError?: Error,
        public readonly isRetryable: boolean = true
    ) {
        super(message, 'EXCHANGE_ERROR', 502);
    }
}

/**
 * Critical errors that require immediate bot shutdown
 */
export class CriticalStrategyError extends AppError {
    constructor(message: string, public readonly botId: string) {
        super(message, 'CRITICAL_STRATEGY_ERROR', 500, false);
    }
}

/**
 * Order execution errors
 */
export class OrderExecutionError extends AppError {
    constructor(
        message: string,
        public readonly orderId?: string,
        public readonly isRetryable: boolean = true
    ) {
        super(message, 'ORDER_EXECUTION_ERROR', 500);
    }
}

/**
 * Configuration errors
 */
export class ConfigurationError extends AppError {
    constructor(message: string) {
        super(message, 'CONFIGURATION_ERROR', 500, false);
    }
}

/**
 * Resource not found errors
 */
export class NotFoundError extends AppError {
    constructor(resource: string, identifier: string) {
        super(`${resource} not found: ${identifier}`, 'NOT_FOUND', 404);
    }
}

/**
 * Retry policy configuration
 */
export interface RetryPolicy {
    maxRetries: number;
    initialDelayMs: number;
    maxDelayMs: number;
    backoffMultiplier: number;
}

/**
 * Default retry policies for different error types
 */
export const DEFAULT_RETRY_POLICIES: Record<string, RetryPolicy> = {
    EXCHANGE_ERROR: {
        maxRetries: 3,
        initialDelayMs: 1000,
        maxDelayMs: 10000,
        backoffMultiplier: 2
    },
    DATABASE_ERROR: {
        maxRetries: 3,
        initialDelayMs: 500,
        maxDelayMs: 5000,
        backoffMultiplier: 2
    },
    ORDER_EXECUTION_ERROR: {
        maxRetries: 2,
        initialDelayMs: 2000,
        maxDelayMs: 8000,
        backoffMultiplier: 2
    }
};

/**
 * Utility to determine if an error should be retried
 */
export function isRetryableError(error: Error): boolean {
    if (error instanceof ExchangeError) {
        return error.isRetryable;
    }
    if (error instanceof OrderExecutionError) {
        return error.isRetryable;
    }
    if (error instanceof DatabaseError) {
        return true;
    }
    return false;
}

/**
 * Sleep utility for retry delays
 */
export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute a function with retry logic
 */
export async function withRetry<T>(
    fn: () => Promise<T>,
    policy: RetryPolicy,
    context: string
): Promise<T> {
    let lastError: Error;
    let delay = policy.initialDelayMs;

    for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error as Error;

            // Don't retry on final attempt or non-retryable errors
            if (attempt === policy.maxRetries || !isRetryableError(lastError)) {
                break;
            }

            console.warn(
                `[Retry] ${context} failed (attempt ${attempt + 1}/${policy.maxRetries + 1}). ` +
                `Retrying in ${delay}ms...`,
                lastError.message
            );

            await sleep(delay);
            delay = Math.min(delay * policy.backoffMultiplier, policy.maxDelayMs);
        }
    }

    throw lastError!;
}

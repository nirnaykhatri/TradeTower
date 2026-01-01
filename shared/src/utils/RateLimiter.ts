/**
 * Rate limiter implementation to prevent API rate limit violations
 * Uses token bucket algorithm for smooth rate limiting
 */

export interface RateLimiterConfig {
    /**
     * Maximum number of requests allowed per time window
     */
    maxRequests: number;
    
    /**
     * Time window in milliseconds
     */
    windowMs: number;
    
    /**
     * Minimum delay between requests (ms)
     */
    minInterval?: number;
}

/**
 * Rate limiter using token bucket algorithm
 */
export class RateLimiter {
    private tokens: number;
    private lastRefill: number;
    private queue: Array<() => void> = [];
    private processing = false;

    constructor(private config: RateLimiterConfig) {
        this.tokens = config.maxRequests;
        this.lastRefill = Date.now();
    }

    /**
     * Refill tokens based on time elapsed
     */
    private refillTokens(): void {
        const now = Date.now();
        const timePassed = now - this.lastRefill;
        const tokensToAdd = (timePassed / this.config.windowMs) * this.config.maxRequests;
        
        this.tokens = Math.min(this.config.maxRequests, this.tokens + tokensToAdd);
        this.lastRefill = now;
    }

    /**
     * Wait for a token to become available
     */
    private async waitForToken(): Promise<void> {
        return new Promise((resolve) => {
            this.queue.push(resolve);
            this.processQueue();
        });
    }

    /**
     * Process queued requests
     */
    private async processQueue(): Promise<void> {
        if (this.processing || this.queue.length === 0) {
            return;
        }

        this.processing = true;

        while (this.queue.length > 0) {
            this.refillTokens();

            if (this.tokens >= 1) {
                this.tokens -= 1;
                const resolve = this.queue.shift();
                if (resolve) {
                    resolve();
                }

                // Apply minimum interval if configured
                if (this.config.minInterval) {
                    await new Promise(r => setTimeout(r, this.config.minInterval));
                }
            } else {
                // Wait for tokens to refill
                const waitTime = (this.config.windowMs / this.config.maxRequests) * (1 - this.tokens);
                await new Promise(r => setTimeout(r, Math.max(100, waitTime)));
            }
        }

        this.processing = false;
    }

    /**
     * Throttle a function execution with rate limiting
     */
    async throttle<T>(fn: () => Promise<T>): Promise<T> {
        await this.waitForToken();
        return fn();
    }

    /**
     * Execute a function with rate limiting and return result
     */
    async execute<T>(fn: () => Promise<T>): Promise<T> {
        return this.throttle(fn);
    }

    /**
     * Get current token count (for monitoring)
     */
    getTokenCount(): number {
        this.refillTokens();
        return this.tokens;
    }

    /**
     * Get queue length (for monitoring)
     */
    getQueueLength(): number {
        return this.queue.length;
    }

    /**
     * Reset rate limiter state
     */
    reset(): void {
        this.tokens = this.config.maxRequests;
        this.lastRefill = Date.now();
        this.queue = [];
        this.processing = false;
    }
}

/**
 * Create default rate limiters for common exchanges
 */
export const ExchangeRateLimiters = {
    /**
     * Binance: 1200 requests per minute
     */
    BINANCE: new RateLimiter({
        maxRequests: 1200,
        windowMs: 60000,
        minInterval: 50
    }),

    /**
     * Coinbase: 10 requests per second
     */
    COINBASE: new RateLimiter({
        maxRequests: 10,
        windowMs: 1000,
        minInterval: 100
    }),

    /**
     * Alpaca: 200 requests per minute
     */
    ALPACA: new RateLimiter({
        maxRequests: 200,
        windowMs: 60000,
        minInterval: 300
    }),

    /**
     * Generic/Conservative: 60 requests per minute
     */
    DEFAULT: new RateLimiter({
        maxRequests: 60,
        windowMs: 60000,
        minInterval: 1000
    })
};

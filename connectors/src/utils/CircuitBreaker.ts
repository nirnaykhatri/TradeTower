/**
 * Circuit Breaker Pattern Implementation
 * 
 * Prevents cascade failures by temporarily disabling failing services.
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Service is failing, requests fail fast without calling service
 * - HALF_OPEN: Testing if service has recovered
 * 
 * Transitions:
 * CLOSED -> OPEN: When failure threshold is exceeded
 * OPEN -> HALF_OPEN: After timeout period
 * HALF_OPEN -> CLOSED: When test request succeeds
 * HALF_OPEN -> OPEN: When test request fails
 */

export enum CircuitBreakerState {
    CLOSED = 'CLOSED',
    OPEN = 'OPEN',
    HALF_OPEN = 'HALF_OPEN'
}

export interface CircuitBreakerConfig {
    /**
     * Number of failures before opening circuit
     */
    failureThreshold: number;

    /**
     * Time window for counting failures (ms)
     */
    failureWindowMs: number;

    /**
     * Time to wait before attempting recovery (ms)
     */
    resetTimeoutMs: number;

    /**
     * Number of successful calls needed to close circuit from half-open
     */
    successThreshold: number;
}

export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
    failureThreshold: 5,
    failureWindowMs: 60000, // 1 minute
    resetTimeoutMs: 30000,  // 30 seconds
    successThreshold: 2
};

export class CircuitBreakerError extends Error {
    constructor(serviceName: string, state: CircuitBreakerState) {
        super(`Circuit breaker is ${state} for service: ${serviceName}`);
        this.name = 'CircuitBreakerError';
    }
}

/**
 * Circuit Breaker for protecting services from repeated failures
 */
export class CircuitBreaker {
    private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
    private failureCount: number = 0;
    private successCount: number = 0;
    private lastFailureTime: number = 0;
    private nextAttemptTime: number = 0;
    private failureTimestamps: number[] = [];

    constructor(
        private serviceName: string,
        private config: CircuitBreakerConfig = DEFAULT_CIRCUIT_BREAKER_CONFIG
    ) {}

    /**
     * Execute a function through the circuit breaker
     * @throws CircuitBreakerError if circuit is open
     */
    async execute<T>(fn: () => Promise<T>): Promise<T> {
        // Check if circuit is open and should remain open
        if (this.state === CircuitBreakerState.OPEN) {
            if (Date.now() < this.nextAttemptTime) {
                throw new CircuitBreakerError(this.serviceName, this.state);
            }
            // Timeout expired, transition to half-open
            this.transitionToHalfOpen();
        }

        try {
            const result = await fn();
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure();
            throw error;
        }
    }

    /**
     * Record a successful call
     */
    private onSuccess(): void {
        this.failureCount = 0;
        this.cleanupOldFailures();

        if (this.state === CircuitBreakerState.HALF_OPEN) {
            this.successCount++;
            if (this.successCount >= this.config.successThreshold) {
                this.transitionToClosed();
            }
        }
    }

    /**
     * Record a failed call
     */
    private onFailure(): void {
        this.lastFailureTime = Date.now();
        this.failureTimestamps.push(this.lastFailureTime);
        this.failureCount++;
        this.successCount = 0;

        this.cleanupOldFailures();

        // Count recent failures within window
        const recentFailures = this.failureTimestamps.filter(
            timestamp => timestamp > Date.now() - this.config.failureWindowMs
        ).length;

        if (recentFailures >= this.config.failureThreshold) {
            this.transitionToOpen();
        }
    }

    /**
     * Remove failure timestamps outside the failure window
     */
    private cleanupOldFailures(): void {
        const cutoffTime = Date.now() - this.config.failureWindowMs;
        this.failureTimestamps = this.failureTimestamps.filter(
            timestamp => timestamp > cutoffTime
        );
    }

    /**
     * Transition to CLOSED state (normal operation)
     */
    private transitionToClosed(): void {
        console.log(`[CircuitBreaker:${this.serviceName}] Transitioning to CLOSED - service recovered`);
        this.state = CircuitBreakerState.CLOSED;
        this.failureCount = 0;
        this.successCount = 0;
        this.failureTimestamps = [];
    }

    /**
     * Transition to OPEN state (failing, reject all requests)
     */
    private transitionToOpen(): void {
        console.warn(
            `[CircuitBreaker:${this.serviceName}] Transitioning to OPEN - ` +
            `${this.failureTimestamps.length} failures in ${this.config.failureWindowMs}ms`
        );
        this.state = CircuitBreakerState.OPEN;
        this.nextAttemptTime = Date.now() + this.config.resetTimeoutMs;
    }

    /**
     * Transition to HALF_OPEN state (testing recovery)
     */
    private transitionToHalfOpen(): void {
        console.log(`[CircuitBreaker:${this.serviceName}] Transitioning to HALF_OPEN - testing recovery`);
        this.state = CircuitBreakerState.HALF_OPEN;
        this.successCount = 0;
    }

    /**
     * Get current circuit breaker state
     */
    public getState(): CircuitBreakerState {
        return this.state;
    }

    /**
     * Check if circuit breaker is preventing calls
     */
    public isOpen(): boolean {
        return this.state === CircuitBreakerState.OPEN && Date.now() < this.nextAttemptTime;
    }

    /**
     * Get circuit breaker statistics
     */
    public getStats() {
        return {
            state: this.state,
            failureCount: this.failureCount,
            recentFailures: this.failureTimestamps.length,
            successCount: this.successCount,
            nextAttemptTime: this.nextAttemptTime,
            isOpen: this.isOpen()
        };
    }

    /**
     * Manually reset circuit breaker (for testing or admin override)
     */
    public reset(): void {
        this.transitionToClosed();
    }
}

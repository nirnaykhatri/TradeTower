/**
 * Signal Cache Service
 * 
 * Caches entry signals (Indicator & TradingView) per bot.
 * Prevents re-evaluation of the same signal and handles
 * delayed signal arrivals (e.g., webhook from TradingView).
 * 
 * Signals are cleared once entry is triggered to prevent
 * duplicate entries on the same signal.
 */

export interface EntrySignal {
    type: 'BUY' | 'SELL' | 'STRONG_BUY' | 'STRONG_SELL';
    source: 'INDICATOR' | 'TRADINGVIEW';
    timestamp: number;
    expiresAt?: number;  // Signal validity window
}

export class SignalCache {
    private signals: Map<string, EntrySignal> = new Map();

    /**
     * Cache an entry signal for a bot
     * 
     * @param botId Bot identifier
     * @param signal The entry signal
     * @param ttlSeconds Signal time-to-live (default: 300s = 5 minutes)
     */
    public cacheSignal(botId: string, signal: EntrySignal, ttlSeconds: number = 300): void {
        const signalWithExpiry = {
            ...signal,
            expiresAt: Date.now() + (ttlSeconds * 1000)
        };
        this.signals.set(botId, signalWithExpiry);
    }

    /**
     * Get cached signal for a bot if it exists and hasn't expired
     * 
     * @param botId Bot identifier
     * @returns The signal or null if not found/expired
     */
    public getSignal(botId: string): EntrySignal | null {
        const signal = this.signals.get(botId);
        if (!signal) return null;

        // Check expiry
        if (signal.expiresAt && Date.now() > signal.expiresAt) {
            this.signals.delete(botId);
            return null;
        }

        return signal;
    }

    /**
     * Clear cached signal for a bot
     * Called after bot enters position
     * 
     * @param botId Bot identifier
     */
    public clearSignal(botId: string): void {
        this.signals.delete(botId);
    }

    /**
     * Get all cached signals (for monitoring/debugging)
     */
    public getAllSignals(): Map<string, EntrySignal> {
        return new Map(this.signals);
    }

    /**
     * Clear all expired signals
     * Can be called periodically to clean up
     */
    public pruneExpiredSignals(): number {
        let pruned = 0;
        const now = Date.now();

        for (const [botId, signal] of this.signals.entries()) {
            if (signal.expiresAt && now > signal.expiresAt) {
                this.signals.delete(botId);
                pruned++;
            }
        }

        return pruned;
    }

    /**
     * Clear all signals (for testing or shutdown)
     */
    public clearAll(): void {
        this.signals.clear();
    }
}

/**
 * Default signal cache instance
 */
export const signalCache = new SignalCache();

/**
 * Optional: Start periodic cleanup of expired signals (every 5 minutes)
 * Call this from engine startup
 */
export function startSignalCacheCleanup(intervalMs: number = 5 * 60 * 1000): NodeJS.Timer {
    return setInterval(() => {
        const pruned = signalCache.pruneExpiredSignals();
        if (pruned > 0) {
            console.log(`[SignalCache] Pruned ${pruned} expired signals`);
        }
    }, intervalMs);
}

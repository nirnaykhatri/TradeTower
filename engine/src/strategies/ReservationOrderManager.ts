/**
 * Reservation Order Manager
 * 
 * Responsible for:
 * - Managing reservation orders (max price + reserve funds feature)
 * - Tracking reservation state
 * - Handling max price monitoring
 */

export interface ReservationConfig {
    maxPrice?: number;
    reserveFundsEnabled?: boolean;
    pair: string;
}

export interface GetTickerFn {
    (pair: string): Promise<{ lastPrice: number }>;
}

export class ReservationOrderManager {
    private maxPrice: number | undefined;
    private reserveFundsEnabled: boolean = true;
    private pair: string;
    private getTicker: GetTickerFn;

    constructor(
        config: ReservationConfig,
        getTicker: GetTickerFn
    ) {
        this.maxPrice = config.maxPrice;
        this.reserveFundsEnabled = config.reserveFundsEnabled ?? true;
        this.pair = config.pair;
        this.getTicker = getTicker;
    }

    /**
     * Check if reservation feature is enabled
     * 
     * Enabled when:
     * - maxPrice is configured
     * - reserveFundsEnabled is true (default)
     */
    isReservationEnabled(): boolean {
        return !!(this.maxPrice && this.reserveFundsEnabled !== false);
    }

    /**
     * Check if max price has been reached
     */
    async hasReachedMaxPrice(): Promise<boolean> {
        if (!this.maxPrice) return false;
        const ticker = await this.getTicker(this.pair);
        return ticker.lastPrice <= this.maxPrice;
    }

    /**
     * Get max price threshold
     */
    getMaxPrice(): number | undefined {
        return this.maxPrice;
    }

    /**
     * Update max price
     */
    setMaxPrice(price: number | undefined): void {
        this.maxPrice = price;
    }

    /**
     * Update reserve funds enabled flag
     */
    setReserveFundsEnabled(enabled: boolean): void {
        this.reserveFundsEnabled = enabled;
    }

    /**
     * Calculate reservation order price
     * 
     * Places limit order far from market:
     * - LONG: 50% below current price (can't accidentally fill on pump)
     * - SHORT: 50% above current price (can't accidentally fill on dump)
     */
    calculateReservationPrice(currentPrice: number, strategy: 'LONG' | 'SHORT'): number {
        const side = strategy === 'LONG' ? 'buy' : 'sell';
        return side === 'buy'
            ? currentPrice * 0.5
            : currentPrice * 1.5;
    }

    /**
     * Update configuration
     */
    updateConfig(partialConfig: Partial<ReservationConfig>): void {
        if (partialConfig.maxPrice !== undefined) {
            this.maxPrice = partialConfig.maxPrice;
        }
        if (partialConfig.reserveFundsEnabled !== undefined) {
            this.reserveFundsEnabled = partialConfig.reserveFundsEnabled;
        }
        if (partialConfig.pair !== undefined) {
            this.pair = partialConfig.pair;
        }
    }
}

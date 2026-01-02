/**
 * DCA Order Manager
 * 
 * Responsible for:
 * - Base order placement and validation
 * - Reservation order management (when max price + reserve funds enabled)
 * - Order cancellation and cleanup
 * - Order state tracking
 */

import { TradeOrder } from '@trading-tower/shared';

export interface OrderManagerConfig {
    pair: string;
    userId: string;
    botId: string;
    strategy: 'LONG' | 'SHORT';
    baseOrderAmount: number;
    averagingOrdersAmount: number;
    maxPrice?: number;
    minPrice?: number;
    baseOrderType?: string;
    reserveFundsEnabled?: boolean;
    pumpProtection?: boolean;
}

export interface PlaceOrderParams {
    userId: string;
    botId: string;
    pair: string;
    side: 'buy' | 'sell';
    type: 'market' | 'limit';
    amount: number;
    price?: number;
}

export interface ExecuteOrderFn {
    (params: PlaceOrderParams): Promise<TradeOrder>;
}

export interface CancelOrderFn {
    (orderId: string, pair: string): Promise<void>;
}

export interface GetTickerFn {
    (pair: string): Promise<{ lastPrice: number }>;
}

export class DCAOrderManager {
    private activeOrders: Map<string, TradeOrder> = new Map();
    private reservationOrderIds: Set<string> = new Set();
    private reservationActive: boolean = false;
    
    private config: OrderManagerConfig;
    private executeOrder: ExecuteOrderFn;
    private cancelOrder: CancelOrderFn;
    private getTicker: GetTickerFn;

    constructor(
        config: OrderManagerConfig,
        executeOrder: ExecuteOrderFn,
        cancelOrder: CancelOrderFn,
        getTicker: GetTickerFn
    ) {
        this.config = config;
        this.executeOrder = executeOrder;
        this.cancelOrder = cancelOrder;
        this.getTicker = getTicker;
    }

    /**
     * Place base order with pre-checks
     * 
     * Validates:
     * - Price within min/max bounds
     * - Pump protection not triggered
     * 
     * @param currentPrice Current market price
     * @param checkPumpProtection Function to detect pump
     * @returns Placed order or null if checks failed
     */
    async placeBaseOrder(
        currentPrice: number,
        checkPumpProtection: () => boolean
    ): Promise<TradeOrder | null> {
        // Check price bounds
        if (this.config.maxPrice && currentPrice > this.config.maxPrice) {
            console.log(`[DCA] Price ${currentPrice} exceeds max price ${this.config.maxPrice}. Waiting for price to drop.`);
            return null;
        }

        if (this.config.minPrice && currentPrice < this.config.minPrice) {
            console.log(`[DCA] Price ${currentPrice} below min price ${this.config.minPrice}. Waiting for price to rise.`);
            return null;
        }

        // Check pump protection
        if (this.config.pumpProtection && checkPumpProtection()) {
            console.log(`[DCA] Pump protection triggered. Waiting for confirmation.`);
            return null;
        }

        const side = this.config.strategy === 'LONG' ? 'buy' : 'sell';
        const type = this.config.baseOrderType?.toLowerCase() || 'market';

        const order = await this.executeOrder({
            userId: this.config.userId,
            botId: this.config.botId,
            pair: this.config.pair,
            side,
            type: type as any,
            amount: this.config.baseOrderAmount,
            price: type === 'limit' ? currentPrice : undefined
        });

        this.activeOrders.set(order.id, order);
        return order;
    }

    /**
     * Place reservation orders to lock investment
     * 
     * Places limit orders far from market to reserve funds
     * while waiting for max price to be reached.
     */
    async placeReservationOrders(): Promise<void> {
        if (this.reservationActive || !this.config.maxPrice) return;

        const ticker = await this.getTicker(this.config.pair);
        const currentPrice = ticker.lastPrice;
        
        const side = this.config.strategy === 'LONG' ? 'buy' : 'sell';
        
        // Calculate reservation price far from market (50% deviation)
        const reservationPrice = side === 'buy'
            ? currentPrice * 0.5
            : currentPrice * 1.5;

        const totalInvestment = this.config.baseOrderAmount + this.config.averagingOrdersAmount;

        try {
            console.log(`[DCA] Placing reservation order to lock ${totalInvestment} investment. Side: ${side}, Price: ${reservationPrice.toFixed(8)}`);
            
            const order = await this.executeOrder({
                userId: this.config.userId,
                botId: this.config.botId,
                pair: this.config.pair,
                side,
                type: 'limit',
                price: reservationPrice,
                amount: totalInvestment
            });

            this.reservationOrderIds.add(order.id);
            this.reservationActive = true;
            console.log(`[DCA] Reservation order placed: ${order.id}. Waiting for max price ${this.config.maxPrice} to be reached.`);
        } catch (error: any) {
            console.warn(`[DCA] Failed to place reservation order:`, error?.message);
            throw error;
        }
    }

    /**
     * Cancel reservation orders when max price is reached
     */
    async cancelReservationOrders(): Promise<void> {
        if (!this.reservationActive || this.reservationOrderIds.size === 0) return;

        console.log(`[DCA] Max price reached. Canceling ${this.reservationOrderIds.size} reservation order(s).`);

        for (const orderId of this.reservationOrderIds) {
            try {
                await this.cancelOrder(orderId, this.config.pair);
            } catch (error: any) {
                console.warn(`[DCA] Failed to cancel reservation order ${orderId}:`, error?.message);
            }
        }

        this.reservationOrderIds.clear();
        this.reservationActive = false;
    }

    /**
     * Cancel all active orders
     */
    async cancelAllActiveOrders(): Promise<void> {
        for (const [id, order] of this.activeOrders) {
            try {
                await this.cancelOrder(id, order.pair);
            } catch (error: any) {
                console.warn(`[DCA] Failed to cancel order ${id}:`, error?.message);
            }
        }
        this.activeOrders.clear();
        await this.cancelReservationOrders();
    }

    /**
     * Record order fill in active orders map
     */
    recordOrderFill(order: TradeOrder): void {
        this.activeOrders.delete(order.id);
    }

    /**
     * Get all active orders
     */
    getActiveOrders(): Map<string, TradeOrder> {
        return this.activeOrders;
    }

    /**
     * Check if reservation orders are active
     */
    isReservationActive(): boolean {
        return this.reservationActive;
    }

    /**
     * Check if max price has been reached
     */
    async hasReachedMaxPrice(): Promise<boolean> {
        if (!this.config.maxPrice) return false;
        const ticker = await this.getTicker(this.config.pair);
        return ticker.lastPrice <= this.config.maxPrice;
    }

    /**
     * Update configuration
     */
    updateConfig(partialConfig: Partial<OrderManagerConfig>): void {
        this.config = { ...this.config, ...partialConfig };
    }
}

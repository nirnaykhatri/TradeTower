/**
 * Safety Order Synchronizer
 * 
 * Responsible for:
 * - Calculating safety order prices using step multiplier
 * - Calculating order amounts using amount multiplier
 * - Synchronizing active safety orders up to limit
 * - Managing safety order indices and state
 */

import { TradeOrder } from '@trading-tower/shared';

export interface SafetyOrderConfig {
    averagingOrdersQuantity: number;
    averagingOrdersStep: number;
    averagingOrdersAmount: number;
    stepMultiplier?: number;
    amountMultiplier?: number;
    activeOrdersLimitEnabled?: boolean;
    activeOrdersLimit?: number;
    strategy: 'LONG' | 'SHORT';
    pair: string;
}

export interface ExecuteOrderFn {
    (params: any): Promise<TradeOrder>;
}

export interface PauseStrategyFn {
    (): Promise<void>;
}

export class SafetyOrderSynchronizer {
    private safetyOrderMap: Map<string, number> = new Map(); // orderId -> index
    private nextSafetyOrderToIndex: number = 0;
    private safetyOrdersFilledCount: number = 0;
    
    private config: SafetyOrderConfig;
    private executeOrder: ExecuteOrderFn;
    private pauseStrategy: PauseStrategyFn;
    private initialPrice: number = 0;
    private filledOrderPrices: number[] = [];

    constructor(
        config: SafetyOrderConfig,
        executeOrder: ExecuteOrderFn,
        pauseStrategy: PauseStrategyFn
    ) {
        this.config = config;
        this.executeOrder = executeOrder;
        this.pauseStrategy = pauseStrategy;
    }

    /**
     * Initialize with base order price
     */
    setInitialPrice(price: number): void {
        this.initialPrice = price;
        this.filledOrderPrices = [price];
    }

    /**
     * Calculate price for next safety order
     * 
     * Implements martingale/anti-martingale via step and amount multipliers
     */
    calculateSafetyOrderPrice(index: number): number {
        const baseStep = this.config.averagingOrdersStep;
        const stepMult = this.config.stepMultiplier || 1.0;
        
        // Calculate cumulative price deviation
        let totalDeviation = 0;
        for (let i = 0; i <= index; i++) {
            totalDeviation += baseStep * Math.pow(stepMult, i);
        }
        
        const side = this.config.strategy === 'LONG' ? 'buy' : 'sell';
        const price = side === 'buy' 
            ? this.initialPrice * (1 - totalDeviation / 100) 
            : this.initialPrice * (1 + totalDeviation / 100);
        
        return price;
    }

    /**
     * Calculate amount for next safety order
     * 
     * Implements martingale/anti-martingale scaling
     */
    calculateSafetyOrderAmount(index: number): number {
        const amountMult = this.config.amountMultiplier || 1.0;
        return this.config.averagingOrdersAmount * Math.pow(amountMult, index);
    }

    /**
     * Get maximum orders that should be on the book
     */
    getActiveOrdersLimit(): number {
        const maxTotalCount = this.config.averagingOrdersQuantity;
        return this.config.activeOrdersLimitEnabled 
            ? (this.config.activeOrdersLimit || maxTotalCount)
            : maxTotalCount;
    }

    /**
     * Synchronize safety orders
     * 
     * Places orders up to the active limit.
     * If limit disabled, places all orders.
     */
    async syncSafetyOrders(): Promise<void> {
        const activeLimit = this.getActiveOrdersLimit();
        const maxTotalCount = this.config.averagingOrdersQuantity;
        
        let currentOnBook = this.safetyOrderMap.size;
        while (currentOnBook < activeLimit && this.nextSafetyOrderToIndex < maxTotalCount) {
            await this.placeNextSafetyOrder(this.nextSafetyOrderToIndex);
            currentOnBook++;
            this.nextSafetyOrderToIndex++;
        }
    }

    /**
     * Place next safety order with full error handling
     */
    private async placeNextSafetyOrder(index: number): Promise<void> {
        const price = this.calculateSafetyOrderPrice(index);
        const amount = this.calculateSafetyOrderAmount(index);
        const side = this.config.strategy === 'LONG' ? 'buy' : 'sell';

        try {
            const order = await this.executeOrder({
                side,
                type: 'limit',
                price,
                amount,
                pair: this.config.pair
            });
            
            this.safetyOrderMap.set(order.id, index);
            console.log(`[DCA] Placed SO${index}: ${amount} @ ${price} (limit). ID: ${order.id}`);
        } catch (error: any) {
            console.error(`[DCA] SO ${index} failed:`, error);
            
            // Handle insufficient funds by pausing bot
            if (error?.message?.includes('Insufficient funds') || error?.code === 'INSUFFICIENT_FUNDS') {
                console.warn(`[DCA] Insufficient funds for Safety Order ${index}. Pausing bot.`);
                await this.pauseStrategy();
            }
            throw error;
        }
    }

    /**
     * Record safety order fill
     */
    recordSafetyOrderFill(orderId: string): void {
        if (this.safetyOrderMap.has(orderId)) {
            this.safetyOrderMap.delete(orderId);
            this.safetyOrdersFilledCount++;
        }
    }

    /**
     * Track filled order prices for averaging
     */
    recordFilledPrice(price: number): void {
        this.filledOrderPrices.push(price);
    }

    /**
     * Get count of filled safety orders
     */
    getFilledCount(): number {
        return this.safetyOrdersFilledCount;
    }

    /**
     * Get total placed safety orders
     */
    getTotalOrders(): number {
        return this.config.averagingOrdersQuantity;
    }

    /**
     * Get count of active safety orders on book
     */
    getActiveOrderCount(): number {
        return this.safetyOrderMap.size;
    }

    /**
     * Get next safety order index to place
     */
    getNextOrderIndex(): number {
        return this.nextSafetyOrderToIndex;
    }

    /**
     * Cancel all active safety orders
     */
    cancelAllOrders(cancelFn: (orderId: string) => Promise<void>): Promise<void[]> {
        return Promise.all(
            Array.from(this.safetyOrderMap.keys()).map(id => 
                cancelFn(id).catch(e => console.warn(`Failed to cancel ${id}:`, e))
            )
        );
    }

    /**
     * Reset state for new cycle
     */
    reset(): void {
        this.safetyOrderMap.clear();
        this.nextSafetyOrderToIndex = 0;
        this.safetyOrdersFilledCount = 0;
        this.filledOrderPrices = [];
    }

    /**
     * Update configuration
     */
    updateConfig(partialConfig: Partial<SafetyOrderConfig>): void {
        this.config = { ...this.config, ...partialConfig };
    }
}

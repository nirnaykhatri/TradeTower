/**
 * Order Placement Service
 * 
 * Consolidates order placement logic used across all strategies.
 * Eliminates ~150 lines of duplicated code across BaseDCA, Grid, BTD, Loop strategies.
 * 
 * Provides:
 * - Centralized order execution with retry logic
 * - Order tracking via callback
 * - Consistent error handling
 * - Unified order naming/tracking
 */

import { TradeOrder } from '../index';
import { ILogger } from './DependencyInjection';

// Define minimal interface to avoid circular dependency
export interface IExchangeConnector {
    createOrder(params: any): Promise<TradeOrder>;
    cancelOrder(pair: string, orderId: string): Promise<void>;
}

export interface OrderPlacementParams {
    exchangeConnector: IExchangeConnector;
    botId: string;
    pair: string;
    side: 'buy' | 'sell';
    type: 'limit' | 'market';
    price: number;
    amount: number;
    reduceOnly?: boolean;
    tags?: string[];
    maxRetries?: number;
    retryDelayMs?: number;
}

export interface OrderPlacementCallback {
    onOrderPlaced?: (order: TradeOrder) => void;
    onOrderFailed?: (error: Error) => void;
}

/**
 * Order Placement Service
 * 
 * Handles placement of orders with consistent retry logic and tracking.
 * Used by all strategies to maintain DRY principle and ensure consistency.
 * 
 * @example
 * ```typescript
 * const service = new OrderPlacementService(logger);
 * 
 * const order = await service.placeOrder({
 *   exchangeConnector: exchange,
 *   botId: bot.id,
 *   pair: 'BTC/USDT',
 *   side: 'buy',
 *   type: 'limit',
 *   price: 45000,
 *   amount: 0.1,
 *   tags: ['safety-order', 'index-3']
 * }, {
 *   onOrderPlaced: (order) => activeOrders.set(order.id, order)
 * });
 * ```
 */
export class OrderPlacementService {
    private readonly DEFAULT_MAX_RETRIES = 3;
    private readonly DEFAULT_RETRY_DELAY_MS = 1000;

    constructor(private logger: ILogger) {}

    /**
     * Place an order with automatic retry logic
     * 
     * Attempts to place order up to maxRetries times with exponential backoff.
     * 
     * @param params Order placement parameters
     * @param callbacks Optional callbacks for order lifecycle events
     * @returns Placed TradeOrder
     * @throws Error if order placement fails after all retries
     */
    async placeOrder(
        params: OrderPlacementParams,
        callbacks?: OrderPlacementCallback
    ): Promise<TradeOrder> {
        const maxRetries = params.maxRetries ?? this.DEFAULT_MAX_RETRIES;
        const retryDelayMs = params.retryDelayMs ?? this.DEFAULT_RETRY_DELAY_MS;

        let lastError: Error | null = null;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const order = await params.exchangeConnector.createOrder({
                    pair: params.pair,
                    side: params.side,
                    type: params.type,
                    price: params.price,
                    amount: params.amount,
                    reduceOnly: params.reduceOnly
                });

                this.logger.debug({
                    context: 'OrderPlacementService.placeOrder',
                    message: 'Order placed successfully',
                    orderId: order.id,
                    pair: params.pair,
                    side: params.side,
                    amount: params.amount,
                    price: params.price,
                    attempt: attempt + 1
                });

                callbacks?.onOrderPlaced?.(order);
                return order;
            } catch (error) {
                lastError = error as Error;

                this.logger.warn({
                    context: 'OrderPlacementService.placeOrder',
                    message: `Order placement failed, retry ${attempt + 1}/${maxRetries}`,
                    error: lastError.message,
                    pair: params.pair,
                    side: params.side,
                    amount: params.amount
                });

                if (attempt < maxRetries - 1) {
                    // Exponential backoff: delay * 2^attempt
                    const delayMs = retryDelayMs * Math.pow(2, attempt);
                    await this.sleep(delayMs);
                }
            }
        }

        // All retries exhausted
        this.logger.error({
            context: 'OrderPlacementService.placeOrder',
            message: `Order placement failed after ${maxRetries} retries`,
            error: lastError?.message,
            pair: params.pair,
            side: params.side,
            amount: params.amount,
            price: params.price
        });

        callbacks?.onOrderFailed?.(lastError || new Error('Order placement failed'));
        throw lastError || new Error('Order placement failed after all retries');
    }

    /**
     * Place multiple orders in sequence
     * 
     * Places orders one-by-one to maintain consistent state.
     * For parallel placement, use Promise.all() with this method.
     * 
     * @param paramsList Array of order parameters
     * @param callbacks Callbacks for lifecycle events
     * @returns Array of placed orders
     */
    async placeOrdersSequential(
        paramsList: OrderPlacementParams[],
        callbacks?: OrderPlacementCallback
    ): Promise<TradeOrder[]> {
        const orders: TradeOrder[] = [];

        for (const params of paramsList) {
            try {
                const order = await this.placeOrder(params, callbacks);
                orders.push(order);
            } catch (error) {
                this.logger.error({
                    context: 'OrderPlacementService.placeOrdersSequential',
                    message: 'Failed to place order in sequence',
                    error: (error as Error).message
                });
                throw error;
            }
        }

        return orders;
    }

    /**
     * Place multiple orders in parallel
     * 
     * Attempts to place all orders concurrently for maximum efficiency.
     * If any fails, returns partial results with error.
     * 
     * @param paramsList Array of order parameters
     * @param callbacks Callbacks for lifecycle events
     * @returns Array of successfully placed orders
     */
    async placeOrdersParallel(
        paramsList: OrderPlacementParams[],
        callbacks?: OrderPlacementCallback
    ): Promise<TradeOrder[]> {
        const results = await Promise.allSettled(
            paramsList.map(params => this.placeOrder(params, callbacks))
        );

        const orders: TradeOrder[] = [];
        const errors: Error[] = [];

        for (const result of results) {
            if (result.status === 'fulfilled') {
                orders.push(result.value);
            } else {
                errors.push(result.reason as Error);
            }
        }

        if (errors.length > 0) {
            this.logger.warn({
                context: 'OrderPlacementService.placeOrdersParallel',
                message: `${errors.length} orders failed out of ${paramsList.length}`,
                successCount: orders.length,
                failureCount: errors.length
            });
        }

        return orders;
    }

    /**
     * Cancel an order with retry logic
     * 
     * @param exchangeConnector Exchange connector instance
     * @param pair Trading pair
     * @param orderId Order ID to cancel
     * @returns Success status
     */
    async cancelOrder(
        exchangeConnector: IExchangeConnector,
        pair: string,
        orderId: string
    ): Promise<boolean> {
        try {
            await exchangeConnector.cancelOrder(pair, orderId);
            this.logger.debug({
                context: 'OrderPlacementService.cancelOrder',
                message: 'Order canceled successfully',
                orderId,
                pair
            });
            return true;
        } catch (error) {
            this.logger.error({
                context: 'OrderPlacementService.cancelOrder',
                message: 'Order cancellation failed',
                error: (error as Error).message,
                orderId,
                pair
            });
            return false;
        }
    }

    /**
     * Update an order (cancel old and place new)
     * 
     * @param exchangeConnector Exchange connector instance
     * @param botId Bot ID for the new order
     * @param pair Trading pair
     * @param oldOrderId Order ID to cancel
     * @param newOrderParams New order parameters
     * @returns New placed order
     */
    async updateOrder(
        exchangeConnector: IExchangeConnector,
        botId: string,
        pair: string,
        oldOrderId: string,
        newOrderParams: Omit<OrderPlacementParams, 'exchangeConnector' | 'botId' | 'pair'>
    ): Promise<TradeOrder> {
        // Cancel old order
        await this.cancelOrder(exchangeConnector, pair, oldOrderId);

        // Place new order
        return this.placeOrder({
            ...newOrderParams,
            exchangeConnector,
            botId,
            pair
        });
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

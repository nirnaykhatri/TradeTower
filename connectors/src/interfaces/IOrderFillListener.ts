import { TradeOrder } from '@trading-tower/shared';

/**
 * Listener interface for order fill events from exchange WebSocket streams.
 * Implemented by strategies to receive real-time notifications of order fills,
 * partial fills, and cancellations.
 *
 * All methods are async and must complete without throwing exceptions.
 * Exceptions will be caught and logged by the connector.
 */
export interface IOrderFillListener {
    /**
     * Called when an order is completely filled.
     * 
     * @param order The filled TradeOrder with price, amount, and fee information
     * @throws Should not throw - exceptions will be caught by connector
     */
    onOrderFilled(order: TradeOrder): Promise<void>;

    /**
     * Called when an order is partially filled.
     * Useful for large orders that execute in multiple fills.
     * 
     * @param order The partially filled TradeOrder with filledAmount property set
     * @throws Should not throw - exceptions will be caught by connector
     */
    onOrderPartiallyFilled(order: TradeOrder): Promise<void>;

    /**
     * Called when an order is cancelled (by user or exchange).
     * 
     * @param orderId The exchange order ID
     * @param pair The trading pair (e.g., "BTC/USDT")
     * @throws Should not throw - exceptions will be caught by connector
     */
    onOrderCancelled(orderId: string, pair: string): Promise<void>;

    /**
     * Called when WebSocket connection is successfully established and authenticated.
     * Ready to receive order fill events.
     * 
     * @param exchange The exchange name (e.g., "binance", "coinbase")
     * @throws Should not throw - exceptions will be caught by connector
     */
    onWebSocketConnected(exchange: string): Promise<void>;

    /**
     * Called when WebSocket connection is lost or closed.
     * Fill events will not be received until reconnection.
     * 
     * @param exchange The exchange name (e.g., "binance", "coinbase")
     * @throws Should not throw - exceptions will be caught by connector
     */
    onWebSocketDisconnected(exchange: string): Promise<void>;

    /**
     * Called when an error occurs in the WebSocket connection or message processing.
     * This does not necessarily mean the connection is lost - may be temporary.
     * 
     * @param exchange The exchange name (e.g., "binance", "coinbase")
     * @param error The error that occurred
     * @throws Should not throw - exceptions will be caught by connector
     */
    onWebSocketError(exchange: string, error: Error): Promise<void>;
}

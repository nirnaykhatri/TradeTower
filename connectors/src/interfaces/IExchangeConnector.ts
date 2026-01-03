import { TradeOrder } from '@trading-tower/shared';
import { IOrderFillListener } from './IOrderFillListener';

export interface ExchangeBalance {
    asset: string;
    free: number;
    locked: number;
}

export interface TickerData {
    symbol: string;
    lastPrice: number;
    bid: number;
    ask: number;
    volume: number;
    timestamp: number;
}

/**
 * WebSocket connection status for monitoring and diagnostics.
 */
export interface WebSocketStatus {
    /**
     * Whether the WebSocket is currently connected and authenticated.
     */
    isConnected: boolean;

    /**
     * Exchange name for this connection.
     */
    exchange: string;

    /**
     * Number of active listeners subscribed to order fill events.
     */
    subscriptionCount: number;

    /**
     * Timestamp of the last received event (milliseconds since epoch).
     * Undefined if no events received yet.
     */
    lastEventTime?: number;

    /**
     * Connection uptime in milliseconds.
     * Resets to 0 on reconnection.
     */
    connectionUptime?: number;

    /**
     * Number of reconnection attempts since initialization.
     */
    reconnectionAttempts?: number;

    /**
     * Error message from last connection failure (if any).
     */
    lastError?: string;
}

export interface IExchangeConnector {
    name: string;

    // Connectivity
    ping(): Promise<boolean>;

    // Account
    getBalances(): Promise<ExchangeBalance[]>;

    // Market Data
    getTicker(symbol: string): Promise<TickerData>;
    getCandles(symbol: string, interval: string, limit?: number): Promise<any[]>;

    // Trading
    createOrder(order: Partial<TradeOrder>): Promise<TradeOrder>;
    cancelOrder(orderId: string, symbol: string): Promise<boolean>;
    getOrder(orderId: string, symbol: string): Promise<TradeOrder>;

    // Leverage & Margin (optional, for futures trading)
    /**
     * Set leverage for futures trading
     * Implementations should support exchanges like Binance, Bitget, OKX, etc.
     * 
     * @param leverage Leverage multiplier (e.g., 2, 5, 10)
     * @param marginType 'isolated' for isolated margin, 'cross' for cross margin
     * @returns Promise that resolves when leverage is set
     * @throws If leverage is not supported or exceeds exchange limits
     */
    setLeverage?(leverage: number, marginType: 'isolated' | 'cross'): Promise<void>;

    // WebSocket Order Fill Subscriptions
    /**
     * Subscribe a listener to receive order fill events for a specific trading pair.
     * The listener will be notified of fills, partial fills, and cancellations
     * via WebSocket events from the exchange.
     *
     * Multiple listeners can subscribe to the same pair.
     * The connector manages a shared WebSocket connection for efficiency.
     *
     * @param pair The trading pair (e.g., "BTC/USDT")
     * @param listener The listener to notify on fill events
     * @throws If WebSocket subscription fails after retries
     */
    subscribeToOrderFills(
        pair: string,
        listener: IOrderFillListener
    ): Promise<void>;

    /**
     * Unsubscribe a listener from order fill events.
     * If this is the last listener for a pair, the WebSocket stream
     * subscription for that pair may be closed.
     *
     * @param pair The trading pair (e.g., "BTC/USDT")
     * @param listener The listener to remove
     * @returns Promise that resolves when unsubscription is complete
     */
    unsubscribeFromOrderFills(
        pair: string,
        listener: IOrderFillListener
    ): Promise<void>;

    /**
     * Check if the WebSocket connection is currently active and authenticated.
     * Note: A connection being active does not guarantee subscriptions are working.
     *
     * @returns true if connected, false otherwise
     */
    isWebSocketConnected(): boolean;

    /**
     * Get detailed status of the WebSocket connection.
     * Useful for monitoring and diagnostics.
     *
     * @returns WebSocketStatus object with connection details
     */
    getWebSocketStatus(): WebSocketStatus;
}

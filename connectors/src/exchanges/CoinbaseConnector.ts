import { IExchangeConnector, ExchangeBalance, TickerData, WebSocketStatus } from '../interfaces/IExchangeConnector';
import { IOrderFillListener } from '../interfaces/IOrderFillListener';
import { TradeOrder, RateLimiter, ExchangeRateLimiters } from '@trading-tower/shared';
import { BaseCoinbaseConnector } from './BaseCoinbaseConnector';
import { CoinbaseWebSocketManager } from './CoinbaseWebSocketManager';

export class CoinbaseConnector extends BaseCoinbaseConnector implements IExchangeConnector {
    public readonly name = 'Coinbase';
    protected readonly productType = 'SPOT';
    private wsManager: CoinbaseWebSocketManager | null = null;

    constructor(apiKey: string, apiSecret: string) {
        super(apiKey, apiSecret, 'Coinbase');
        // Initialize rate limiter for Coinbase API
        this.rateLimiter = ExchangeRateLimiters.COINBASE;
    }

    async ping(): Promise<boolean> {
        try {
            await this.rateLimiter.execute(() =>
                this.client.get('/api/v3/brokerage/accounts?limit=1')
            );
            return true;
        } catch {
            return false;
        }
    }

    async getBalances(): Promise<ExchangeBalance[]> {
        const response = await this.rateLimiter.execute(() =>
            this.client.get('/api/v3/brokerage/accounts')
        );
        return response.data.accounts.map((acc: any) => ({
            asset: acc.currency,
            free: parseFloat(acc.available_balance.value),
            locked: parseFloat(acc.hold.value)
        }));
    }

    /**
     * Get ticker data for trading pair
     * 
     * Rate limited to prevent exceeding Coinbase API limits.
     * 
     * @param symbol Trading pair symbol (e.g., 'BTC/USD')
     * @returns Ticker data with price, bid/ask, volume
     */
    async getTicker(symbol: string): Promise<TickerData> {
        const productId = symbol.replace('/', '-').toUpperCase();
        const response = await this.rateLimiter.execute(() =>
            this.client.get(`/api/v3/brokerage/products/${productId}`)
        );
        const product = response.data;

        return {
            symbol: symbol.toUpperCase(),
            lastPrice: parseFloat(product.price),
            bid: parseFloat(product.bid || product.price),
            ask: parseFloat(product.ask || product.price),
            volume: parseFloat(product.volume_24h),
            timestamp: Date.now()
        };
    }

    /**
     * Get historical candles/OHLCV data
     * 
     * Rate limited to prevent exceeding API limits.
     * 
     * @param symbol Trading pair symbol
     * @param interval Candle interval (e.g., '1h', '4h')
     * @param limit Number of candles to fetch
     * @returns Array of OHLCV candles
     */
    async getCandles(symbol: string, interval: string, limit: number = 100): Promise<any[]> {
        const productId = symbol.replace('/', '-').toUpperCase();
        const end = Math.floor(Date.now() / 1000);
        const start = end - (limit * 60);
        const response = await this.rateLimiter.execute(() =>
            this.client.get(`/api/v3/brokerage/products/${productId}/candles`, {
            params: { start, end, granularity: interval }
        })
        );
        return response.data.candles;
    }

    /**
     * Create a new order on Coinbase
     * 
     * Rate limited to prevent hitting API limits.
     * Supports market and limit orders.
     * 
     * @param order Order specification
     * @returns Created order details
     */
    async createOrder(order: Partial<TradeOrder>): Promise<TradeOrder> {
        const productId = (order.pair || '').replace('/', '-').toUpperCase();

        const body = {
            client_order_id: Math.random().toString(36).substring(2, 15),
            product_id: productId,
            side: order.side?.toUpperCase(),
            order_configuration: order.type === 'limit' ? {
                limit_limit_gtc: {
                    base_size: order.amount?.toString(),
                    limit_price: order.price?.toString(),
                }
            } : {
                market_market_ioc: {
                    base_size: order.amount?.toString(),
                }
            }
        };

        const response = await this.rateLimiter.execute(() =>
            this.client.post('/api/v3/brokerage/orders', body)
        );
        const res = response.data.order;

        return {
            id: res.order_id,
            userId: order.userId || '',
            botId: order.botId || '',
            exchangeId: 'coinbase',
            pair: res.product_id,
            side: res.side.toLowerCase() as any,
            type: res.order_type.toLowerCase() as any,
            status: 'open',
            price: parseFloat(res.order_configuration.limit_limit_gtc?.limit_price || '0'),
            amount: parseFloat(res.order_configuration.limit_limit_gtc?.base_size || '0'),
            filledAmount: 0,
            fee: 0,
            feeCurrency: 'USD',
            timestamp: res.created_time
        };
    }

    /**
     * Cancel an open order
     * 
     * Rate limited to prevent exceeding API limits.
     * 
     * @param orderId Order ID to cancel
     * @param symbol Trading pair symbol
     * @returns True if cancellation successful
     */
    async cancelOrder(orderId: string, symbol: string): Promise<boolean> {
        await this.rateLimiter.execute(() =>
            this.client.post('/api/v3/brokerage/orders/batch_cancel', { order_ids: [orderId] })
        );
        return true;
    }

    /**
     * Get order details
     * 
     * Rate limited to prevent exceeding API limits.
     * 
     * @param orderId Order ID to retrieve
     * @param symbol Trading pair symbol
     * @returns Order details
     */
    async getOrder(orderId: string, symbol: string): Promise<TradeOrder> {
        const response = await this.rateLimiter.execute(() =>
            this.client.get(`/api/v3/brokerage/orders/historical/${orderId}`)
        );
        const res = response.data.order;

        return {
            id: res.order_id,
            userId: '',
            botId: '',
            exchangeId: 'coinbase',
            pair: res.product_id,
            side: res.side.toLowerCase() as any,
            type: res.order_type.toLowerCase() as any,
            status: this.mapStatus(res.status),
            price: parseFloat(res.order_configuration.limit_limit_gtc?.limit_price || '0'),
            amount: parseFloat(res.order_configuration.limit_limit_gtc?.base_size || '0'),
            filledAmount: parseFloat(res.filled_size),
            fee: parseFloat(res.total_fees),
            feeCurrency: 'USD',
            timestamp: res.created_time
        };
    }

    private mapStatus(status: string): any {
        switch (status) {
            case 'FILLED': return 'filled';
            case 'CANCELLED': return 'canceled';
            case 'OPEN': return 'open';
            default: return 'rejected';
        }
    }

    // ============ WebSocket Order Fill Subscriptions ============

    /**
     * Subscribe to receive order fill events via Coinbase WebSocket feed
     * 
     * Establishes a WebSocket connection to Coinbase Advanced Trade API
     * and registers the listener for fill notifications on the specified pair.
     * 
     * @param pair Trading pair (e.g., "BTC/USD")
     * @param listener Listener to notify on fill events
     * @throws If WebSocket connection cannot be established
     */
    async subscribeToOrderFills(pair: string, listener: IOrderFillListener): Promise<void> {
        // Lazily initialize WebSocket manager on first subscription
        if (!this.wsManager) {
            this.wsManager = new CoinbaseWebSocketManager(this.apiKey, this.apiSecret);
        }

        await this.wsManager.subscribeToOrderFills(pair, listener);
    }

    /**
     * Unsubscribe from receiving order fill events for a pair
     * 
     * @param pair Trading pair (e.g., "BTC/USD")
     * @param listener Listener to remove
     */
    async unsubscribeFromOrderFills(pair: string, listener: IOrderFillListener): Promise<void> {
        if (!this.wsManager) return;

        await this.wsManager.unsubscribeFromOrderFills(pair, listener);
    }

    /**
     * Check if WebSocket connection is active and authenticated
     * 
     * @returns true if connected, false otherwise
     */
    isWebSocketConnected(): boolean {
        if (!this.wsManager) return false;
        return this.wsManager.isConnected();
    }

    /**
     * Get detailed WebSocket connection status
     * 
     * @returns WebSocket status with connection details and metrics
     */
    getWebSocketStatus(): WebSocketStatus {
        if (!this.wsManager) {
            return {
                isConnected: false,
                exchange: this.name,
                subscriptionCount: 0
            };
        }

        const managerStatus = this.wsManager.getStatus();
        return {
            isConnected: managerStatus.isConnected,
            exchange: this.name,
            subscriptionCount: managerStatus.subscriptionCount,
            lastEventTime: managerStatus.lastEventTime,
            connectionUptime: managerStatus.connectionUptime,
            reconnectionAttempts: managerStatus.reconnectAttempts
        };
    }
}

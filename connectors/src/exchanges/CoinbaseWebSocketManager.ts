import WebSocket from 'ws';
import { TradeOrder } from '@trading-tower/shared';
import { WebSocketManager, WebSocketConfig } from '../utils/WebSocketManager';
import { AuthUtils } from '../utils/AuthUtils';
import crypto from 'crypto';

/**
 * Coinbase WebSocket message types
 */
interface CoinbaseSubscribeMessage {
    type: 'subscribe';
    product_ids: string[];
    channel: string;
    api_key?: string;
    timestamp?: string;
    signature?: string;
}

interface CoinbaseUserMessage {
    type: 'user';
    user_id: string;
    profile_id: string;
    orders?: CoinbaseOrderUpdate[];
}

interface CoinbaseOrderUpdate {
    order_id: string;
    product_id: string;
    side: 'buy' | 'sell';
    order_type: string;
    status: string;
    price: string;
    size: string;
    filled_size: string;
    executed_value: string;
    fill_fees: string;
    created_at: string;
    done_at?: string;
    done_reason?: string;
}

interface CoinbaseDoneMessage {
    type: 'done';
    order_id: string;
    product_id: string;
    side: 'buy' | 'sell';
    reason: 'filled' | 'canceled';
    price: string;
    remaining_size: string;
    time: string;
}

interface CoinbaseMatchMessage {
    type: 'match';
    trade_id: number;
    maker_order_id: string;
    taker_order_id: string;
    side: 'buy' | 'sell';
    size: string;
    price: string;
    product_id: string;
    time: string;
}

/**
 * Coinbase WebSocket Manager
 * 
 * Manages WebSocket connection to Coinbase Advanced Trade API for receiving
 * real-time order execution reports, fill events, and order status updates.
 * 
 * Uses Coinbase's signature-based WebSocket authentication.
 */
export class CoinbaseWebSocketManager extends WebSocketManager {
    private subscribedProductIds: Set<string> = new Set();

    constructor(apiKey: string, apiSecret: string, configOverrides?: Partial<WebSocketConfig>) {
        super('Coinbase', apiKey, apiSecret, configOverrides);
    }

    /**
     * Get Coinbase WebSocket URL
     */
    protected getWebSocketUrl(): string {
        return 'wss://advanced-trade-ws.coinbase.com';
    }

    /**
     * Authenticate WebSocket by sending subscribe message with signature
     * 
     * Coinbase requires signing the subscribe message with API secret.
     */
    protected async authenticate(): Promise<void> {
        // Coinbase authenticates via signed subscribe message
        // Authentication happens when subscribing to channels
        console.log(`[${this.exchangeName}] WebSocket ready for authenticated subscriptions`);
    }

    /**
     * Override subscribeToOrderFills to handle Coinbase-specific subscription
     */
    public async subscribeToOrderFills(pair: string, listener: any): Promise<void> {
        // Add to parent listener registry first
        await super.subscribeToOrderFills(pair, listener);

        // Subscribe to Coinbase user channel for this product
        const productId = this.formatProductId(pair);
        
        if (!this.subscribedProductIds.has(productId)) {
            await this.subscribeToCoinbaseChannel(productId);
            this.subscribedProductIds.add(productId);
        }
    }

    /**
     * Subscribe to Coinbase user channel for a specific product
     */
    private async subscribeToCoinbaseChannel(productId: string): Promise<void> {
        if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
            throw new Error('WebSocket not connected');
        }

        const timestamp = Math.floor(Date.now() / 1000).toString();
        const channel = 'user';
        
        // Create signature for authentication
        const message = timestamp + channel + productId;
        const signature = crypto
            .createHmac('sha256', this.apiSecret)
            .update(message)
            .digest('hex');

        const subscribeMessage: CoinbaseSubscribeMessage = {
            type: 'subscribe',
            product_ids: [productId],
            channel: channel,
            api_key: this.apiKey,
            timestamp: timestamp,
            signature: signature
        };

        this.websocket.send(JSON.stringify(subscribeMessage));
        console.log(`[${this.exchangeName}] Subscribed to user channel for ${productId}`);
    }

    /**
     * Parse incoming WebSocket message and emit appropriate events
     */
    protected async onMessage(data: WebSocket.RawData): Promise<void> {
        try {
            const text = this.parseRawData(data);
            const message = JSON.parse(text);

            switch (message.type) {
                case 'subscriptions':
                    console.debug(`[${this.exchangeName}] Subscription confirmation received`);
                    break;

                case 'done':
                    await this.handleDoneMessage(message as CoinbaseDoneMessage);
                    break;

                case 'match':
                    await this.handleMatchMessage(message as CoinbaseMatchMessage);
                    break;

                case 'user':
                    await this.handleUserMessage(message as CoinbaseUserMessage);
                    break;

                case 'error':
                    console.error(`[${this.exchangeName}] WebSocket error message:`, message);
                    break;

                case 'heartbeat':
                    // Heartbeat received, connection is healthy
                    break;

                default:
                    console.debug(`[${this.exchangeName}] Unhandled message type: ${message.type}`);
            }
        } catch (error) {
            console.error(`[${this.exchangeName}] Error parsing WebSocket message:`, error);
            throw error;
        }
    }

    /**
     * Handle 'done' message - order is completed (filled or canceled)
     */
    private async handleDoneMessage(message: CoinbaseDoneMessage): Promise<void> {
        const pair = this.formatPair(message.product_id);

        if (message.reason === 'filled') {
            // Order fully filled
            const order = this.mapCoinbaseToTradeOrder({
                order_id: message.order_id,
                product_id: message.product_id,
                side: message.side,
                order_type: 'limit',
                status: 'FILLED',
                price: message.price,
                size: '0', // Size not provided in done message
                filled_size: '0',
                executed_value: '0',
                fill_fees: '0',
                created_at: message.time,
                done_at: message.time,
                done_reason: 'filled'
            });

            await this.emitOrderFilled(pair, order);
        } else if (message.reason === 'canceled') {
            // Order canceled
            await this.emitOrderCancelled(pair, message.order_id);
        }
    }

    /**
     * Handle 'match' message - order has been matched (partial or full fill)
     */
    private async handleMatchMessage(message: CoinbaseMatchMessage): Promise<void> {
        const pair = this.formatPair(message.product_id);
        
        // Determine which order ID to use (maker or taker)
        const orderId = message.side === 'buy' ? message.taker_order_id : message.maker_order_id;

        // Create partial order representation
        const order: TradeOrder = {
            id: orderId,
            userId: '',
            botId: '',
            exchangeId: 'coinbase',
            pair: pair,
            side: message.side,
            type: 'limit',
            status: 'open', // Still open until 'done' message
            price: parseFloat(message.price),
            amount: parseFloat(message.size),
            filledAmount: parseFloat(message.size),
            fee: 0, // Fee calculated in done message
            feeCurrency: 'USD',
            timestamp: message.time
        };

        // Emit as partial fill (full fill will be signaled by 'done' message)
        await this.emitOrderPartiallyFilled(pair, order);
    }

    /**
     * Handle 'user' message - user-specific order updates
     */
    private async handleUserMessage(message: CoinbaseUserMessage): Promise<void> {
        if (!message.orders || message.orders.length === 0) return;

        for (const orderUpdate of message.orders) {
            const pair = this.formatPair(orderUpdate.product_id);
            const order = this.mapCoinbaseToTradeOrder(orderUpdate);

            if (orderUpdate.status === 'FILLED') {
                await this.emitOrderFilled(pair, order);
            } else if (orderUpdate.status === 'CANCELLED') {
                await this.emitOrderCancelled(pair, orderUpdate.order_id);
            }
        }
    }

    /**
     * Map Coinbase order update to TradeOrder format
     */
    private mapCoinbaseToTradeOrder(order: CoinbaseOrderUpdate): TradeOrder {
        return {
            id: order.order_id,
            userId: '',
            botId: '',
            exchangeId: 'coinbase',
            pair: this.formatPair(order.product_id),
            side: order.side,
            type: this.mapOrderType(order.order_type),
            status: this.mapOrderStatus(order.status),
            price: parseFloat(order.price) || 0,
            amount: parseFloat(order.size) || 0,
            filledAmount: parseFloat(order.filled_size) || 0,
            fee: parseFloat(order.fill_fees) || 0,
            feeCurrency: 'USD',
            timestamp: order.done_at || order.created_at
        };
    }

    /**
     * Map Coinbase order type to TradeOrder type
     */
    private mapOrderType(type: string): 'limit' | 'market' {
        const lowerType = type.toLowerCase();
        if (lowerType.includes('market')) {
            return 'market';
        }
        return 'limit';
    }

    /**
     * Map Coinbase order status to TradeOrder status
     */
    private mapOrderStatus(
        status: string
    ): 'open' | 'filled' | 'canceled' | 'rejected' | 'expired' {
        switch (status.toUpperCase()) {
            case 'FILLED':
                return 'filled';
            case 'CANCELLED':
            case 'CANCELED':
                return 'canceled';
            case 'REJECTED':
                return 'rejected';
            case 'EXPIRED':
                return 'expired';
            case 'OPEN':
            case 'PENDING':
            default:
                return 'open';
        }
    }

    /**
     * Format pair to Coinbase product_id format (BTC/USD -> BTC-USD)
     */
    private formatProductId(pair: string): string {
        return pair.replace('/', '-').toUpperCase();
    }

    /**
     * Format Coinbase product_id to standard pair format (BTC-USD -> BTC/USD)
     */
    private formatPair(productId: string): string {
        return productId.replace('-', '/');
    }

    /**
     * Override unsubscribe to handle Coinbase-specific cleanup
     */
    public async unsubscribeFromOrderFills(pair: string, listener: any): Promise<void> {
        await super.unsubscribeFromOrderFills(pair, listener);

        // If no more listeners for this pair, unsubscribe from Coinbase channel
        const productId = this.formatProductId(pair);
        const listeners = this.pairListeners.get(pair);
        
        if (!listeners || listeners.size === 0) {
            await this.unsubscribeFromCoinbaseChannel(productId);
            this.subscribedProductIds.delete(productId);
        }
    }

    /**
     * Unsubscribe from Coinbase user channel for a specific product
     */
    private async unsubscribeFromCoinbaseChannel(productId: string): Promise<void> {
        if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
            return;
        }

        const unsubscribeMessage = {
            type: 'unsubscribe',
            product_ids: [productId],
            channel: 'user'
        };

        this.websocket.send(JSON.stringify(unsubscribeMessage));
        console.log(`[${this.exchangeName}] Unsubscribed from user channel for ${productId}`);
    }
}

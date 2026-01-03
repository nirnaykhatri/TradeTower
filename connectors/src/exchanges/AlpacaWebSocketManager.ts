import WebSocket from 'ws';
import { TradeOrder } from '@trading-tower/shared';
import { WebSocketManager, WebSocketConfig } from '../utils/WebSocketManager';

interface AlpacaTradeUpdate {
    stream: string; // e.g., "trade_updates"
    data: {
        event: 'new' | 'fill' | 'partial_fill' | 'canceled' | 'expired' | 'rejected';
        order: {
            id: string;
            client_order_id?: string;
            symbol: string;
            side: 'buy' | 'sell';
            type: string;
            qty: string;
            filled_qty: string;
            limit_price?: string;
            stop_price?: string;
            extended_hours?: boolean;
            submitted_at?: string;
            updated_at?: string;
        };
        price?: string; // fill price
        position_qty?: string;
        timestamp?: string;
    };
}

/**
 * Alpaca WebSocket Manager
 *
 * Connects to Alpaca trade_updates stream to receive order fills, partial fills,
 * and cancellations in real-time.
 */
export class AlpacaWebSocketManager extends WebSocketManager {
    private readonly isPaper: boolean;
    private subscribed: boolean = false;

    constructor(apiKey: string, apiSecret: string, isPaper: boolean, configOverrides?: Partial<WebSocketConfig>) {
        super('Alpaca', apiKey, apiSecret, configOverrides);
        this.isPaper = isPaper;
    }

    /**
     * Determine correct WebSocket endpoint (paper vs. live)
     */
    protected getWebSocketUrl(): string {
        return this.isPaper
            ? 'wss://paper-api.alpaca.markets/stream'
            : 'wss://api.alpaca.markets/stream';
    }

    /**
     * Authenticate with Alpaca stream and subscribe to trade_updates
     */
    protected async authenticate(): Promise<void> {
        const ws = this.ws;
        if (!ws) throw new Error('WebSocket not initialized');

        await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Alpaca auth timeout'));
            }, this.config.connectionTimeoutMs);

            const onMessage = (raw: WebSocket.RawData) => {
                try {
                    const text = typeof raw === 'string'
                        ? raw
                        : Array.isArray(raw)
                            ? Buffer.concat(raw as Buffer[]).toString()
                            : Buffer.isBuffer(raw)
                                ? raw.toString()
                                : Buffer.from(raw as ArrayBuffer).toString();
                    const msg = JSON.parse(text);
                    if (msg.stream === 'authorization') {
                        if (msg.data?.status === 'authorized') {
                            // Auth success, now subscribe
                            clearTimeout(timeout);
                            ws.off('message', onMessage);
                            this.subscribeStream().then(resolve).catch(reject);
                        } else {
                            clearTimeout(timeout);
                            ws.off('message', onMessage);
                            reject(new Error(`Alpaca auth failed: ${msg.data?.status}`));
                        }
                    }
                } catch (err) {
                    // Non-auth messages during auth phase are expected and safely ignored
                    console.debug(`[${this.exchangeName}] Non-auth message during auth phase:`, err);
                }
            };

            ws.on('message', onMessage);

            const authPayload = {
                action: 'authenticate',
                data: {
                    key_id: this.apiKey,
                    secret_key: this.apiSecret
                }
            };
            ws.send(JSON.stringify(authPayload));
        });
    }

    /**
     * Subscribe to trade_updates stream (idempotent)
     */
    private async subscribeStream(): Promise<void> {
        if (!this.ws || this.subscribed) return;
        const listenPayload = {
            action: 'listen',
            data: {
                streams: ['trade_updates']
            }
        };
        this.ws.send(JSON.stringify(listenPayload));
        this.subscribed = true;
    }

    /**
     * Parse incoming messages and route events
     */
    protected async onMessage(data: WebSocket.RawData): Promise<void> {
        const text = this.parseRawData(data);
        const msg: AlpacaTradeUpdate = JSON.parse(text);

        if (msg.stream !== 'trade_updates') return;

        const event = msg.data.event;
        const order = msg.data.order;
        const pair = order.symbol;
        const tradeOrder = this.mapToTradeOrder(msg);

        if (event === 'fill') {
            await this.emitOrderFilled(pair, tradeOrder);
        } else if (event === 'partial_fill') {
            await this.emitOrderPartiallyFilled(pair, tradeOrder);
        } else if (event === 'canceled' || event === 'expired' || event === 'rejected') {
            await this.emitOrderCancelled(pair, order.id);
        }
    }

    /**
     * Map Alpaca trade update to TradeOrder
     */
    private mapToTradeOrder(msg: AlpacaTradeUpdate): TradeOrder {
        const { order, price, timestamp } = msg.data;
        const filledQty = parseFloat(order.filled_qty || '0');
        const limitPrice = parseFloat(order.limit_price || '0');

        return {
            id: order.id,
            userId: '',
            botId: '',
            exchangeId: 'alpaca',
            pair: order.symbol,
            side: order.side,
            type: this.mapOrderType(order.type),
            status: this.mapOrderStatus(msg.data.event),
            price: limitPrice || parseFloat(price || '0') || 0,
            amount: parseFloat(order.qty || '0'),
            filledAmount: filledQty,
            fee: 0,
            feeCurrency: 'USD',
            extendedHours: order.extended_hours,
            timestamp: timestamp || order.updated_at || order.submitted_at || new Date().toISOString()
        };
    }

    private mapOrderType(type: string): 'limit' | 'market' {
        const t = (type || '').toLowerCase();
        if (t.includes('market')) return 'market';
        return 'limit';
    }

    private mapOrderStatus(event: string): 'open' | 'filled' | 'canceled' | 'rejected' | 'expired' {
        switch (event) {
            case 'fill':
                return 'filled';
            case 'canceled':
                return 'canceled';
            case 'rejected':
                return 'rejected';
            case 'expired':
                return 'expired';
            case 'partial_fill':
            case 'new':
            default:
                return 'open';
        }
    }
}

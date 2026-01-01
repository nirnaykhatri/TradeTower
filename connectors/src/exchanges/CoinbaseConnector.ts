import { IExchangeConnector, ExchangeBalance, TickerData } from '../interfaces/IExchangeConnector';
import { TradeOrder } from '@trading-tower/shared';
import { BaseCoinbaseConnector } from './BaseCoinbaseConnector';

export class CoinbaseConnector extends BaseCoinbaseConnector implements IExchangeConnector {
    public readonly name = 'Coinbase';
    protected readonly productType = 'SPOT';

    constructor(apiKey: string, apiSecret: string) {
        super(apiKey, apiSecret, 'Coinbase');
    }

    async ping(): Promise<boolean> {
        try {
            await this.client.get('/api/v3/brokerage/accounts?limit=1');
            return true;
        } catch {
            return false;
        }
    }

    async getBalances(): Promise<ExchangeBalance[]> {
        const response = await this.client.get('/api/v3/brokerage/accounts');
        return response.data.accounts.map((acc: any) => ({
            asset: acc.currency,
            free: parseFloat(acc.available_balance.value),
            locked: parseFloat(acc.hold.value)
        }));
    }

    async getTicker(symbol: string): Promise<TickerData> {
        const productId = symbol.replace('/', '-').toUpperCase();
        const response = await this.client.get(`/api/v3/brokerage/products/${productId}`);
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

    async getCandles(symbol: string, interval: string, limit: number = 100): Promise<any[]> {
        const productId = symbol.replace('/', '-').toUpperCase();
        const end = Math.floor(Date.now() / 1000);
        const start = end - (limit * 60);
        const response = await this.client.get(`/api/v3/brokerage/products/${productId}/candles`, {
            params: { start, end, granularity: interval }
        });
        return response.data.candles;
    }

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

        const response = await this.client.post('/api/v3/brokerage/orders', body);
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

    async cancelOrder(orderId: string, symbol: string): Promise<boolean> {
        await this.client.post('/api/v3/brokerage/orders/batch_cancel', { order_ids: [orderId] });
        return true;
    }

    async getOrder(orderId: string, symbol: string): Promise<TradeOrder> {
        const response = await this.client.get(`/api/v3/brokerage/orders/historical/${orderId}`);
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
}

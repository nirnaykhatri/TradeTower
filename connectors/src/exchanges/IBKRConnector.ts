import { IExchangeConnector, ExchangeBalance, TickerData } from '../interfaces/IExchangeConnector';
import { TradeOrder, RateLimiter } from '@trading-tower/shared';
import { ExchangeError } from '../interfaces/ExchangeError';
import axios, { AxiosInstance, AxiosError } from 'axios';
import * as https from 'https';

export class IBKRConnector implements IExchangeConnector {
    public readonly name = 'IBKR';
    private client: AxiosInstance;
    private agent: https.Agent;
    private rateLimiter: RateLimiter;

    constructor(private host: string, private port: number = 5000) {
        this.agent = new https.Agent({ rejectUnauthorized: false });
        this.client = axios.create({
            baseURL: `https://${host}:${port}/v1/api`,
            httpsAgent: this.agent
        });

        // Initialize rate limiter for IBKR API (100 requests per minute)
        this.rateLimiter = new RateLimiter({
            maxRequests: 100,
            windowMs: 60000 // 1 minute
        });

        // Add error normalization interceptor
        this.client.interceptors.response.use(
            (response) => response,
            (error: AxiosError) => {
                throw new ExchangeError(
                    this.name,
                    (error.response?.data as any)?.error || error.message,
                    error.response?.status,
                    error.response?.data
                );
            }
        );
    }

    async ping(): Promise<boolean> {
        try {
            const response = await this.rateLimiter.execute(() =>
                this.client.get('/tickle')
            );
            return response.status === 200;
        } catch {
            return false;
        }
    }

    async getBalances(): Promise<ExchangeBalance[]> {
        const accountsRes = await this.rateLimiter.execute(() =>
            this.client.get('/iserver/accounts')
        );
        // Handle multiple accounts - for simplicity, we use the first one, but we check if it exists.
        const accountId = accountsRes.data.accounts?.[0];
        if (!accountId) throw new ExchangeError(this.name, 'No accounts found');

        const response = await this.rateLimiter.execute(() =>
            this.client.get(`/iserver/account/${accountId}/summary`)
        );

        return [{
            asset: 'USD',
            free: parseFloat(response.data.availablefunds || '0'),
            locked: parseFloat(response.data.maintmargin || '0')
        }];
    }

    /**
     * Get ticker data for trading symbol
     * 
     * Rate limited to prevent exceeding IBKR API limits.
     * 
     * @param symbol Trading symbol (e.g., 'AAPL')
     * @returns Ticker data with price and volume
     */
    async getTicker(symbol: string): Promise<TickerData> {
        const searchRes = await this.rateLimiter.execute(() =>
            this.client.get('/iserver/secdef/search', {
                params: { symbol: symbol.toUpperCase() }
            })
        );

        const conid = searchRes.data[0]?.conid;
        if (!conid) throw new ExchangeError(this.name, `Symbol ${symbol} not found on IBKR`);

        const response = await this.rateLimiter.execute(() =>
            this.client.get('/iserver/marketdata/snapshot', {
            params: { conids: conid, fields: '31,70,71,84' }
        })
        );

        const data = response.data[0];
        return {
            symbol: symbol.toUpperCase(),
            lastPrice: parseFloat(data['31'] || '0'),
            bid: parseFloat(data['84'] || '0'),
            ask: parseFloat(data['86'] || '0'),
            volume: parseFloat(data['87'] || '0'),
            timestamp: Date.now()
        };
    }

    async getCandles(symbol: string, interval: string, limit: number = 100): Promise<any[]> {
        return [];
    }

    /**
     * Create a new order on IBKR
     * 
     * Rate limited to prevent hitting API limits.
     * Supports market and limit orders.
     * 
     * @param order Order specification
     * @returns Created order details
     */
    async createOrder(order: Partial<TradeOrder>): Promise<TradeOrder> {
        const accountsRes = await this.rateLimiter.execute(() =>
            this.client.get('/iserver/accounts')
        );
        const accountId = accountsRes.data.accounts?.[0];
        if (!accountId) throw new ExchangeError(this.name, 'No accounts found');

        const searchRes = await this.rateLimiter.execute(() =>
            this.client.get('/secdef/search', {
                params: { symbol: order.pair?.toUpperCase() }
            })
        );
        const conid = searchRes.data[0]?.conid;
        if (!conid) throw new ExchangeError(this.name, `Symbol ${order.pair} not found`);

        const ibOrder = {
            orders: [{
                conid: conid,
                orderType: order.type?.toUpperCase() === 'LIMIT' ? 'LMT' : 'MKT',
                side: order.side?.toUpperCase(),
                quantity: order.amount,
                price: order.price,
                tif: 'GTC',
                outsideRth: order.extendedHours ?? true
            }]
        };

        const response = await this.rateLimiter.execute(() =>
            this.client.post(`/iserver/account/${accountId}/orders`, ibOrder)
        );
        const res = response.data[0];

        return {
            id: res.order_id || res.id,
            userId: order.userId || '',
            botId: order.botId || '',
            exchangeId: 'ibkr',
            pair: order.pair || '',
            side: order.side || 'buy',
            type: order.type || 'limit',
            status: 'open',
            price: order.price || 0,
            amount: order.amount || 0,
            filledAmount: 0,
            fee: 0,
            feeCurrency: 'USD',
            extendedHours: order.extendedHours ?? true,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Cancel an open order
     * 
     * Rate limited to prevent exceeding API limits.
     * 
     * @param orderId Order ID to cancel
     * @param symbol Trading symbol
     * @returns True if cancellation successful
     */
    async cancelOrder(orderId: string, symbol: string): Promise<boolean> {
        const accountsRes = await this.rateLimiter.execute(() =>
            this.client.get('/iserver/accounts')
        );
        const accountId = accountsRes.data.accounts?.[0];
        if (!accountId) throw new ExchangeError(this.name, 'No accounts found');

        await this.rateLimiter.execute(() =>
            this.client.delete(`/iserver/account/${accountId}/order/${orderId}`)
        );
        return true;
    }

    async getOrder(orderId: string, symbol: string): Promise<TradeOrder> {
        throw new Error('Not implemented');
    }
}

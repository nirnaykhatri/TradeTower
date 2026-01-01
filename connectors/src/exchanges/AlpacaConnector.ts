import { IExchangeConnector, ExchangeBalance, TickerData } from '../interfaces/IExchangeConnector';
import { TradeOrder, RateLimiter, ExchangeRateLimiters } from '@trading-tower/shared';
import { ExchangeError } from '../interfaces/ExchangeError';
import axios, { AxiosInstance, AxiosError } from 'axios';

export class AlpacaConnector implements IExchangeConnector {
    public readonly name = 'Alpaca';
    private api: AxiosInstance;
    private data: AxiosInstance;
    private rateLimiter: RateLimiter;

    constructor(private apiKey: string, private apiSecret: string, isPaper: boolean = true) {
        const baseURL = isPaper ? 'https://paper-api.alpaca.markets' : 'https://api.alpaca.markets';

        const commonHeaders = {
            'APCA-API-KEY-ID': this.apiKey,
            'APCA-API-SECRET-KEY': this.apiSecret
        };

        this.api = axios.create({
            baseURL,
            headers: commonHeaders
        });

        this.data = axios.create({
            baseURL: 'https://data.alpaca.markets/v2',
            headers: commonHeaders
        });

        // Initialize rate limiter for Alpaca API
        this.rateLimiter = ExchangeRateLimiters.ALPACA;

        const errorInterceptor = (error: AxiosError) => {
            throw new ExchangeError(
                this.name,
                (error.response?.data as any)?.message || error.message,
                error.response?.status,
                error.response?.data
            );
        };

        this.api.interceptors.response.use(r => r, errorInterceptor);
        this.data.interceptors.response.use(r => r, errorInterceptor);
    }

    async ping(): Promise<boolean> {
        try {
            await this.rateLimiter.execute(() => 
                this.api.get('/v2/clock')
            );
            return true;
        } catch {
            return false;
        }
    }

    async getBalances(): Promise<ExchangeBalance[]> {
        const response = await this.rateLimiter.execute(() =>
            this.api.get('/v2/account')
        );
        const acc = response.data;
        return [
            {
                asset: 'USD',
                free: parseFloat(acc.cash),
                locked: parseFloat(acc.equity) - parseFloat(acc.cash)
            }
        ];
    }

    /**
     * Get ticker data for trading symbol
     * 
     * Rate limited to prevent exceeding Alpaca API limits.
     * 
     * @param symbol Stock symbol (e.g., 'AAPL')
     * @returns Ticker data with price and volume
     */
    async getTicker(symbol: string): Promise<TickerData> {
        const response = await this.rateLimiter.execute(() =>
            this.data.get(`/stocks/${symbol}/trades/latest`)
        );
        const trade = response.data.trade;

        return {
            symbol,
            lastPrice: trade.p,
            bid: trade.p,
            ask: trade.p,
            volume: trade.s,
            timestamp: new Date(trade.t).getTime()
        };
    }

    async getCandles(symbol: string, interval: string, limit: number = 100): Promise<any[]> {
        return [];
    }

    /**
     * Create a new order on Alpaca
     * 
     * Rate limited to prevent hitting API limits.
     * Supports market and limit orders.
     * 
     * @param order Order specification
     * @returns Created order details
     */
    async createOrder(order: Partial<TradeOrder>): Promise<TradeOrder> {
        const payload = {
            symbol: order.pair,
            qty: order.amount,
            side: order.side,
            type: order.type,
            time_in_force: 'gtc',
            limit_price: order.type === 'limit' ? order.price : undefined,
            extended_hours: order.extendedHours ?? true,
        };

        const response = await this.rateLimiter.execute(() =>
            this.api.post('/v2/orders', payload)
        );
        const res = response.data;

        return {
            id: res.id,
            userId: order.userId || '',
            botId: order.botId || '',
            exchangeId: 'alpaca',
            pair: res.symbol,
            side: res.side,
            type: res.type,
            status: this.mapStatus(res.status),
            price: parseFloat(res.limit_price || '0'),
            amount: parseFloat(res.qty),
            filledAmount: parseFloat(res.filled_qty),
            fee: 0,
            feeCurrency: 'USD',
            extendedHours: res.extended_hours,
            timestamp: res.created_at
        };
    }

    private mapStatus(status: string): any {
        switch (status) {
            case 'filled': return 'filled';
            case 'canceled': return 'canceled';
            case 'new':
            case 'partially_filled': return 'open';
            default: return 'rejected';
        }
    }

    /**
     * Cancel an open order
     * 
     * Rate limited to prevent exceeding API limits.
     * 
     * @param orderId Order ID to cancel
     * @param symbol Stock symbol
     * @returns True if cancellation successful
     */
    async cancelOrder(orderId: string, symbol: string): Promise<boolean> {
        await this.rateLimiter.execute(() =>
            this.api.delete(`/v2/orders/${orderId}`)
        );
        return true;
    }

    /**
     * Get order details
     * 
     * Rate limited to prevent exceeding API limits.
     * 
     * @param orderId Order ID to retrieve
     * @param symbol Stock symbol
     * @returns Order details
     */
    async getOrder(orderId: string, symbol: string): Promise<TradeOrder> {
        const response = await this.rateLimiter.execute(() =>
            this.api.get(`/v2/orders/${orderId}`)
        );
        const res = response.data;
        return {
            id: res.id,
            userId: '',
            botId: '',
            exchangeId: 'alpaca',
            pair: res.symbol,
            side: res.side,
            type: res.type,
            status: this.mapStatus(res.status),
            price: parseFloat(res.limit_price || '0'),
            amount: parseFloat(res.qty),
            filledAmount: parseFloat(res.filled_qty),
            fee: 0,
            feeCurrency: 'USD',
            extendedHours: res.extended_hours,
            timestamp: res.created_at
        };
    }
}

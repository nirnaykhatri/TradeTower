import { IExchangeConnector, ExchangeBalance, TickerData } from '../interfaces/IExchangeConnector';
import { TradeOrder, RateLimiter, ExchangeRateLimiters } from '@trading-tower/shared';
import { AuthUtils } from '../utils/AuthUtils';
import { ExchangeError } from '../interfaces/ExchangeError';
import axios, { AxiosInstance, AxiosError } from 'axios';

/**
 * Binance Exchange Connector
 * 
 * Implements trading operations on Binance spot market with:
 * - Rate limiting to prevent API violations (1200 requests/min)
 * - Signature-based authentication
 * - Comprehensive error handling
 * - Ticker, balance, order, and candle data retrieval
 */
export class BinanceConnector implements IExchangeConnector {
    public readonly name = 'Binance';
    private client: AxiosInstance;
    private rateLimiter: RateLimiter;

    constructor(private apiKey: string, private apiSecret: string) {
        this.client = axios.create({
            baseURL: 'https://api.binance.com'
        });

        // Initialize rate limiter for Binance API
        this.rateLimiter = ExchangeRateLimiters.BINANCE;

        // Add interceptor for error normalization
        this.client.interceptors.response.use(
            (response) => response,
            (error: AxiosError) => {
                throw new ExchangeError(
                    this.name,
                    (error.response?.data as any)?.msg || error.message,
                    error.response?.status,
                    error.response?.data
                );
            }
        );
    }

    private getSignedRequest(params: any = {}) {
        const timestamp = Date.now();
        const queryParams = { ...params, timestamp };
        const queryString = Object.keys(queryParams)
            .map(key => `${key}=${encodeURIComponent(queryParams[key])}`)
            .join('&');

        const signature = AuthUtils.generateBinanceSignature(this.apiSecret, queryString);
        return `${queryString}&signature=${signature}`;
    }

    async ping(): Promise<boolean> {
        try {
            await this.rateLimiter.execute(() => 
                this.client.get('/api/v3/ping')
            );
            return true;
        } catch {
            return false;
        }
    }

    async getBalances(): Promise<ExchangeBalance[]> {
        const signedQuery = this.getSignedRequest();
        const response = await this.rateLimiter.execute(() =>
            this.client.get(`/api/v3/account?${signedQuery}`, {
                headers: { 'X-MBX-APIKEY': this.apiKey }
            })
        );

        return response.data.balances
            .filter((b: any) => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0)
            .map((b: any) => ({
                asset: b.asset,
                free: parseFloat(b.free),
                locked: parseFloat(b.locked)
            }));
    }

    /**
     * Get ticker data for trading pair
     * 
     * Rate limited to prevent exceeding Binance API limits.
     * 
     * @param symbol Trading pair symbol (e.g., 'BTC/USDT')
     * @returns Ticker data with price, bid/ask, volume
     */
    async getTicker(symbol: string): Promise<TickerData> {
        const response = await this.rateLimiter.execute(() =>
            this.client.get('/api/v3/ticker/24hr', {
                params: { symbol: symbol.toUpperCase().replace('/', '') }
            })
        );
        const data = response.data;

        return {
            symbol: data.symbol,
            lastPrice: parseFloat(data.lastPrice),
            bid: parseFloat(data.bidPrice),
            ask: parseFloat(data.askPrice),
            volume: parseFloat(data.volume),
            timestamp: data.closeTime
        };
    }

    /**
     * Get historical candles/OHLCV data
     * 
     * Rate limited to prevent exceeding API limits.
     * 
     * @param symbol Trading pair symbol
     * @param interval Candle interval (e.g., '1h', '4h')
     * @param limit Number of candles to fetch (max 1000)
     * @returns Array of OHLCV candles
     */
    async getCandles(symbol: string, interval: string, limit: number = 100): Promise<any[]> {
        const response = await this.rateLimiter.execute(() =>
            this.client.get('/api/v3/klines', {
                params: {
                    symbol: symbol.toUpperCase().replace('/', ''),
                    interval,
                    limit
                }
            })
        );
        return response.data;
    }

    /**
     * Create a new order on Binance
     * 
     * Rate limited to prevent hitting API limits.
     * Supports market and limit orders.
     * 
     * @param order Order specification
     * @returns Created order details
     */
    async createOrder(order: Partial<TradeOrder>): Promise<TradeOrder> {
        const params = {
            symbol: order.pair?.toUpperCase().replace('/', ''),
            side: order.side?.toUpperCase(),
            type: order.type?.toUpperCase(),
            quantity: order.amount,
            price: order.type === 'limit' ? order.price : undefined,
            timeInForce: order.type === 'limit' ? 'GTC' : undefined
        };

        const signedQuery = this.getSignedRequest(params);
        const response = await this.rateLimiter.execute(() =>
            this.client.post(`/api/v3/order?${signedQuery}`, null, {
                headers: { 'X-MBX-APIKEY': this.apiKey }
            })
        );

        const res = response.data;
        return {
            id: res.orderId.toString(),
            userId: order.userId || '',
            botId: order.botId || '',
            exchangeId: 'binance',
            pair: res.symbol,
            side: res.side.toLowerCase() as any,
            type: res.order_type?.toLowerCase() || res.type.toLowerCase() as any,
            status: this.mapStatus(res.status),
            price: parseFloat(res.price || '0'),
            amount: parseFloat(res.origQty),
            filledAmount: parseFloat(res.executedQty),
            fee: 0,
            feeCurrency: 'USDT',
            timestamp: new Date(res.transactTime).toISOString()
        };
    }

    private mapStatus(status: string): any {
        switch (status) {
            case 'FILLED': return 'filled';
            case 'CANCELED': return 'canceled';
            case 'NEW':
            case 'PARTIALLY_FILLED': return 'open';
            default: return 'rejected';
        }
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
        const params = {
            symbol: symbol.toUpperCase().replace('/', ''),
            orderId: orderId
        };
        const signedQuery = this.getSignedRequest(params);
        await this.rateLimiter.execute(() =>
            this.client.delete(`/api/v3/order?${signedQuery}`, {
                headers: { 'X-MBX-APIKEY': this.apiKey }
            })
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
        const params = {
            symbol: symbol.toUpperCase().replace('/', ''),
            orderId: orderId
        };
        const signedQuery = this.getSignedRequest(params);
        const response = await this.rateLimiter.execute(() =>
            this.client.get(`/api/v3/order?${signedQuery}`, {
                headers: { 'X-MBX-APIKEY': this.apiKey }
            })
        );
        const res = response.data;

        return {
            id: res.orderId.toString(),
            userId: '',
            botId: '',
            exchangeId: 'binance',
            pair: res.symbol,
            side: res.side.toLowerCase() as any,
            type: res.type.toLowerCase() as any,
            status: this.mapStatus(res.status),
            price: parseFloat(res.price || '0'),
            amount: parseFloat(res.origQty),
            filledAmount: parseFloat(res.executedQty),
            fee: 0,
            feeCurrency: 'USDT',
            timestamp: new Date(res.time).toISOString()
        };
    }
}

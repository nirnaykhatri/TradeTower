import axios, { AxiosInstance, AxiosError } from 'axios';
import { TradeOrder, RateLimiter, ExchangeRateLimiters } from '@trading-tower/shared';
import { AuthUtils } from '../utils/AuthUtils';
import { ExchangeError } from '../interfaces/ExchangeError';

export abstract class BaseCoinbaseConnector {
    protected client: AxiosInstance;
    protected rateLimiter: RateLimiter;
    protected abstract readonly productType: string;

    constructor(
        protected apiKey: string,
        protected apiSecret: string,
        protected exchangeName: string
    ) {
        this.client = axios.create({
            baseURL: 'https://api.coinbase.com'
        });

        // Initialize rate limiter for Coinbase API
        this.rateLimiter = ExchangeRateLimiters.COINBASE;

        // Add interceptor for authentication
        this.client.interceptors.request.use((config) => {
            const timestamp = Math.floor(Date.now() / 1000).toString();
            const method = config.method?.toUpperCase() || 'GET';
            const path = (config.url?.startsWith('http')
                ? new URL(config.url).pathname + new URL(config.url).search
                : config.url) || '';

            const body = config.data ? JSON.stringify(config.data) : '';
            const signature = AuthUtils.generateCoinbaseSignature(this.apiSecret, timestamp, method, path, body);

            config.headers['CB-ACCESS-KEY'] = this.apiKey;
            config.headers['CB-ACCESS-SIGN'] = signature;
            config.headers['CB-ACCESS-TIMESTAMP'] = timestamp;
            config.headers['Content-Type'] = 'application/json';

            return config;
        });

        // Add interceptor for error normalization
        this.client.interceptors.response.use(
            (response) => response,
            (error: AxiosError) => {
                throw new ExchangeError(
                    this.exchangeName,
                    (error.response?.data as any)?.message || error.message,
                    error.response?.status,
                    error.response?.data
                );
            }
        );
    }
}

import { TradeOrder } from '@trading-tower/shared';

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
}

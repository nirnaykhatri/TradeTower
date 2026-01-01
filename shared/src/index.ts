export interface UserProfile {
    id: string; // The userId from B2C (decoded.sub)
    userId: string; // Partition key = id
    email: string;
    name?: string;
    createdAt: string;
    updatedAt: string;
    preferences: {
        theme: 'dark' | 'light';
        notifications: boolean;
        defaultCurrency: string;
    };
}

export interface BotPerformance {
    totalPnL: number;        // Total profit in quote currency
    totalPnLPercent: number; // Growth relative to initial investment
    botProfit: number;       // Profit from completed grid cycles/trades
    realizedPnL: number;     // Profit from closed positions
    unrealizedPnL: number;   // Current value of held assets vs cost (Value Change)
    annualizedReturn: number;// Estimated yearly return %
    drawdown: number;        // Max drop from peak
    totalTrades: number;
    winRate: number;
    baseBalance: number;     // Amount of base asset currently held by bot
    quoteBalance: number;    // Amount of quote asset currently held by bot
    initialInvestment: number;
    initialPrice: number;    // Price when bot started

    // DCA Specific (can be used by other strategies partially)
    avgEntryPrice?: number;
    breakEvenPrice?: number;
    filledSafetyOrders?: number;
    totalSafetyOrders?: number;

    // Futures Specific
    liquidationPrice?: number;
    marginRatio?: number;
    activeMargin?: number;
}

export interface BotInstance {
    id: string; // Unique bot ID
    userId: string; // Partition key
    name: string;
    exchangeId: string;
    pair: string;
    strategyType: 'GRID' | 'DCA' | 'BTD' | 'COMBO' | 'LOOP' | 'DCA_FUTURES' | 'FUTURES_GRID' | 'TWAP';
    status: 'stopped' | 'running' | 'paused' | 'completed' | 'error';
    triggerType: 'manual' | 'webhook' | 'indicator';
    webhookSecret?: string;
    config: any; // Strategy-specific config

    // Performance metrics
    performance: BotPerformance;

    lastExecutionAt?: string;
    createdAt: string;
    updatedAt: string;
}

export interface TradeOrder {
    id: string; // Order ID from exchange
    userId: string; // Partition key
    botId: string;
    exchangeId: string;
    pair: string;
    side: 'buy' | 'sell';
    type: 'limit' | 'market';
    status: 'open' | 'filled' | 'canceled' | 'rejected' | 'expired';
    price: number;
    amount: number;
    filledAmount: number;
    fee: number;
    feeCurrency: string;
    extendedHours?: boolean; // Support for pre/post market trading
    timestamp: string;
    reduceOnly?: boolean;
}

export type SignalSource = 'tradingview' | 'manual' | 'MACD' | 'RSI' | 'Stochastic';
export type Timeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d';

export interface TradingSignal {
    id: string; // Internal unique ID
    userId: string; // Partition key
    botId: string;
    source: SignalSource;
    timeframe?: Timeframe;
    action: string;
    payload: any;
    receivedAt: string;
    processed: boolean;
    error?: string;
}

export interface PerformanceSnapshot {
    id: string; // Unique snapshot ID
    userId: string; // Partition key
    botId?: string; // Optional: specific bot snapshot (null for global user metrics)
    timestamp: string;
    totalEquity: number;
    unrealizedPnL: number;
    realizedPnL: number;
    dailyPnL: number;
    drawdown: number;
}
export * from './indicators/IndicatorService';
export * from './db/CosmosService';
export * from './db/BaseRepository';
export * from './db/BotRepository';
export * from './db/OrderRepository';
export * from './errors';
export * from './utils/RateLimiter';
export * from './utils/validation';

// Create default database service and repositories for convenience
import { dbService } from './db/CosmosService';
import { createBotRepository } from './db/BotRepository';
import { createOrderRepository } from './db/OrderRepository';

// Create default repository instances with the default database service
export const botRepository = createBotRepository(dbService);
export const orderRepository = createOrderRepository(dbService);

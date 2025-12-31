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

export interface BotInstance {
    id: string; // Unique bot ID
    userId: string; // Partition key
    name: string;
    exchangeId: string;
    pair: string;
    strategyType: 'GRID' | 'DCA' | 'BTD' | 'COMBO' | 'LOOP' | 'DCA_FUTURES' | 'FUTURES_GRID' | 'TWAP';
    status: 'stopped' | 'running' | 'paused' | 'completed' | 'error';
    config: any; // Strategy-specific config
    totalPnL: number;
    totalTrades: number;
    winRate: number;
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
    timestamp: string;
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

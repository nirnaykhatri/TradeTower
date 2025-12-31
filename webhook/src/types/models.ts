export interface BotInstance {
    id: string;
    userId: string;
    name: string;
    exchangeId: string;
    pair: string;
    strategyType: 'GRID' | 'DCA' | 'BTD' | 'COMBO' | 'LOOP' | 'DCA_FUTURES' | 'FUTURES_GRID' | 'TWAP';
    status: 'stopped' | 'running' | 'paused' | 'completed' | 'error';
    triggerType: 'manual' | 'webhook' | 'indicator';
    webhookSecret?: string;
    config: any;
    totalPnL: number;
    totalTrades: number;
    winRate: number;
    lastExecutionAt?: string;
    createdAt: string;
    updatedAt: string;
}

export type SignalSource = 'tradingview' | 'manual' | 'MACD' | 'RSI' | 'Stochastic';

export interface TradingSignal {
    id: string;
    userId: string;
    botId: string;
    source: SignalSource;
    action: string;
    payload: any;
    receivedAt: string;
    processed: boolean;
    error?: string;
}

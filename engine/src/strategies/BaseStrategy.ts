import { BotInstance, TradeOrder, botRepository, orderRepository, BotPerformance } from '@trading-tower/shared';
import { IExchangeConnector } from '@trading-tower/connectors';

export type ExitMode = 'CANCEL_ALL' | 'MARKET_SELL' | 'KEEP_ORDERS';

export interface IBotStrategy {
    initialize(): Promise<void>;
    start(): Promise<void>;
    stop(exitMode?: ExitMode): Promise<void>;
    pause(): Promise<void>;
    resume(): Promise<void>;
    modifyConfig(newConfig: any): Promise<void>;
    onPriceUpdate(price: number): Promise<void>;
    onOrderFilled(order: TradeOrder): Promise<void>;
}

export abstract class BaseStrategy<T = any> implements IBotStrategy {
    protected lastPrice: number = 0;
    protected isPaused: boolean = false;

    constructor(
        protected bot: BotInstance,
        protected exchange: IExchangeConnector,
        protected config: T
    ) {
        if (!this.bot.performance) {
            this.bot.performance = this.getDefaultPerformance();
        }
    }

    private getDefaultPerformance(): BotPerformance {
        return {
            totalPnL: 0,
            totalPnLPercent: 0,
            botProfit: 0,
            realizedPnL: 0,
            unrealizedPnL: 0,
            annualizedReturn: 0,
            drawdown: 0,
            totalTrades: 0,
            winRate: 0,
            baseBalance: 0,
            quoteBalance: (this.config as any).investment || 0,
            initialInvestment: (this.config as any).investment || 0,
            initialPrice: 0
        };
    }

    abstract initialize(): Promise<void>;
    abstract start(): Promise<void>;

    /**
     * Professional Stop with Modes (Bitsgap style)
     */
    async stop(exitMode: ExitMode = 'CANCEL_ALL'): Promise<void> {
        console.log(`[Bot ${this.bot.id}] Stopping with mode: ${exitMode}`);

        if (exitMode === 'CANCEL_ALL' || exitMode === 'MARKET_SELL') {
            await this.cancelAllActiveOrders();
        }

        if (exitMode === 'MARKET_SELL' && this.bot.performance.baseBalance > 0) {
            console.log(`[Bot ${this.bot.id}] Market selling remaining balance: ${this.bot.performance.baseBalance}`);
            try {
                const order = await this.exchange.createOrder({
                    userId: this.bot.userId,
                    botId: this.bot.id,
                    pair: this.bot.pair,
                    side: 'sell',
                    type: 'market',
                    amount: this.bot.performance.baseBalance
                });
                await this.recordTrade(order);
            } catch (e) {
                console.error(`[Bot ${this.bot.id}] Final market sell failed:`, e);
            }
        }

        await this.updateBotStatus('stopped');
    }

    async pause(): Promise<void> {
        this.isPaused = true;
        await this.updateBotStatus('paused');
    }

    async resume(): Promise<void> {
        this.isPaused = false;
        await this.updateBotStatus('running');
    }

    async modifyConfig(newConfig: any): Promise<void> {
        console.log(`[Bot ${this.bot.id}] Modifying configuration.`);
        this.config = { ...this.config, ...newConfig };
        this.bot.config = this.config;

        await this.initialize();

        await botRepository.update(this.bot.id, this.bot.userId, { config: this.config });
    }

    async increaseInvestment(amount: number): Promise<void> {
        console.log(`[Bot ${this.bot.id}] Increasing investment by ${amount}.`);
        (this.config as any).investment += amount;
        this.bot.performance.initialInvestment += amount;
        this.bot.performance.quoteBalance += amount;

        await this.initialize(); // Recalculate grid/DCA with new balance
        await botRepository.update(this.bot.id, this.bot.userId, {
            config: this.config,
            performance: this.bot.performance
        });
    }

    protected abstract cancelAllActiveOrders(): Promise<void>;

    abstract onPriceUpdate(price: number): Promise<void>;
    abstract onOrderFilled(order: TradeOrder): Promise<void>;

    protected async recordTrade(order: TradeOrder) {
        console.log(`[Bot ${this.bot.id}] Trade completed: ${order.side.toUpperCase()} ${order.amount} ${order.pair} @ ${order.price}`);
        try {
            await orderRepository.upsert(order);
            this.bot.performance.totalTrades += 1;
            await botRepository.update(this.bot.id, this.bot.userId, {
                performance: this.bot.performance,
                lastExecutionAt: new Date().toISOString(),
                status: this.bot.status
            });
        } catch (error) {
            console.error(`[Bot ${this.bot.id}] Failed to update performance in DB:`, error);
        }
    }

    protected async updateBotStatus(status: BotInstance['status']) {
        this.bot.status = status;
        console.log(`[Bot ${this.bot.id}] Status changed to ${status}`);
        try {
            await botRepository.update(this.bot.id, this.bot.userId, { status });
        } catch (error) {
            console.error(`[Bot ${this.bot.id}] Failed to sync status to DB:`, error);
        }
    }

    protected calculateAnnualizedReturn(): number {
        const startTime = new Date(this.bot.createdAt).getTime();
        const now = Date.now();
        const diffDays = (now - startTime) / (1000 * 60 * 60 * 24);
        if (diffDays < 0.01) return 0;
        const returnOnInvestment = this.bot.performance.totalPnL / (this.bot.performance.initialInvestment || 1);
        return (returnOnInvestment / diffDays) * 365 * 100;
    }
}

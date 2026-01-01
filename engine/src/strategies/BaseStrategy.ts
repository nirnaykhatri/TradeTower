import {
    BotInstance,
    TradeOrder,
    botRepository,
    orderRepository,
    BotPerformance,
    ExchangeError,
    CriticalStrategyError,
    OrderExecutionError,
    ValidationError,
    withRetry,
    DEFAULT_RETRY_POLICIES,
    validatePositiveNumber,
    validateRequired
} from '@trading-tower/shared';
import { IExchangeConnector } from '@trading-tower/connectors';

export type ExitMode = 'CANCEL_ALL' | 'MARKET_SELL' | 'KEEP_ORDERS';

/**
 * Base bot strategy interface - core operations
 */
export interface IBaseBotStrategy {
    initialize(): Promise<void>;
    start(): Promise<void>;
    stop(exitMode?: ExitMode): Promise<void>;
    onPriceUpdate(price: number): Promise<void>;
    onOrderFilled(order: TradeOrder): Promise<void>;
}

/**
 * Interface for strategies that support pause/resume
 */
export interface IPausableStrategy {
    pause(): Promise<void>;
    resume(): Promise<void>;
}

/**
 * Interface for strategies that support runtime configuration changes
 */
export interface IConfigurableStrategy {
    modifyConfig(newConfig: any): Promise<void>;
}

/**
 * Full bot strategy interface combining all capabilities
 */
export interface IBotStrategy extends IBaseBotStrategy, IPausableStrategy, IConfigurableStrategy {}

/**
 * Abstract base class for all trading strategies
 * Provides common functionality: error handling, performance tracking, order management
 * @template T Strategy-specific configuration type
 */
export abstract class BaseStrategy<T = any> implements IBotStrategy {
    protected lastPrice: number = 0;
    protected isPaused: boolean = false;
    protected avgCostBasis: number = 0;

    constructor(
        protected bot: BotInstance,
        protected exchange: IExchangeConnector,
        protected config: T
    ) {
        if (!this.bot.performance) {
            this.bot.performance = this.getDefaultPerformance();
        }
    }

    /**
     * Get default performance metrics for new bots
     */
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
     * Stop the bot with specified exit mode
     * @param exitMode How to handle open positions/orders
     */
    async stop(exitMode: ExitMode = 'CANCEL_ALL'): Promise<void> {
        console.log(`[Bot ${this.bot.id}] Stopping with mode: ${exitMode}`);

        try {
            if (exitMode === 'CANCEL_ALL' || exitMode === 'MARKET_SELL') {
                await this.cancelAllActiveOrders();
            }

            if (exitMode === 'MARKET_SELL' && this.bot.performance.baseBalance > 0) {
                await this.marketSellRemainingBalance();
            }

            await this.updateBotStatus('stopped');
        } catch (error) {
            await this.handleStrategyError(error as Error, 'stop');
            throw error;
        }
    }

    /**
     * Market sell any remaining base asset balance
     */
    private async marketSellRemainingBalance(): Promise<void> {
        console.log(
            `[Bot ${this.bot.id}] Market selling remaining balance: ${this.bot.performance.baseBalance}`
        );
        
        try {
            const order = await this.executeOrderWithRetry({
                userId: this.bot.userId,
                botId: this.bot.id,
                pair: this.bot.pair,
                side: 'sell',
                type: 'market',
                amount: this.bot.performance.baseBalance
            });
            await this.recordTrade(order);
        } catch (error) {
            console.error(`[Bot ${this.bot.id}] Final market sell failed:`, error);
            throw new OrderExecutionError(
                'Failed to market sell remaining balance',
                undefined,
                false
            );
        }
    }

    /**
     * Pause bot execution
     */
    async pause(): Promise<void> {
        this.isPaused = true;
        await this.updateBotStatus('paused');
    }

    /**
     * Resume bot execution
     */
    async resume(): Promise<void> {
        this.isPaused = false;
        await this.updateBotStatus('running');
    }

    /**
     * Modify bot configuration at runtime
     * @param newConfig Partial configuration to merge
     */
    async modifyConfig(newConfig: any): Promise<void> {
        console.log(`[Bot ${this.bot.id}] Modifying configuration.`);
        validateRequired(newConfig, 'newConfig');

        try {
            this.config = { ...this.config, ...newConfig };
            this.bot.config = this.config;

            await this.initialize();

            await botRepository.update(this.bot.id, this.bot.userId, {
                config: this.config
            });
        } catch (error) {
            await this.handleStrategyError(error as Error, 'modifyConfig');
            throw error;
        }
    }

    /**
     * Increase investment amount
     * @param amount Amount to add to investment
     */
    async increaseInvestment(amount: number): Promise<void> {
        console.log(`[Bot ${this.bot.id}] Increasing investment by ${amount}.`);
        validatePositiveNumber(amount, 'investment amount');

        try {
            (this.config as any).investment += amount;
            this.bot.performance.initialInvestment += amount;
            this.bot.performance.quoteBalance += amount;

            await this.initialize();
            await botRepository.update(this.bot.id, this.bot.userId, {
                config: this.config,
                performance: this.bot.performance
            });
        } catch (error) {
            await this.handleStrategyError(error as Error, 'increaseInvestment');
            throw error;
        }
    }

    /**
     * Get active orders (to be implemented by subclasses)
     */
    protected abstract getActiveOrders(): Map<string, TradeOrder>;

    /**
     * Cancel all active orders with retry logic
     */
    protected async cancelAllActiveOrders(): Promise<void> {
        const orders = this.getActiveOrders();
        const cancelPromises: Promise<void>[] = [];

        for (const [id, order] of orders) {
            cancelPromises.push(
                this.cancelOrderWithRetry(id, order.pair).catch((error) => {
                    console.warn(
                        `[Bot ${this.bot.id}] Failed to cancel order ${id}:`,
                        error.message
                    );
                })
            );
        }

        await Promise.allSettled(cancelPromises);
        orders.clear();
    }

    /**
     * Cancel order with retry logic
     */
    protected async cancelOrderWithRetry(orderId: string, pair: string): Promise<void> {
        return withRetry(
            async () => {
                await this.exchange.cancelOrder(orderId, pair);
            },
            DEFAULT_RETRY_POLICIES.EXCHANGE_ERROR,
            `Cancel order ${orderId}`
        );
    }

    /**
     * Execute order with retry logic
     */
    protected async executeOrderWithRetry(orderParams: {
        userId: string;
        botId: string;
        pair: string;
        side: 'buy' | 'sell';
        type: 'market' | 'limit';
        amount: number;
        price?: number;
    }): Promise<TradeOrder> {
        return withRetry(
            async () => {
                return await this.exchange.createOrder(orderParams);
            },
            DEFAULT_RETRY_POLICIES.ORDER_EXECUTION_ERROR,
            `Execute ${orderParams.side} order`
        );
    }

    /**
     * Update performance metrics (extracted to base class)
     * @param currentPrice Current market price
     */
    protected updatePerformanceMetrics(currentPrice: number): void {
        const { performance } = this.bot;

        // Calculate unrealized PnL based on current holdings
        if (performance.baseBalance > 0 && this.avgCostBasis > 0) {
            performance.unrealizedPnL =
                (currentPrice - this.avgCostBasis) * performance.baseBalance;
        } else {
            performance.unrealizedPnL = 0;
        }

        // Calculate total PnL
        performance.totalPnL = performance.botProfit + performance.unrealizedPnL;
        performance.totalPnLPercent =
            (performance.totalPnL / (performance.initialInvestment || 1)) * 100;

        // Calculate annualized return
        performance.annualizedReturn = this.calculateAnnualizedReturn();

        // Update drawdown if necessary
        const currentValue = performance.initialInvestment + performance.totalPnL;
        const highWaterMark = performance.initialInvestment * (1 + Math.max(0, performance.totalPnLPercent / 100));
        const currentDrawdown = ((highWaterMark - currentValue) / highWaterMark) * 100;
        performance.drawdown = Math.max(performance.drawdown, currentDrawdown);
    }

    abstract onPriceUpdate(price: number): Promise<void>;
    abstract onOrderFilled(order: TradeOrder): Promise<void>;

    /**
     * Record trade execution and update performance
     */
    protected async recordTrade(order: TradeOrder): Promise<void> {
        console.log(
            `[Bot ${this.bot.id}] Trade completed: ${order.side.toUpperCase()} ` +
            `${order.amount} ${order.pair} @ ${order.price}`
        );

        try {
            await orderRepository.upsert(order);
            this.bot.performance.totalTrades += 1;

            await botRepository.update(this.bot.id, this.bot.userId, {
                performance: this.bot.performance,
                lastExecutionAt: new Date().toISOString(),
                status: this.bot.status
            });
        } catch (error) {
            console.error(
                `[Bot ${this.bot.id}] Failed to update performance in DB:`,
                error
            );
            throw error;
        }
    }

    /**
     * Update bot status in database
     */
    protected async updateBotStatus(status: BotInstance['status']): Promise<void> {
        this.bot.status = status;
        console.log(`[Bot ${this.bot.id}] Status changed to ${status}`);

        try {
            await botRepository.update(this.bot.id, this.bot.userId, { status });
        } catch (error) {
            console.error(`[Bot ${this.bot.id}] Failed to sync status to DB:`, error);
            throw error;
        }
    }

    /**
     * Calculate annualized return percentage
     */
    protected calculateAnnualizedReturn(): number {
        const startTime = new Date(this.bot.createdAt).getTime();
        const now = Date.now();
        const diffDays = (now - startTime) / (1000 * 60 * 60 * 24);

        if (diffDays < 0.01) return 0;

        const returnOnInvestment =
            this.bot.performance.totalPnL / (this.bot.performance.initialInvestment || 1);
        return (returnOnInvestment / diffDays) * 365 * 100;
    }

    /**
     * Centralized error handling for strategy operations
     * @param error The error that occurred
     * @param context Context/operation where error occurred
     */
    protected async handleStrategyError(error: Error, context: string): Promise<void> {
        console.error(`[Bot ${this.bot.id}] Error in ${context}:`, error);

        // Log error to repository (could be implemented)
        // await this.recordError(error, context);

        // Handle critical errors by stopping the bot
        if (error instanceof CriticalStrategyError) {
            console.error(
                `[Bot ${this.bot.id}] CRITICAL ERROR - Stopping bot:`,
                error.message
            );
            try {
                await this.stop('MARKET_SELL');
            } catch (stopError) {
                console.error(
                    `[Bot ${this.bot.id}] Failed to stop after critical error:`,
                    stopError
                );
            }
        }

        // Re-throw if it's a validation error (caller should handle)
        if (error instanceof ValidationError) {
            throw error;
        }
    }
}

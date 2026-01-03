import { BotInstance, ConfigurationError, validateRequired, TradeOrder } from '@trading-tower/shared';
import { ExchangeFactory, IExchangeConnector } from '@trading-tower/connectors';
import { IBotStrategy } from '../strategies/BaseStrategy';
import { StrategyFactoryRegistry, strategyFactoryRegistry } from '../factory/StrategyFactory';
import { ServiceBusSignalListener, SignalListenerConfig, ServiceBusSignalMessage } from './ServiceBusSignalListener';
import { IndicatorScheduler, CandleDataProvider } from './IndicatorScheduler';
import { ServiceBusSignalPublisher, PublisherConfig } from './ServiceBusSignalPublisher';
import { missedFillRecoveryService } from './MissedFillRecoveryService';
import { webSocketSubscriptionManager, WebSocketSubscriptionManager } from './WebSocketSubscriptionManager';

/**
 * Active bot tracking with strategy and exchange connector
 */
interface ActiveBot {
    strategy: IBotStrategy;
    exchange: IExchangeConnector;
    pair: string;
}

/**
 * Bot Manager
 * Manages lifecycle of active trading bots
 * Uses factory pattern for strategy creation
 */
export class BotManager {
    private activeBots: Map<string, ActiveBot> = new Map();
    private signalListener?: ServiceBusSignalListener;
    private signalPublisher?: ServiceBusSignalPublisher;
    private indicatorScheduler?: IndicatorScheduler;
    private subscriptionManager: WebSocketSubscriptionManager;

    /**
     * Creates a new BotManager instance
     * @param strategyRegistry Optional custom strategy registry (for dependency injection)
     * @param signalListenerConfig Optional Service Bus config for event-driven entry signals
     * @param publisherConfig Optional Service Bus config for publishing indicator signals
     * @param candleDataProvider Optional provider for loading candle data
     * @param subscriptionManager Optional WebSocket subscription manager (for dependency injection)
     */
    constructor(
        private strategyRegistry: StrategyFactoryRegistry = strategyFactoryRegistry,
        private signalListenerConfig?: SignalListenerConfig,
        private publisherConfig?: PublisherConfig,
        private candleDataProvider?: CandleDataProvider,
        subscriptionManager: WebSocketSubscriptionManager = webSocketSubscriptionManager
    ) {
        this.subscriptionManager = subscriptionManager;
        console.log('[BotManager] Initialized with strategy registry');
    }

    /**
     * Initialize Service Bus listener for event-driven entry signals
     * Call this after BotManager is created and before starting bots
     */
    public async initializeSignalListener(): Promise<void> {
        if (!this.signalListenerConfig) {
            console.warn('[BotManager] No Service Bus config provided. Signal-driven entry disabled.');
            return;
        }

        try {
            this.signalListener = new ServiceBusSignalListener(this.signalListenerConfig);

            // Register handlers for both signal sources
            this.signalListener.onSignal('TRADINGVIEW', (message) => this.handleTradeViewSignal(message));
            this.signalListener.onSignal('INDICATOR', (message) => this.handleIndicatorSignal(message));

            await this.signalListener.start();
            console.log('[BotManager] Service Bus signal listener started');
        } catch (error) {
            console.error('[BotManager] Failed to initialize signal listener:', error);
            throw error;
        }
    }

    /**
     * Initialize indicator scheduler for candle-close evaluations
     * Requires candleDataProvider to load price data
     */
    public async initializeIndicatorScheduler(): Promise<void> {
        if (!this.publisherConfig || !this.candleDataProvider) {
            console.warn('[BotManager] No publisher config or candle data provider. Indicator evaluation disabled.');
            return;
        }

        try {
            // Create signal publisher
            this.signalPublisher = new ServiceBusSignalPublisher(this.publisherConfig);
            await this.signalPublisher.connect();

            // Create indicator scheduler
            this.indicatorScheduler = new IndicatorScheduler(this.candleDataProvider, this.signalPublisher);
            await this.indicatorScheduler.start();

            console.log('[BotManager] Indicator scheduler started');
        } catch (error) {
            console.error('[BotManager] Failed to initialize indicator scheduler:', error);
            throw error;
        }
    }

    /**
     * Handle TradingView signal from Service Bus
     * Triggers entry on the bot if it's waiting for TRADINGVIEW signal
     */
    private async handleTradeViewSignal(message: ServiceBusSignalMessage): Promise<void> {
        try {
            const activeBot = this.activeBots.get(message.botId);
            if (!activeBot) {
                console.debug(`[BotManager] Received TV signal for inactive bot ${message.botId}, ignoring`);
                return;
            }

            // Call strategy's signal handler if available
            if ('onSignal' in activeBot.strategy && typeof (activeBot.strategy as any).onSignal === 'function') {
                await (activeBot.strategy as any).onSignal(message);
            } else {
                console.warn(`[BotManager] Strategy ${message.botId} doesn't support signal handling`);
            }
        } catch (error) {
            console.error(`[BotManager] Error handling TV signal for bot ${message.botId}:`, error);
        }
    }

    /**
     * Handle Indicator signal from Service Bus
     * Triggers entry on the bot if it's waiting for INDICATOR signal
     */
    private async handleIndicatorSignal(message: ServiceBusSignalMessage): Promise<void> {
        try {
            const activeBot = this.activeBots.get(message.botId);
            if (!activeBot) {
                console.debug(`[BotManager] Received indicator signal for inactive bot ${message.botId}, ignoring`);
                return;
            }

            // Call strategy's signal handler if available
            if ('onSignal' in activeBot.strategy && typeof (activeBot.strategy as any).onSignal === 'function') {
                await (activeBot.strategy as any).onSignal(message);
            } else {
                console.warn(`[BotManager] Strategy ${message.botId} doesn't support signal handling`);
            }
        } catch (error) {
            console.error(`[BotManager] Error handling indicator signal for bot ${message.botId}:`, error);
        }
    }

    /**
     * Stop Service Bus listener
     */
    public async stopSignalListener(): Promise<void> {
        if (this.signalListener) {
            await this.signalListener.stop();
            console.log('[BotManager] Service Bus signal listener stopped');
        }
    }

    /**
     * If bot is already running, stops it first and applies new configuration
     * 
     * @param bot Bot configuration
     * @param apiKeys Exchange API credentials
     * @throws {ConfigurationError} If strategy type is not supported
     * @throws {ValidationError} If required parameters are missing
     */
    public async startOrUpdateBot(
        bot: BotInstance,
        apiKeys: { apiKey: string; apiSecret: string }
    ): Promise<void> {
        validateRequired(bot, 'bot');
        validateRequired(bot.id, 'bot.id');
        validateRequired(bot.exchangeId, 'bot.exchangeId');
        validateRequired(bot.strategyType, 'bot.strategyType');
        validateRequired(apiKeys, 'apiKeys');
        validateRequired(apiKeys.apiKey, 'apiKeys.apiKey');
        validateRequired(apiKeys.apiSecret, 'apiKeys.apiSecret');

        // Check if strategy type is supported
        if (!this.strategyRegistry.isSupported(bot.strategyType)) {
            throw new ConfigurationError(
                `Unsupported strategy type: ${bot.strategyType}. ` +
                `Available: ${this.strategyRegistry.getSupportedTypes().join(', ')}`
            );
        }

        // If already running, stop it first to apply new config
        if (this.activeBots.has(bot.id)) {
            console.log(`[BotManager] Bot ${bot.id} is already running. Stopping for update.`);
            await this.stopBot(bot.id);
        }

        try {
            // Create exchange connector
            const exchange = ExchangeFactory.createConnector(bot.exchangeId as any, {
                apiKey: apiKeys.apiKey,
                apiSecret: apiKeys.apiSecret
            });

            // Create strategy using factory
            const strategy = this.strategyRegistry.createStrategy(bot, exchange);

            // Initialize and start strategy
            await strategy.initialize();
            await strategy.start();

            // Subscribe to WebSocket order fill events with recovery on reconnect
            const subscribed = await this.subscriptionManager.subscribeBot(
                bot.id,
                exchange,
                bot.pair,
                strategy
            );

            if (subscribed) {
                // Set up missed fill recovery on WebSocket reconnection
                strategy.onWebSocketConnected = async (exchangeName: string) => {
                    console.log(`[BotManager] Bot ${bot.id} WebSocket reconnected - checking for missed fills`);
                    await this.recoverMissedFills(bot.id, strategy, exchange, bot.pair);
                };
            }

            // Register active bot with exchange reference
            this.activeBots.set(bot.id, { strategy, exchange, pair: bot.pair });

            // Register for indicator evaluation if configured
            if (bot.config?.baseOrderCondition === 'INDICATOR' && bot.config?.entryIndicators && bot.config?.entryIndicators.length > 0 && this.indicatorScheduler) {
                this.indicatorScheduler.registerBot({
                    botId: bot.id,
                    pair: (bot.config as any).pair || '',
                    exchangeConnectorId: bot.exchangeId,
                    entryIndicators: bot.config.entryIndicators
                });
            }

            console.log(
                `[BotManager] Bot ${bot.id} (${bot.strategyType}) is now ACTIVE. ` +
                `Total active bots: ${this.activeBots.size}`
            );
        } catch (error) {
            console.error(`[BotManager] Failed to start bot ${bot.id}:`, error);
            throw error;
        }
    }

    /**
     * Stop a running bot
     * 
     * @param botId Bot identifier
     * @throws {Error} If bot is not found
     */
    public async stopBot(botId: string): Promise<void> {
        validateRequired(botId, 'botId');

        const activeBot = this.activeBots.get(botId);
        if (!activeBot) {
            console.warn(`[BotManager] Bot ${botId} is not running`);
            return;
        }

        try {
            // Unsubscribe from WebSocket order fills
            await this.subscriptionManager.unsubscribeBot(botId);

            await activeBot.strategy.stop();
            this.activeBots.delete(botId);

            // Unregister from indicator scheduler
            if (this.indicatorScheduler) {
                this.indicatorScheduler.unregisterBot(botId);
            }

            console.log(
                `[BotManager] Bot ${botId} is now STOPPED. ` +
                `Total active bots: ${this.activeBots.size}`
            );
        } catch (error) {
            console.error(`[BotManager] Failed to stop bot ${botId}:`, error);
            throw error;
        }
    }

    /**
     * Pause a running bot
     * 
     * @param botId Bot identifier
     */
    public async pauseBot(botId: string): Promise<void> {
        validateRequired(botId, 'botId');

        const activeBot = this.activeBots.get(botId);
        if (!activeBot) {
            throw new Error(`Bot ${botId} not found`);
        }

        await activeBot.strategy.pause();
        console.log(`[BotManager] Bot ${botId} paused`);
    }

    /**
     * Resume a paused bot
     * 
     * @param botId Bot identifier
     */
    public async resumeBot(botId: string): Promise<void> {
        validateRequired(botId, 'botId');

        const activeBot = this.activeBots.get(botId);
        if (!activeBot) {
            throw new Error(`Bot ${botId} not found`);
        }

        await activeBot.strategy.resume();
        console.log(`[BotManager] Bot ${botId} resumed`);
    }

    /**
     * Get a bot strategy instance
     * 
     * @param botId Bot identifier
     * @returns Bot strategy or undefined if not found
     */
    public getBot(botId: string): IBotStrategy | undefined {
        return this.activeBots.get(botId)?.strategy;
    }

    /**
     * Get all active bot IDs
     * 
     * @returns Array of active bot IDs
     */
    public getAllActiveBots(): string[] {
        return Array.from(this.activeBots.keys());
    }

    /**
     * Get number of active bots
     */
    public getActiveBotCount(): number {
        return this.activeBots.size;
    }

    /**
     * Check if a bot is active
     * 
     * @param botId Bot identifier
     */
    public isActive(botId: string): boolean {
        return this.activeBots.has(botId);
    }

    /**
     * Stop all active bots and signal listener
     * Useful for graceful shutdown
     */
    public async stopAllBots(): Promise<void> {
        console.log(`[BotManager] Stopping all ${this.activeBots.size} active bots...`);

        const stopPromises: Promise<void>[] = [];
        for (const botId of this.activeBots.keys()) {
            stopPromises.push(
                this.stopBot(botId).catch((error) => {
                    console.error(`[BotManager] Failed to stop bot ${botId}:`, error);
                })
            );
        }

        await Promise.allSettled(stopPromises);

        // Stop indicator scheduler
        if (this.indicatorScheduler) {
            await this.indicatorScheduler.stop();
        }

        // Stop signal publisher
        if (this.signalPublisher) {
            await this.signalPublisher.disconnect();
        }

        // Also stop signal listener
        await this.stopSignalListener();

        console.log('[BotManager] All bots stopped');
    }

    /**
     * Recover missed fills for a bot after WebSocket reconnection
     * @private
     */
    private async recoverMissedFills(
        botId: string,
        strategy: IBotStrategy,
        exchange: IExchangeConnector,
        pair: string
    ): Promise<void> {
        try {
            // Get active orders from strategy
            const activeOrders = this.getStrategyActiveOrders(strategy);
            if (activeOrders.size === 0) {
                console.log(`[BotManager] No active orders to recover for bot ${botId}`);
                return;
            }

            // Query exchange for missed fills
            const missedFills = await missedFillRecoveryService.recoverMissedFills(
                botId,
                exchange,
                activeOrders,
                pair
            );

            // Notify strategy of missed fills
            for (const order of missedFills) {
                if (order.status === 'filled' || order.filledAmount > 0) {
                    console.log(
                        `[BotManager] Replaying missed fill for bot ${botId}: ${order.id}`
                    );
                    await strategy.onOrderFilled(order);
                } else if (order.status === 'canceled') {
                    console.log(
                        `[BotManager] Replaying missed cancellation for bot ${botId}: ${order.id}`
                    );
                    await strategy.onOrderCancelled(order.id, pair);
                }
            }
        } catch (error) {
            console.error(
                `[BotManager] Failed to recover missed fills for bot ${botId}:`,
                error
            );
            // Non-fatal, strategy continues with current state
        }
    }

    /**
     * Extract active orders from strategy (if available)
     * @private
     */
    private getStrategyActiveOrders(strategy: IBotStrategy): Map<string, TradeOrder> {
        // Try to get active orders from strategy
        // Different strategies expose this differently, use duck typing
        const strategyWithOrders = strategy as any;
        
        if (typeof strategyWithOrders.getActiveOrders === 'function') {
            return strategyWithOrders.getActiveOrders();
        }
        
        // Fallback: return empty map if strategy doesn't expose active orders
        return new Map();
    }    /**
     * Get supported strategy types
     */
    public getSupportedStrategies(): string[] {
        return this.strategyRegistry.getSupportedTypes();
    }

    /**
     * Get WebSocket subscription health metrics
     */
    public getSubscriptionHealth(): {
        totalSubscriptions: number;
        subscriptionsByExchange: Map<string, number>;
    } {
        return this.subscriptionManager.getSubscriptionHealth();
    }
}

/**
 * Default bot manager instance
 */
export const botManager = new BotManager();

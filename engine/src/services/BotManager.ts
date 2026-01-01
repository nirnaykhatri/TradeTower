import { BotInstance, ConfigurationError, validateRequired } from '@trading-tower/shared';
import { ExchangeFactory } from '@trading-tower/connectors';
import { IBotStrategy } from '../strategies/BaseStrategy';
import { StrategyFactoryRegistry, strategyFactoryRegistry } from '../factory/StrategyFactory';

/**
 * Bot Manager
 * Manages lifecycle of active trading bots
 * Uses factory pattern for strategy creation
 */
export class BotManager {
    private activeBots: Map<string, IBotStrategy> = new Map();

    /**
     * Creates a new BotManager instance
     * @param strategyRegistry Optional custom strategy registry (for dependency injection)
     */
    constructor(
        private strategyRegistry: StrategyFactoryRegistry = strategyFactoryRegistry
    ) {
        console.log('[BotManager] Initialized with strategy registry');
    }

    /**
     * Start or update a bot instance
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

            // Register active bot
            this.activeBots.set(bot.id, strategy);

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

        const strategy = this.activeBots.get(botId);
        if (!strategy) {
            console.warn(`[BotManager] Bot ${botId} is not running`);
            return;
        }

        try {
            await strategy.stop();
            this.activeBots.delete(botId);
            console.log(
                `[BotManager] Bot ${botId} stopped and removed. ` +
                `Remaining active bots: ${this.activeBots.size}`
            );
        } catch (error) {
            console.error(`[BotManager] Error stopping bot ${botId}:`, error);
            // Remove from active bots even if stop fails
            this.activeBots.delete(botId);
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

        const strategy = this.activeBots.get(botId);
        if (!strategy) {
            throw new Error(`Bot ${botId} not found`);
        }

        await strategy.pause();
        console.log(`[BotManager] Bot ${botId} paused`);
    }

    /**
     * Resume a paused bot
     * 
     * @param botId Bot identifier
     */
    public async resumeBot(botId: string): Promise<void> {
        validateRequired(botId, 'botId');

        const strategy = this.activeBots.get(botId);
        if (!strategy) {
            throw new Error(`Bot ${botId} not found`);
        }

        await strategy.resume();
        console.log(`[BotManager] Bot ${botId} resumed`);
    }

    /**
     * Get a bot strategy instance
     * 
     * @param botId Bot identifier
     * @returns Bot strategy or undefined if not found
     */
    public getBot(botId: string): IBotStrategy | undefined {
        return this.activeBots.get(botId);
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
     * Stop all active bots
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
        console.log('[BotManager] All bots stopped');
    }

    /**
     * Get supported strategy types
     */
    public getSupportedStrategies(): string[] {
        return this.strategyRegistry.getSupportedTypes();
    }
}

/**
 * Default bot manager instance
 */
export const botManager = new BotManager();

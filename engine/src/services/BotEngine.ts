import { botManager } from './BotManager';
import { BotInstance } from '@trading-tower/shared';

/**
 * Bot Engine
 * 
 * Central command processor for bot operations.
 * Receives commands from external sources (API, Webhooks, etc.)
 * and delegates execution to the BotManager.
 * 
 * This acts as a facade/entry point for bot lifecycle management.
 */
export class BotEngine {
    constructor() {
        console.log('[BotEngine] Initialized.');
    }

    /**
     * Handle incoming bot command
     * 
     * @param command Command object containing action and bot configuration
     * @param command.action The action to perform: 'start', 'stop', or 'update'
     * @param command.bot Bot instance configuration
     * @param command.keys Optional API keys for exchange authentication
     * 
     * @throws {Error} If command action is invalid
     * @throws {ConfigurationError} If bot configuration is invalid
     * 
     * @example
     * ```typescript
     * await botEngine.handleCommand({
     *   action: 'start',
     *   bot: myBotConfig,
     *   keys: { apiKey: '...', apiSecret: '...' }
     * });
     * ```
     */
    public async handleCommand(command: {
        action: 'start' | 'stop' | 'update' | 'pause' | 'resume';
        bot: BotInstance;
        keys?: { apiKey: string; apiSecret: string };
    }): Promise<void> {
        console.log(
            `[BotEngine] Received command: ${command.action.toUpperCase()} for Bot: ${command.bot.id}`
        );

        switch (command.action) {
            case 'start':
            case 'update':
                if (!command.keys) {
                    throw new Error('API keys required for start/update operations');
                }
                await botManager.startOrUpdateBot(command.bot, command.keys);
                break;

            case 'stop':
                await botManager.stopBot(command.bot.id);
                break;

            case 'pause':
                await botManager.pauseBot(command.bot.id);
                break;

            case 'resume':
                await botManager.resumeBot(command.bot.id);
                break;

            default:
                throw new Error(`Unknown command action: ${(command as any).action}`);
        }
    }

    /**
     * Simulate a price update for testing purposes
     * 
     * @param botId Bot identifier
     * @param price New market price
     * 
     * @remarks
     * This method is primarily for testing and should not be used in production.
     * In production, price updates come from exchange websockets or polling.
     */
    public async simulatePriceUpdate(botId: string, price: number): Promise<void> {
        const strategy = botManager.getBot(botId);
        if (!strategy) {
            throw new Error(`Bot ${botId} not found or not running`);
        }
        await strategy.onPriceUpdate(price);
    }

    /**
     * Get information about active bots
     * 
     * @returns Array of active bot IDs
     */
    public getActiveBots(): string[] {
        return botManager.getAllActiveBots();
    }

    /**
     * Check if a specific bot is active
     * 
     * @param botId Bot identifier
     */
    public isBotActive(botId: string): boolean {
        return botManager.isActive(botId);
    }

    /**
     * Gracefully shutdown engine and all active bots
     * 
     * @remarks
     * Should be called during application shutdown to ensure
     * all bots are stopped cleanly and resources are released.
     */
    public async shutdown(): Promise<void> {
        console.log('[BotEngine] Initiating shutdown...');
        await botManager.stopAllBots();
        console.log('[BotEngine] Shutdown complete.');
    }
}

/**
 * Default bot engine instance
 */
export const botEngine = new BotEngine();

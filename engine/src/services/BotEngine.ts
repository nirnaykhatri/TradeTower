import { botManager } from './BotManager';
import { BotInstance } from '@trading-tower/shared';

/**
 * BotEngine is responsible for receiving commands from the outside world
 * (API, Webhooks, etc.) and delegating to the BotManager.
 */
export class BotEngine {
    constructor() {
        console.log('[BotEngine] Initialized.');
    }

    public async handleCommand(command: { action: 'start' | 'stop' | 'update', bot: BotInstance, keys?: any }) {
        console.log(`[BotEngine] Received command: ${command.action.toUpperCase()} for Bot: ${command.bot.id}`);

        switch (command.action) {
            case 'start':
                await botManager.startOrUpdateBot(command.bot, command.keys);
                break;
            case 'stop':
                await botManager.stopBot(command.bot.id);
                break;
            case 'update':
                await botManager.startOrUpdateBot(command.bot, command.keys);
                break;
        }
    }

    /**
     * Simulation method for testing
     */
    public async simulatePriceUpdate(botId: string, price: number) {
        const strategy = botManager.getBot(botId);
        if (strategy) {
            await strategy.onPriceUpdate(price);
        }
    }
}

export const botEngine = new BotEngine();

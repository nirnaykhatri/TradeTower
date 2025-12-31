import { logger } from '../logger';
import { BotInstance } from '@trading-tower/shared';

/**
 * Service to handle communication with the Bot Execution Engine.
 * In a production environment, this would send messages via Azure Service Bus or Event Grid.
 */
export class BotEngineService {
    private static instance: BotEngineService;

    private constructor() { }

    public static getInstance(): BotEngineService {
        if (!BotEngineService.instance) {
            BotEngineService.instance = new BotEngineService();
        }
        return BotEngineService.instance;
    }

    /**
     * Notify the Bot Engine that a bot's state has changed (start/stop/update).
     */
    public async syncBotState(bot: BotInstance, action: 'start' | 'stop' | 'update'): Promise<void> {
        logger.info(`[BotEngineSync] Action: ${action.toUpperCase()}, BotID: ${bot.id}, Status: ${bot.status}`);

        // TODO: Implement actual messaging logic (e.g., Service Bus)
        // const message = { botId: bot.id, userId: bot.userId, action, config: bot.config };
        // await this.serviceBusClient.send(message);

        return Promise.resolve();
    }
}

export const botEngineService = BotEngineService.getInstance();

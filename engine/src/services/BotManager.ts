import { BotInstance } from '@trading-tower/shared';
import { ExchangeFactory } from '@trading-tower/connectors';
import { IBotStrategy } from '../strategies/BaseStrategy';
import { GridStrategy } from '../strategies/GridStrategy';
import { DCAStrategy } from '../strategies/DCAStrategy';
import { BTDStrategy } from '../strategies/BTDStrategy';
import { ComboStrategy } from '../strategies/ComboStrategy';
import { LoopStrategy } from '../strategies/LoopStrategy';
import { DCAFuturesStrategy } from '../strategies/DCAFuturesStrategy';
import { FuturesGridStrategy } from '../strategies/FuturesGridStrategy';
import { TWAPStrategy } from '../strategies/TWAPStrategy';

export class BotManager {
    private activeBots: Map<string, IBotStrategy> = new Map();

    /**
     * Starts a new bot instance or replaces an existing one (Update).
     */
    public async startOrUpdateBot(bot: BotInstance, apiKeys: { apiKey: string, apiSecret: string }): Promise<void> {
        // If already running, stop it first to apply new config
        if (this.activeBots.has(bot.id)) {
            console.log(`[BotManager] Bot ${bot.id} is already running. Stopping for update.`);
            await this.stopBot(bot.id);
        }

        const exchange = ExchangeFactory.createConnector(bot.exchangeId as any, {
            apiKey: apiKeys.apiKey,
            apiSecret: apiKeys.apiSecret
        });

        const strategy = this.createStrategy(bot, exchange);
        if (!strategy) {
            throw new Error(`Unsupported strategy type: ${bot.strategyType}`);
        }

        await strategy.initialize();
        await strategy.start();
        this.activeBots.set(bot.id, strategy);

        console.log(`[BotManager] Bot ${bot.id} (${bot.strategyType}) is now ACTIVE.`);
    }

    private createStrategy(bot: BotInstance, exchange: any): IBotStrategy | null {
        switch (bot.strategyType) {
            case 'GRID': return new GridStrategy(bot, exchange, bot.config);
            case 'DCA': return new DCAStrategy(bot, exchange, bot.config);
            case 'BTD': return new BTDStrategy(bot, exchange, bot.config);
            case 'COMBO': return new ComboStrategy(bot, exchange, bot.config);
            case 'LOOP': return new LoopStrategy(bot, exchange, bot.config);
            case 'DCA_FUTURES': return new DCAFuturesStrategy(bot, exchange, bot.config);
            case 'FUTURES_GRID': return new FuturesGridStrategy(bot, exchange, bot.config);
            case 'TWAP': return new TWAPStrategy(bot, exchange, bot.config);
            default: return null;
        }
    }

    public async stopBot(botId: string): Promise<void> {
        const strategy = this.activeBots.get(botId);
        if (strategy) {
            await strategy.stop();
            this.activeBots.delete(botId);
            console.log(`[BotManager] Bot ${botId} stopped and removed.`);
        }
    }

    public getBot(botId: string): IBotStrategy | undefined {
        return this.activeBots.get(botId);
    }

    public getAllActiveBots(): string[] {
        return Array.from(this.activeBots.keys());
    }
}

export const botManager = new BotManager();

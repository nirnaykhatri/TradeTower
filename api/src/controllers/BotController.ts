import { Request, Response, NextFunction } from 'express';
import { botRepository } from '../services/db/BotRepository';
import { BotInstance } from '@trading-tower/shared';
import { AppError } from '../utils/error';
import { logger } from '../services/logger';
import { z } from 'zod';
import { randomUUID, randomBytes } from 'crypto';

import { botEngineService } from '../services/bot/BotEngineService';

const IndicatorConfigSchema = z.discriminatedUnion('indicator', [
    z.object({
        indicator: z.literal('RSI'),
        period: z.number().int().default(14),
        oversold: z.number().default(30),
        overbought: z.number().default(70)
    }),
    z.object({
        indicator: z.literal('MACD'),
        fastPeriod: z.number().int().default(12),
        slowPeriod: z.number().int().default(26),
        signalPeriod: z.number().int().default(9)
    }),
    z.object({
        indicator: z.literal('Stochastic'),
        period: z.number().int().default(14),
        signalPeriod: z.number().int().default(3),
        oversold: z.number().default(20),
        overbought: z.number().default(80)
    }),
    z.object({
        indicator: z.literal('TradingView'),
        secret: z.string().optional()
    })
]);

const IndicatorConditionSchema = z.object({
    indicator: z.enum(['MACD', 'RSI', 'Stochastic', 'TradingView']),
    timeframe: z.enum(['1m', '5m', '15m', '30m', '1h', '4h', '1d']).default('15m'),
    config: z.any().optional(),
    signal: z.enum(['BUY', 'SELL', 'STRONG_BUY', 'STRONG_SELL']).optional()
}).refine(data => {
    // Validate config against the specific indicator schema
    if (data.config) {
        return IndicatorConfigSchema.safeParse({ indicator: data.indicator, ...data.config }).success;
    }
    return true;
}, { message: "Invalid configuration for the selected indicator" });

const BaseConfig = z.object({
    stopLoss: z.number().min(0).max(100).optional(),
    stopLossEnabled: z.boolean().default(false),
    takeProfit: z.number().min(0).max(1000).optional(),
    takeProfitEnabled: z.boolean().default(false),
    startConditions: z.array(IndicatorConditionSchema).optional(),
});

const GridConfigSchema = BaseConfig.extend({
    lowPrice: z.number().positive(),
    highPrice: z.number().positive(),
    highPriceTrailing: z.boolean().default(false),
    gridStep: z.number().min(0.1).max(100),
    gridLevels: z.number().int().min(5).max(100),
    orderSizeCurrency: z.enum(['BASE', 'QUOTE']),
    trailingUp: z.boolean().default(true),
    pumpProtection: z.boolean().default(true),
    trailingDown: z.boolean().default(false),
}).refine(data => data.highPrice > data.lowPrice, { message: "highPrice must be > lowPrice" });

const DCAConfigSchema = BaseConfig.extend({
    strategy: z.enum(['LONG', 'SHORT']),
    investment: z.number().positive(),
    baseOrderAmount: z.number().positive(),
    baseOrderCondition: z.enum(['IMMEDIATELY', 'PRICE_CHANGE', 'MANUAL']),
    baseOrderType: z.enum(['LIMIT', 'MARKET']),
    averagingOrdersAmount: z.number().positive(),
    averagingOrdersQuantity: z.number().int().min(0).max(100),
    averagingOrdersStep: z.number().min(0.1).max(50),
    activeOrdersLimit: z.number().int().min(1).max(100).optional(),
    activeOrdersLimitEnabled: z.boolean().default(false),
    amountMultiplier: z.number().min(1).max(2).default(1),
    stepMultiplier: z.number().min(1).max(2).default(1),
});

const BTDConfigBaseSchema = BaseConfig.extend({
    lowPrice: z.number().positive(),
    lowPriceTrailing: z.boolean().default(true),
    highPrice: z.number().positive(),
    gridStep: z.number().min(0.1).max(100),
    gridLevels: z.number().int().min(5).max(100),
    levelsDown: z.number().int().min(1),
    levelsUp: z.number().int().min(1),
    levelsDistribution: z.number().min(0).max(100),
    trailing: z.boolean().default(true),
});

const BTDConfigSchema = BTDConfigBaseSchema.refine(data => data.highPrice > data.lowPrice, { message: "highPrice must be > lowPrice" });

const ComboConfigSchema = BTDConfigBaseSchema.extend({
    positionSizeLimit: z.number().positive().optional(),
    reuseCompletedOrders: z.boolean().default(true),
    dynamicRebalancing: z.boolean().default(false),
}).refine(data => data.highPrice > data.lowPrice, { message: "highPrice must be > lowPrice" });

const LoopConfigSchema = z.object({
    lowPrice: z.number().positive(),
    highPrice: z.number().positive(),
    orderDistance: z.number().min(0.1).max(50),
    orderCount: z.number().int().min(1).max(100),
    takeProfit: z.number().min(0.1).max(100).optional(),
    takeProfitEnabled: z.boolean().default(false),
}).refine(data => data.highPrice > data.lowPrice, { message: "highPrice must be > lowPrice" });

const DCAFuturesConfigSchema = DCAConfigSchema.extend({
    exchange: z.string(), // Must be futures exchange
    initialMargin: z.number().positive(),
    leverage: z.number().min(1).max(125),
    marginType: z.enum(['CROSS', 'ISOLATED']),
    liquidationBuffer: z.number().min(5).max(50).optional(),
});

// 7. Futures Grid
const FuturesGridConfigSchema = BaseConfig.extend({
    lowPrice: z.number().positive(),
    highPrice: z.number().positive(),
    highPriceTrailing: z.boolean().default(false),
    gridStep: z.number().min(0.1).max(100),
    gridLevels: z.number().int().min(5).max(100),
    orderSizeCurrency: z.enum(['BASE', 'QUOTE']),
    trailingUp: z.boolean().default(true),
    pumpProtection: z.boolean().default(true),
    trailingDown: z.boolean().default(false),
    strategyType: z.enum(['LONG', 'SHORT', 'NEUTRAL']),
    marginType: z.enum(['CROSS', 'ISOLATED']),
    leverage: z.number().min(1).max(100),
    gridQuantity: z.number().int().min(2).max(200),
    gridMode: z.enum(['ARITHMETIC', 'GEOMETRIC']),
    triggerPrice: z.number().positive().optional(),
    closePositionOnStop: z.boolean().default(true),
}).refine(data => data.highPrice > data.lowPrice, { message: "highPrice must be > lowPrice" });

// 8. TWAP
const TWAPConfigSchema = z.object({
    direction: z.enum(['BUY', 'SELL']),
    totalAmount: z.number().positive(),
    duration: z.number().int().min(5).max(1440),
    frequency: z.number().int().min(5).max(60),
    marginType: z.enum(['CROSS', 'ISOLATED']),
    leverage: z.number().min(1).max(100),
    reduceOnly: z.boolean().default(false),
    priceLimit: z.number().positive().optional(),
});

/**
 * Combined Schema
 */
const botSchema = z.object({
    name: z.string().min(3).max(50),
    exchangeId: z.string().min(1),
    pair: z.string().min(3),
    strategyType: z.enum(['GRID', 'DCA', 'BTD', 'COMBO', 'LOOP', 'DCA_FUTURES', 'FUTURES_GRID', 'TWAP']),
    triggerType: z.enum(['manual', 'webhook', 'indicator']).default('manual'),
    config: z.any()
}).refine(data => {
    // Manual refinement for the config based on strategyType
    const { strategyType, config } = data;
    switch (strategyType) {
        case 'GRID': return GridConfigSchema.safeParse(config).success;
        case 'DCA': return DCAConfigSchema.safeParse(config).success;
        case 'BTD': return BTDConfigSchema.safeParse(config).success;
        case 'COMBO': return ComboConfigSchema.safeParse(config).success;
        case 'LOOP': return LoopConfigSchema.safeParse(config).success;
        case 'DCA_FUTURES': return DCAFuturesConfigSchema.safeParse(config).success;
        case 'FUTURES_GRID': return FuturesGridConfigSchema.safeParse(config).success;
        case 'TWAP': return TWAPConfigSchema.safeParse(config).success;
        default: return false;
    }
}, { message: "Invalid configuration for the selected strategy type" });

const updateBotSchema = z.object({
    name: z.string().min(3).max(50).optional(),
    exchangeId: z.string().min(1).optional(),
    pair: z.string().min(3).optional(),
    strategyType: z.enum(['GRID', 'DCA', 'BTD', 'COMBO', 'LOOP', 'DCA_FUTURES', 'FUTURES_GRID', 'TWAP']).optional(),
    triggerType: z.enum(['manual', 'webhook', 'indicator']).optional(),
    config: z.any().optional()
});

export class BotController {
    /**
     * Create a new bot instance
     */
    public async createBot(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user.userId;
            const validatedData = botSchema.parse(req.body);

            const newBot: BotInstance = {
                id: randomUUID(),
                userId,
                ...validatedData,
                status: 'stopped',
                totalPnL: 0,
                totalTrades: 0,
                winRate: 0,
                webhookSecret: validatedData.triggerType === 'webhook' ? randomBytes(24).toString('hex') : undefined,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            } as unknown as BotInstance;

            const createdBot = await botRepository.upsert(newBot);
            logger.info(`Bot created: ${createdBot.id} for user ${userId}`);

            res.status(201).json({
                status: 'success',
                data: { bot: createdBot }
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Get all bots for the current user
     */
    public async getBots(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user.userId;
            const bots = await botRepository.getAllByUserId(userId);

            res.status(200).json({
                status: 'success',
                results: bots.length,
                data: { bots }
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Get a specific bot by ID
     */
    public async getBotById(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user.userId;
            const { id } = req.params;

            const bot = await botRepository.getById(id, userId);
            if (!bot) {
                throw new AppError(404, 'Bot not found');
            }

            res.status(200).json({
                status: 'success',
                data: { bot }
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Update a bot configuration
     */
    public async updateBot(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user.userId;
            const { id } = req.params;

            // For updates, we parse partially but still validate the config if provided
            const validatedData = updateBotSchema.parse(req.body);

            const existingBot = await botRepository.getById(id, userId);
            if (!existingBot) {
                throw new AppError(404, 'Bot not found');
            }

            const updatedBot: BotInstance = {
                ...existingBot,
                ...(validatedData as any),
                updatedAt: new Date().toISOString()
            };

            const result = await botRepository.upsert(updatedBot);

            // Sync with engine
            await botEngineService.syncBotState(result, 'update');
            logger.info(`Bot updated: ${id} for user ${userId}`);

            res.status(200).json({
                status: 'success',
                data: { bot: result }
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Delete a bot
     */
    public async deleteBot(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user.userId;
            const { id } = req.params;

            const existingBot = await botRepository.getById(id, userId);
            if (!existingBot) {
                throw new AppError(404, 'Bot not found');
            }

            if (existingBot.status === 'running') {
                throw new AppError(400, 'Cannot delete a running bot. Please stop it first.');
            }

            await botRepository.delete(id, userId);
            logger.info(`Bot deleted: ${id} for user ${userId}`);

            res.status(204).json({
                status: 'success',
                data: null
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Toggle bot status (start/stop)
     */
    public async toggleBot(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user.userId;
            const { id } = req.params;
            const { action } = req.body;

            if (!['start', 'stop'].includes(action)) {
                throw new AppError(400, 'Invalid action. Use "start" or "stop".');
            }

            const bot = await botRepository.getById(id, userId);
            if (!bot) {
                throw new AppError(404, 'Bot not found');
            }

            const newStatus = action === 'start' ? 'running' : 'stopped';

            if (bot.status === newStatus) {
                throw new AppError(400, `Bot is already ${newStatus}`);
            }

            const updatedBot: BotInstance = {
                ...bot,
                status: newStatus,
                updatedAt: new Date().toISOString()
            };

            // 1. Persist State
            const savedBot = await botRepository.upsert(updatedBot);

            // 2. Sync with Engine (P0/High)
            await botEngineService.syncBotState(savedBot, action);

            logger.info(`Bot ${id} status changed to ${newStatus} by user ${userId}`);

            res.status(200).json({
                status: 'success',
                message: `Bot ${action === 'start' ? 'started' : 'stopped'} successfully`,
                data: { bot: savedBot }
            });
        } catch (error) {
            next(error);
        }
    }
}


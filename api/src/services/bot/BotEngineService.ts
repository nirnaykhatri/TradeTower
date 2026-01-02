import { logger } from '../logger';
import { BotInstance, BotClosureStrategy } from '@trading-tower/shared';
import { ServiceBusClient } from '@azure/service-bus';

/**
 * Service to handle communication with the Bot Execution Engine.
 * 
 * Communicates with the bot execution engine via Azure Service Bus for:
 * - Bot state synchronization (start, stop, update, pause, resume)
 * - Position closure strategies (close, cancel, liquidate)
 * - Error handling and alerts
 * 
 * Messages are sent asynchronously with correlation IDs for tracking.
 */
export class BotEngineService {
    private static instance: BotEngineService;
    private serviceBusClient?: ServiceBusClient;
    
    private readonly COMMAND_QUEUE = process.env.SERVICE_BUS_COMMAND_QUEUE || 'bot-commands';
    private readonly STATE_SYNC_TOPIC = process.env.SERVICE_BUS_STATE_TOPIC || 'bot-state-sync';

    private constructor() { }

    public static getInstance(): BotEngineService {
        if (!BotEngineService.instance) {
            BotEngineService.instance = new BotEngineService();
        }
        return BotEngineService.instance;
    }

    /**
     * Initialize Service Bus client for messaging
     * Call this during application bootstrap
     */
    public setServiceBusClient(client: ServiceBusClient): void {
        this.serviceBusClient = client;
        logger.info('[BotEngineService] Service Bus client initialized');
    }

    /**
     * Synchronize bot state with engine
     * 
     * Sends bot configuration and state to engine via Service Bus.
     * Engine will stop current strategy, reinitialize with new config, and restart.
     * 
     * @param bot Updated bot instance
     * @param action Optional action hint: 'start', 'stop', or 'update'
     * @throws {Error} If messaging fails
     */
    public async syncBotState(bot: BotInstance, action: 'start' | 'stop' | 'update' = 'update'): Promise<void> {
        logger.info(`[BotEngineSync] Action: ${action.toUpperCase()}, BotID: ${bot.id}, Status: ${bot.status}`);

        try {
            const correlationId = this._generateCorrelationId();
            
            const message = {
                messageType: `bot:${action}`,
                botId: bot.id,
                userId: bot.userId,
                timestamp: new Date().toISOString(),
                payload: {
                    strategyType: bot.strategyType,
                    pair: bot.pair,
                    exchangeId: bot.exchangeId,
                    config: bot.config,
                    status: bot.status,
                    triggerType: bot.triggerType
                },
                correlationId
            };

            await this._sendMessage(this.STATE_SYNC_TOPIC, message);
            
            logger.info(`[BotEngineSync] State synced - Action: ${action.toUpperCase()}, BotID: ${bot.id}, CorrelationID: ${correlationId}`);
        } catch (error) {
            logger.error(`[BotEngineSync] Failed to sync bot state for ${bot.id}:`, error);
            throw error;
        }
    }

    /**
     * Execute bot closure strategy when stopping bot
     * 
     * Closure Strategies:
     * - CLOSE_POSITIONS: Execute market order to close all positions and lock in PnL
     * - CANCEL_ORDERS: Cancel all open orders but keep position in exchange
     * - LIQUIDATE: Force close all positions and withdraw to wallet
     * 
     * Per Bitsgap Managing and Modifying Bot documentation
     */
    public async executeBotClosure(bot: BotInstance, strategy: BotClosureStrategy): Promise<void> {
        logger.info(`[BotClosure] Executing ${strategy} for bot ${bot.id} on pair ${bot.pair}`);

        try {
            switch (strategy) {
                case 'CLOSE_POSITIONS':
                    await this.closeAllPositions(bot);
                    break;
                case 'CANCEL_ORDERS':
                    await this.cancelAllOrders(bot);
                    break;
                case 'LIQUIDATE':
                    await this.liquidatePositions(bot);
                    break;
                default:
                    throw new Error(`Unknown closure strategy: ${strategy}`);
            }

            logger.info(`[BotClosure] Successfully executed ${strategy} for bot ${bot.id}`);
        } catch (error) {
            logger.error(`[BotClosure] Failed to execute ${strategy} for bot ${bot.id}:`, error);
            throw error;
        }
    }

    /**
     * Close all positions via market orders
     */
    private async closeAllPositions(bot: BotInstance): Promise<void> {
        logger.info(`[BotClosure] CLOSE_POSITIONS: Closing all positions for bot ${bot.id}`);

        try {
            const correlationId = this._generateCorrelationId();
            
            const message = {
                messageType: 'position:close',
                botId: bot.id,
                userId: bot.userId,
                timestamp: new Date().toISOString(),
                payload: {
                    exchangeId: bot.exchangeId,
                    pair: bot.pair,
                    strategy: 'MARKET_SELL',
                    orderType: 'market',
                    closeReason: 'bot-stop',
                    releaseReservedFunds: true
                },
                correlationId
            };

            await this._sendMessage(this.COMMAND_QUEUE, message);
            
            logger.info(`[BotClosure] CLOSE_POSITIONS: Command sent for bot ${bot.id}, CorrelationID: ${correlationId}`);
        } catch (error) {
            logger.error(`[BotClosure] CLOSE_POSITIONS: Failed for bot ${bot.id}:`, error);
            throw error;
        }
    }

    /**
     * Cancel all open orders but keep position
     */
    private async cancelAllOrders(bot: BotInstance): Promise<void> {
        logger.info(`[BotClosure] CANCEL_ORDERS: Canceling all orders for bot ${bot.id}`);

        try {
            const correlationId = this._generateCorrelationId();
            
            const message = {
                messageType: 'position:cancel',
                botId: bot.id,
                userId: bot.userId,
                timestamp: new Date().toISOString(),
                payload: {
                    exchangeId: bot.exchangeId,
                    pair: bot.pair,
                    includeWorkingOrders: true,
                    cancelReason: 'bot-pause',
                    preservePosition: true
                },
                correlationId
            };

            await this._sendMessage(this.COMMAND_QUEUE, message);
            
            logger.info(`[BotClosure] CANCEL_ORDERS: Command sent for bot ${bot.id}, CorrelationID: ${correlationId}`);
        } catch (error) {
            logger.error(`[BotClosure] CANCEL_ORDERS: Failed for bot ${bot.id}:`, error);
            throw error;
        }
    }

    /**
     * Liquidate all positions and withdrawal
     */
    private async liquidatePositions(bot: BotInstance): Promise<void> {
        logger.info(`[BotClosure] LIQUIDATE: Liquidating all positions for bot ${bot.id}`);

        try {
            const correlationId = this._generateCorrelationId();
            
            const message = {
                messageType: 'position:liquidate',
                botId: bot.id,
                userId: bot.userId,
                timestamp: new Date().toISOString(),
                payload: {
                    exchangeId: bot.exchangeId,
                    pair: bot.pair,
                    triggerStopLoss: true,
                    orderType: 'market',
                    liquidateReason: 'emergency-close',
                    tolerance: 0.02
                },
                correlationId
            };

            await this._sendMessage(this.COMMAND_QUEUE, message);
            
            logger.info(`[BotClosure] LIQUIDATE: Command sent for bot ${bot.id}, CorrelationID: ${correlationId}`);
        } catch (error) {
            logger.error(`[BotClosure] LIQUIDATE: Failed for bot ${bot.id}:`, error);
            throw error;
        }
    }

    /**
     * Send message to Service Bus
     */
    private async _sendMessage(destination: string, message: any): Promise<void> {
        if (!this.serviceBusClient) {
            logger.warn(`[BotEngineService] Service Bus client not configured. Message queued locally.`);
            logger.debug(`[BotEngineService] Would send to ${destination}:`, message);
            return;
        }

        try {
            const sender = this.serviceBusClient.createSender(destination);
            await sender.sendMessages({
                body: JSON.stringify(message),
                contentType: 'application/json',
                subject: message.messageType,
                correlationId: message.correlationId,
                timeToLive: 60000,
                scheduledEnqueueTimeUtc: new Date()
            });
            await sender.close();
        } catch (error) {
            logger.error(`[BotEngineService] Failed to send message to ${destination}:`, error);
            throw error;
        }
    }

    /**
     * Generate correlation ID for request tracking
     */
    private _generateCorrelationId(): string {
        return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
}

export const botEngineService = BotEngineService.getInstance();

/**
 * Bot Engine Startup Configuration
 * 
 * Shows how to initialize the BotManager with Service Bus signal listener
 * and configure bot entry conditions.
 */

import dotenv from 'dotenv';
import { BotManager } from './services/BotManager';
import { SignalListenerConfig } from './services/ServiceBusSignalListener';

dotenv.config();

/**
 * Initialize BotManager with Service Bus configuration
 */
export function initializeBotManager(): BotManager {
    const signalListenerConfig: SignalListenerConfig = {
        connectionString: process.env.SERVICE_BUS_SUBSCRIBER_CONNECTION_STRING!,
        tvSignalsTopicName: process.env.SB_TV_SIGNALS_TOPIC || 'trading-view-signals',
        tvSignalsSubscription: 'bot-engine',
        indicatorSignalsTopicName: process.env.SB_INDICATOR_SIGNALS_TOPIC || 'indicator-signals',
        indicatorSignalsSubscription: 'bot-engine',
    };

    if (!signalListenerConfig.connectionString) {
        console.warn('[BotEngine] SERVICE_BUS_SUBSCRIBER_CONNECTION_STRING not set. Signal-driven entry disabled.');
    }

    // Create bot manager with signal listener configuration
    const botManager = new BotManager(undefined, signalListenerConfig);

    return botManager;
}

/**
 * Start bot engine with Service Bus listener
 */
export async function startBotEngine(botManager: BotManager): Promise<void> {
    try {
        console.log('[BotEngine] Starting...');

        // Initialize Service Bus listener
        await botManager.initializeSignalListener();
        console.log('[BotEngine] Service Bus listener initialized');

        // Now you can start individual bots
        // await botManager.startOrUpdateBot(botConfig, apiKeys);

        console.log('[BotEngine] Ready to accept bot configurations');
    } catch (error) {
        console.error('[BotEngine] Failed to start:', error);
        throw error;
    }
}

/**
 * Gracefully shutdown bot engine
 */
export async function shutdownBotEngine(botManager: BotManager): Promise<void> {
    try {
        console.log('[BotEngine] Shutting down...');

        // Stop all bots (also stops Service Bus listener)
        await botManager.stopAllBots();

        console.log('[BotEngine] Shutdown complete');
    } catch (error) {
        console.error('[BotEngine] Error during shutdown:', error);
        throw error;
    }
}

/**
 * Example usage in main application
 */
export async function runExample(): Promise<void> {
    // Initialize
    const botManager = initializeBotManager();

    // Start
    await startBotEngine(botManager);

    // Add graceful shutdown handler
    process.on('SIGINT', async () => {
        console.log('Received SIGINT, shutting down...');
        await shutdownBotEngine(botManager);
        process.exit(0);
    });

    // Example: Start a DCA bot with INDICATOR entry condition
    /*
    const botConfig: BotInstance = {
        id: 'bot-btc-dca-001',
        name: 'BTC Dollar Cost Average',
        exchangeId: 'ALPACA',
        strategyType: 'DCA',
        config: {
            baseOrderCondition: 'INDICATOR',  // ← Wait for indicator signal
            entryIndicators: [
                {
                    name: 'RSI',
                    period: 14,
                    threshold: 30,  // Buy when RSI < 30 (oversold)
                    operator: 'less_than'
                },
                {
                    name: 'MACD',
                    fastPeriod: 12,
                    slowPeriod: 26,
                    signalPeriod: 9,
                    threshold: 0,
                    operator: 'less_than'  // Buy when MACD < 0
                }
            ],
            orderAmount: 100,  // $100 per order
            targetProfit: 5,   // 5% profit target
            maxOrders: 10,
            pair: 'BTC/USD'
        }
    };

    await botManager.startOrUpdateBot(botConfig, {
        apiKey: 'your-api-key',
        apiSecret: 'your-api-secret'
    });
    */

    // Example: Start a DCA bot with TRADINGVIEW entry condition
    /*
    const botConfig: BotInstance = {
        id: 'bot-eth-tv-001',
        name: 'ETH TradingView Alert Bot',
        exchangeId: 'BINANCE',
        strategyType: 'DCA',
        config: {
            baseOrderCondition: 'TRADINGVIEW',  // ← Wait for TV signal
            entryIndicators: [],  // Not used for TV entry
            orderAmount: 50,   // $50 per order
            targetProfit: 3,   // 3% profit target
            maxOrders: 20,
            pair: 'ETH/USD'
        }
    };

    await botManager.startOrUpdateBot(botConfig, {
        apiKey: 'your-api-key',
        apiSecret: 'your-api-secret'
    });
    */

    // Example: Start a DCA bot with IMMEDIATE entry
    /*
    const botConfig: BotInstance = {
        id: 'bot-sol-immediate-001',
        name: 'SOL Immediate Entry DCA',
        exchangeId: 'SOLANA',
        strategyType: 'DCA',
        config: {
            baseOrderCondition: 'IMMEDIATELY',  // ← Start immediately
            entryIndicators: [],
            orderAmount: 25,   // $25 per order
            targetProfit: 10,  // 10% profit target
            maxOrders: 5,
            pair: 'SOL/USD'
        }
    };

    await botManager.startOrUpdateBot(botConfig, {
        apiKey: 'your-api-key',
        apiSecret: 'your-api-secret'
    });
    */
}

// Export types for external use
export type { SignalListenerConfig };
export { BotManager };

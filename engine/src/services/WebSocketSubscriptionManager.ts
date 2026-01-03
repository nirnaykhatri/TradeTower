import { IExchangeConnector } from '@trading-tower/connectors';
import { IBotStrategy } from '../strategies/BaseStrategy';

/**
 * Subscription tracking entry
 */
interface SubscriptionEntry {
    exchange: IExchangeConnector;
    pair: string;
    strategy: IBotStrategy;
}

/**
 * WebSocket Subscription Manager
 * 
 * Manages WebSocket subscriptions for bots following Single Responsibility Principle.
 * Handles subscription/unsubscription logic with error handling and monitoring.
 * 
 * Responsibilities:
 * - Subscribe bots to WebSocket order fill events
 * - Unsubscribe bots on stop
 * - Track active subscriptions
 * - Provide subscription health metrics
 */
export class WebSocketSubscriptionManager {
    private subscriptions: Map<string, SubscriptionEntry> = new Map();

    /**
     * Subscribe a bot to WebSocket order fill events
     * 
     * @param botId Bot identifier
     * @param exchange Exchange connector
     * @param pair Trading pair
     * @param strategy Bot strategy implementing IOrderFillListener
     * @returns true if subscription succeeded, false otherwise
     */
    public async subscribeBot(
        botId: string,
        exchange: IExchangeConnector,
        pair: string,
        strategy: IBotStrategy
    ): Promise<boolean> {
        try {
            await exchange.subscribeToOrderFills(pair, strategy);
            
            // Track subscription
            this.subscriptions.set(botId, { exchange, pair, strategy });
            
            console.log(`[WebSocketSubscriptionManager] Bot ${botId} subscribed to order fills for ${pair}`);
            return true;
        } catch (error) {
            console.warn(
                `[WebSocketSubscriptionManager] Failed to subscribe bot ${botId} to order fills:`,
                error
            );
            return false;
        }
    }

    /**
     * Unsubscribe a bot from WebSocket order fill events
     * 
     * @param botId Bot identifier
     * @returns true if unsubscription succeeded, false otherwise
     */
    public async unsubscribeBot(botId: string): Promise<boolean> {
        const subscription = this.subscriptions.get(botId);
        if (!subscription) {
            console.debug(`[WebSocketSubscriptionManager] No subscription found for bot ${botId}`);
            return false;
        }

        try {
            await subscription.exchange.unsubscribeFromOrderFills(
                subscription.pair,
                subscription.strategy
            );
            
            this.subscriptions.delete(botId);
            
            console.log(`[WebSocketSubscriptionManager] Bot ${botId} unsubscribed from order fills`);
            return true;
        } catch (error) {
            console.warn(
                `[WebSocketSubscriptionManager] Failed to unsubscribe bot ${botId}:`,
                error
            );
            return false;
        }
    }

    /**
     * Check if a bot is subscribed
     * 
     * @param botId Bot identifier
     * @returns true if bot has active subscription
     */
    public isSubscribed(botId: string): boolean {
        return this.subscriptions.has(botId);
    }

    /**
     * Get subscription health metrics
     * 
     * @returns Object with subscription statistics
     */
    public getSubscriptionHealth(): {
        totalSubscriptions: number;
        subscriptionsByExchange: Map<string, number>;
    } {
        const subscriptionsByExchange = new Map<string, number>();

        for (const { exchange } of this.subscriptions.values()) {
            const exchangeName = exchange.constructor.name;
            subscriptionsByExchange.set(
                exchangeName,
                (subscriptionsByExchange.get(exchangeName) || 0) + 1
            );
        }

        return {
            totalSubscriptions: this.subscriptions.size,
            subscriptionsByExchange
        };
    }

    /**
     * Unsubscribe all bots
     * Useful for graceful shutdown
     */
    public async unsubscribeAll(): Promise<void> {
        const botIds = Array.from(this.subscriptions.keys());
        
        console.log(`[WebSocketSubscriptionManager] Unsubscribing ${botIds.length} bots...`);

        const unsubscribePromises = botIds.map(botId =>
            this.unsubscribeBot(botId).catch(error => {
                console.error(
                    `[WebSocketSubscriptionManager] Failed to unsubscribe bot ${botId}:`,
                    error
                );
            })
        );

        await Promise.allSettled(unsubscribePromises);
        
        console.log('[WebSocketSubscriptionManager] All bots unsubscribed');
    }
}

/**
 * Default subscription manager instance
 */
export const webSocketSubscriptionManager = new WebSocketSubscriptionManager();

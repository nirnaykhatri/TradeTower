import { IExchangeConnector } from '@trading-tower/connectors';
import { TradeOrder } from '@trading-tower/shared';

/**
 * Service for recovering missed order fills during WebSocket disconnection
 * 
 * When WebSocket connection is lost, fills may occur without notification.
 * This service polls the exchange to reconcile order states and detect missed fills.
 */
export class MissedFillRecoveryService {
    private isRecovering: Map<string, boolean> = new Map(); // botId -> recovering state

    /**
     * Recover missed fills for a bot's active orders
     * 
     * @param botId Bot identifier
     * @param exchange Exchange connector
     * @param activeOrders Map of order IDs to track
     * @param pair Trading pair
     * @returns Array of filled orders that were missed
     */
    async recoverMissedFills(
        botId: string,
        exchange: IExchangeConnector,
        activeOrders: Map<string, TradeOrder>,
        pair: string
    ): Promise<TradeOrder[]> {
        // Prevent concurrent recovery for same bot
        if (this.isRecovering.get(botId)) {
            console.log(`[MissedFillRecovery] Recovery already in progress for bot ${botId}`);
            return [];
        }

        this.isRecovering.set(botId, true);
        const missedFills: TradeOrder[] = [];

        try {
            console.log(
                `[MissedFillRecovery] Checking ${activeOrders.size} orders for bot ${botId} on ${exchange.name}`
            );

            // Query each active order for current status
            for (const [orderId, localOrder] of activeOrders.entries()) {
                try {
                    const exchangeOrder = await exchange.getOrder(orderId, pair);

                    // Check if order was filled while disconnected
                    if (this.wasOrderFilled(localOrder, exchangeOrder)) {
                        console.log(
                            `[MissedFillRecovery] Detected missed fill for order ${orderId} ` +
                            `(${exchangeOrder.filledAmount}/${exchangeOrder.amount})`
                        );
                        missedFills.push(exchangeOrder);
                    } else if (exchangeOrder.status === 'canceled' && localOrder.status !== 'canceled') {
                        console.log(
                            `[MissedFillRecovery] Detected missed cancellation for order ${orderId}`
                        );
                        missedFills.push(exchangeOrder);
                    }
                } catch (error) {
                    console.warn(
                        `[MissedFillRecovery] Failed to query order ${orderId}:`,
                        error
                    );
                    // Continue checking other orders
                }
            }

            if (missedFills.length > 0) {
                console.log(
                    `[MissedFillRecovery] Recovered ${missedFills.length} missed fills for bot ${botId}`
                );
            } else {
                console.log(`[MissedFillRecovery] No missed fills detected for bot ${botId}`);
            }

            return missedFills;
        } catch (error) {
            console.error(`[MissedFillRecovery] Recovery failed for bot ${botId}:`, error);
            return [];
        } finally {
            this.isRecovering.set(botId, false);
        }
    }

    /**
     * Determine if an order was filled based on state comparison
     */
    private wasOrderFilled(localOrder: TradeOrder, exchangeOrder: TradeOrder): boolean {
        // Order is now fully filled but wasn't before
        if (exchangeOrder.status === 'filled' && localOrder.status !== 'filled') {
            return true;
        }

        // Order has more filled amount than local record
        if (exchangeOrder.filledAmount > localOrder.filledAmount) {
            return true;
        }

        return false;
    }

    /**
     * Check if recovery is currently in progress for a bot
     */
    isRecoveringBot(botId: string): boolean {
        return this.isRecovering.get(botId) || false;
    }

    /**
     * Get recovery statistics
     */
    getStats() {
        return {
            activeRecoveries: Array.from(this.isRecovering.entries())
                .filter(([_, recovering]) => recovering)
                .map(([botId]) => botId)
        };
    }
}

/**
 * Singleton instance for application-wide use
 */
export const missedFillRecoveryService = new MissedFillRecoveryService();

/**
 * Service Bus Signal Publisher
 * 
 * Publishes bot entry signals to Azure Service Bus topics:
 * - indicator-signals: Indicator evaluation results
 * 
 * Used by indicator evaluation service to notify bot engine of signal events.
 */

import { ServiceBusClient, ServiceBusSender } from '@azure/service-bus';
import { ServiceBusSignalMessage } from './ServiceBusSignalListener';

export interface PublisherConfig {
    connectionString: string;
    indicatorSignalsTopicName: string;
}

/**
 * Service Bus Signal Publisher
 * 
 * Publishes indicator signals to Service Bus topic.
 * Manages single sender connection for efficiency.
 */
export class ServiceBusSignalPublisher {
    private client?: ServiceBusClient;
    private sender?: ServiceBusSender;
    private isConnected: boolean = false;
    private config: PublisherConfig;

    constructor(config: PublisherConfig) {
        this.config = config;
    }

    /**
     * Connect to Service Bus and initialize sender
     */
    public async connect(): Promise<void> {
        try {
            console.log('[ServiceBusSignalPublisher] Connecting to Service Bus...');
            
            this.client = new ServiceBusClient(this.config.connectionString);
            this.sender = this.client.createSender(this.config.indicatorSignalsTopicName);
            
            this.isConnected = true;
            console.log('[ServiceBusSignalPublisher] Connected');
        } catch (error) {
            console.error('[ServiceBusSignalPublisher] Failed to connect:', error);
            throw error;
        }
    }

    /**
     * Publish an indicator signal to Service Bus
     * 
     * @param signal The signal message to publish
     * @throws Error if not connected or publishing fails
     */
    public async publishSignal(signal: ServiceBusSignalMessage): Promise<void> {
        if (!this.isConnected || !this.sender) {
            throw new Error('Publisher not connected. Call connect() first.');
        }

        try {
            const message = {
                body: signal,
                contentType: 'application/json',
                // Track the signal with correlation ID for debugging
                correlationId: `signal-${signal.botId}-${Date.now()}`,
                // Set TTL to 5 minutes
                timeToLive: 5 * 60 * 1000
            };

            await this.sender.sendMessages(message);

            console.debug(
                `[ServiceBusSignalPublisher] Published ${signal.signal} signal for bot ${signal.botId} (${signal.pair})`
            );
        } catch (error) {
            console.error('[ServiceBusSignalPublisher] Failed to publish signal:', error);
            throw error;
        }
    }

    /**
     * Batch publish multiple signals
     * More efficient than individual publishes
     * 
     * @param signals Array of signal messages to publish
     */
    public async publishSignalsBatch(signals: ServiceBusSignalMessage[]): Promise<void> {
        if (!this.isConnected || !this.sender) {
            throw new Error('Publisher not connected. Call connect() first.');
        }

        if (signals.length === 0) {
            return;
        }

        try {
            const messages = signals.map((signal) => ({
                body: signal,
                contentType: 'application/json',
                correlationId: `signal-${signal.botId}-${Date.now()}`,
                timeToLive: 5 * 60 * 1000
            }));

            await this.sender.sendMessages(messages);

            console.debug(
                `[ServiceBusSignalPublisher] Published batch of ${signals.length} signals`
            );
        } catch (error) {
            console.error('[ServiceBusSignalPublisher] Failed to publish batch:', error);
            throw error;
        }
    }

    /**
     * Close connection and clean up resources
     */
    public async disconnect(): Promise<void> {
        try {
            console.log('[ServiceBusSignalPublisher] Disconnecting...');
            
            if (this.sender) {
                await this.sender.close();
            }
            if (this.client) {
                await this.client.close();
            }
            
            this.isConnected = false;
            console.log('[ServiceBusSignalPublisher] Disconnected');
        } catch (error) {
            console.error('[ServiceBusSignalPublisher] Error during disconnect:', error);
            throw error;
        }
    }

    /**
     * Check if publisher is connected
     */
    public isPublisherConnected(): boolean {
        return this.isConnected;
    }
}

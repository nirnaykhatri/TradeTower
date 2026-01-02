/**
 * Service Bus Publisher for Webhook
 * 
 * Publishes TradingView signals to Azure Service Bus trading-view-signals topic
 * Integrates with webhook handler to deliver signals to bot engine
 */

import { ServiceBusClient, ServiceBusSender } from '@azure/service-bus';
import { DefaultAzureCredential } from '@azure/identity';

export interface TradingViewSignalMessage {
    botId: string;
    signal: 'BUY' | 'SELL' | 'STRONG_BUY' | 'STRONG_SELL';
    source: 'TRADINGVIEW';
    pair: string;
    timestamp: number;
    metadata?: Record<string, any>;
}

/**
 * Service Bus Publisher
 * Singleton service for publishing signals to Service Bus
 */
export class ServiceBusPublisher {
    private static instance: ServiceBusPublisher;
    private client?: ServiceBusClient;
    private sender?: ServiceBusSender;
    private isConnected: boolean = false;
    private topicName: string;

    private constructor() {
        const endpoint = process.env.SERVICE_BUS_ENDPOINT;
        this.topicName = process.env.SB_TV_SIGNALS_TOPIC || 'trading-view-signals';

        if (!endpoint) {
            throw new Error('SERVICE_BUS_ENDPOINT is not configured');
        }

        const credential = new DefaultAzureCredential();
        this.client = new ServiceBusClient(endpoint, credential);
    }

    /**
     * Get singleton instance
     */
    public static getInstance(): ServiceBusPublisher {
        if (!ServiceBusPublisher.instance) {
            ServiceBusPublisher.instance = new ServiceBusPublisher();
        }
        return ServiceBusPublisher.instance;
    }

    /**
     * Ensure sender is initialized
     */
    private async ensureSender(): Promise<ServiceBusSender> {
        if (!this.sender) {
            if (!this.client) {
                throw new Error('Service Bus client not initialized');
            }
            this.sender = this.client.createSender(this.topicName);
            this.isConnected = true;
        }
        return this.sender;
    }

    /**
     * Publish a TradingView signal to Service Bus
     * 
     * @param signal The signal message to publish
     * @throws Error if publishing fails
     */
    public async publishSignal(signal: TradingViewSignalMessage): Promise<void> {
        try {
            const sender = await this.ensureSender();

            const message = {
                body: signal,
                contentType: 'application/json',
                correlationId: `tv-${signal.botId}-${Date.now()}`,
                // TTL: 5 minutes
                timeToLive: 5 * 60 * 1000
            };

            await sender.sendMessages(message);
        } catch (error) {
            console.error('[ServiceBusPublisher] Failed to publish signal:', error);
            throw error;
        }
    }

    /**
     * Check if publisher is connected
     */
    public isPublisherConnected(): boolean {
        return this.isConnected;
    }

    /**
     * Close publisher connection
     */
    public async disconnect(): Promise<void> {
        try {
            if (this.sender) {
                await this.sender.close();
            }
            if (this.client) {
                await this.client.close();
            }
            this.isConnected = false;
        } catch (error) {
            console.error('[ServiceBusPublisher] Error during disconnect:', error);
            throw error;
        }
    }
}

export const sbPublisher = ServiceBusPublisher.getInstance();

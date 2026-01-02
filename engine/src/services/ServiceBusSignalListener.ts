/**
 * Service Bus Signal Listener
 * 
 * Subscribes to Service Bus topics for bot entry signals:
 * - trading-view-signals: TV signals from Azure Function
 * - indicator-signals: Indicator evaluation results
 * 
 * When a signal arrives, triggers the corresponding bot's entry logic.
 */

import {
    ServiceBusClient,
    ServiceBusReceiver,
    ServiceBusReceivedMessage,
    ProcessErrorArgs,
} from '@azure/service-bus';

export interface ServiceBusSignalMessage {
    botId: string;
    signal: 'BUY' | 'SELL' | 'STRONG_BUY' | 'STRONG_SELL';
    source: 'TRADINGVIEW' | 'INDICATOR';
    pair: string;
    timestamp: number;
    metadata?: Record<string, any>;  // Indicator details, TV alert details, etc.
}

export interface SignalListenerConfig {
    connectionString: string;
    tvSignalsTopicName: string;
    tvSignalsSubscription: string;
    indicatorSignalsTopicName: string;
    indicatorSignalsSubscription: string;
}

export type SignalHandler = (message: ServiceBusSignalMessage) => Promise<void>;

/**
 * Service Bus Signal Listener
 * 
 * Connects to Azure Service Bus and listens for bot entry signals.
 * Routes messages to registered signal handlers.
 */
export class ServiceBusSignalListener {
    private handlers: Map<string, SignalHandler[]> = new Map();
    private isConnected: boolean = false;
    private config: SignalListenerConfig;
    private client?: ServiceBusClient;
    private tvReceiver?: ServiceBusReceiver;
    private indicatorReceiver?: ServiceBusReceiver;

    constructor(config: SignalListenerConfig) {
        this.config = config;
    }

    /**
     * Register a handler for signals from a specific source
     * 
     * @param source 'TRADINGVIEW' or 'INDICATOR'
     * @param handler Function to call when signal arrives
     */
    public onSignal(source: 'TRADINGVIEW' | 'INDICATOR', handler: SignalHandler): void {
        if (!this.handlers.has(source)) {
            this.handlers.set(source, []);
        }
        this.handlers.get(source)!.push(handler);
    }

    /**
     * Start listening to Service Bus topics
     * 
     * Connects to:
     * - trading-view-signals topic (TV webhook signals)
     * - indicator-signals topic (indicator evaluation results)
     * 
     * @throws Error if connection fails
     */
    public async start(): Promise<void> {
        try {
            console.log('[ServiceBusSignalListener] Connecting to Service Bus...');
            
            // Initialize ServiceBusClient
            this.client = new ServiceBusClient(this.config.connectionString);
            
            // Create receivers for both topics
            this.tvReceiver = this.client.createReceiver(
                this.config.tvSignalsTopicName,
                this.config.tvSignalsSubscription
            );
            
            this.indicatorReceiver = this.client.createReceiver(
                this.config.indicatorSignalsTopicName,
                this.config.indicatorSignalsSubscription
            );
            
            // Start message handlers
            await this.startReceivingMessages(this.tvReceiver, 'TRADINGVIEW');
            await this.startReceivingMessages(this.indicatorReceiver, 'INDICATOR');
            
            this.isConnected = true;
            console.log('[ServiceBusSignalListener] Connected and listening for signals');
        } catch (error) {
            console.error('[ServiceBusSignalListener] Failed to connect:', error);
            throw error;
        }
    }

    /**
     * Stop listening and close connections
     */
    public async stop(): Promise<void> {
        try {
            console.log('[ServiceBusSignalListener] Stopping...');
            
            // Close all receivers
            if (this.tvReceiver) {
                await this.tvReceiver.close();
            }
            if (this.indicatorReceiver) {
                await this.indicatorReceiver.close();
            }
            
            // Close client
            if (this.client) {
                await this.client.close();
            }
            
            this.isConnected = false;
            console.log('[ServiceBusSignalListener] Stopped');
        } catch (error) {
            console.error('[ServiceBusSignalListener] Error during shutdown:', error);
            throw error;
        }
    }

    /**
     * Check if listener is connected
     */
    public isListening(): boolean {
        return this.isConnected;
    }

    /**
     * Internal: Start receiving messages from a topic subscription
     * Sets up message processing and error handling for a receiver
     */
    private async startReceivingMessages(
        receiver: ServiceBusReceiver,
        source: 'TRADINGVIEW' | 'INDICATOR'
    ): Promise<void> {
        receiver.subscribe(
            {
                processMessage: async (message: ServiceBusReceivedMessage) => {
                    await this.handleMessage(message, source);
                },
                processError: async (args: ProcessErrorArgs) => {
                    console.error(`[ServiceBusSignalListener] ${source} receiver error:`, args.error);
                },
            },
            {
                autoCompleteMessages: false, // Manual completion for reliability
                maxConcurrentCalls: 5, // Process 5 messages concurrently per subscription
            }
        );
    }

    /**
     * Internal: Process incoming message
     */
    private async handleMessage(rawMessage: ServiceBusReceivedMessage, source: 'TRADINGVIEW' | 'INDICATOR'): Promise<void> {
        try {
            // Parse message body
            const message: ServiceBusSignalMessage = JSON.parse(
                typeof rawMessage.body === 'string' 
                    ? rawMessage.body 
                    : new TextDecoder().decode(rawMessage.body as unknown as Uint8Array)
            );
            
            // Validate message
            if (!this.validateMessage(message, source)) {
                console.warn(`[ServiceBusSignalListener] Invalid ${source} message:`, message);
                // Still complete the message to avoid reprocessing
                await (rawMessage as any).complete();
                return;
            }
            
            // Call registered handlers
            const handlers = this.handlers.get(source) || [];
            for (const handler of handlers) {
                try {
                    await handler(message);
                } catch (error) {
                    console.error(`[ServiceBusSignalListener] Handler error for ${message.botId}:`, error);
                }
            }
            
            // Mark message as processed
            await (rawMessage as any).complete();
        } catch (error) {
            console.error('[ServiceBusSignalListener] Message processing error:', error);
            // Don't complete message - let it be retried after lock expires
        }
    }

    /**
     * Validate message structure and content
     */
    private validateMessage(message: ServiceBusSignalMessage, source: string): boolean {
        if (!message.botId) {
            console.warn('[ServiceBusSignalListener] Message missing botId');
            return false;
        }
        
        if (!['BUY', 'SELL', 'STRONG_BUY', 'STRONG_SELL'].includes(message.signal)) {
            console.warn('[ServiceBusSignalListener] Invalid signal:', message.signal);
            return false;
        }
        
        if (message.source !== source) {
            console.warn('[ServiceBusSignalListener] Source mismatch:', message.source, 'vs', source);
            return false;
        }
        
        return true;
    }
}

/**
 * Factory function to create and configure listener
 */
export function createSignalListener(config: SignalListenerConfig): ServiceBusSignalListener {
    return new ServiceBusSignalListener(config);
}

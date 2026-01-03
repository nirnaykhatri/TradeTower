import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { TradeOrder } from '@trading-tower/shared';
import { IOrderFillListener } from '../interfaces/IOrderFillListener';
import { CircuitBreaker, CircuitBreakerError, CircuitBreakerConfig } from './CircuitBreaker';
import { CircuitBreakerState } from './CircuitBreaker';

/**
 * Default configuration constants for WebSocket connections
 */
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 10;
const DEFAULT_INITIAL_RECONNECT_DELAY_MS = 100;
const DEFAULT_MAX_RECONNECT_DELAY_MS = 30000;
const DEFAULT_RECONNECT_BACKOFF_MULTIPLIER = 1.5;
const DEFAULT_CONNECTION_TIMEOUT_MS = 10000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30000;
const DEFAULT_USER_AGENT = 'TradeTower/1.0';

/**
 * Default circuit breaker configuration constants
 */
const DEFAULT_CB_FAILURE_THRESHOLD = 5;
const DEFAULT_CB_FAILURE_WINDOW_MS = 60000;
const DEFAULT_CB_RESET_TIMEOUT_MS = 30000;
const DEFAULT_CB_SUCCESS_THRESHOLD = 2;

/**
 * Connection states for WebSocket lifecycle tracking
 */
export enum WebSocketConnectionState {
    DISCONNECTED = 'DISCONNECTED',
    CONNECTING = 'CONNECTING',
    CONNECTED = 'CONNECTED',
    AUTHENTICATING = 'AUTHENTICATING',
    AUTHENTICATED = 'AUTHENTICATED',
    RECONNECTING = 'RECONNECTING',
    CLOSING = 'CLOSING',
    CLOSED = 'CLOSED',
    ERROR = 'ERROR'
}

/**
 * Configuration for WebSocket connection and reconnection behavior
 */
export interface WebSocketConfig {
    /**
     * Maximum number of reconnection attempts before giving up
     */
    maxReconnectAttempts: number;

    /**
     * Initial delay for reconnection in milliseconds
     */
    initialReconnectDelayMs: number;

    /**
     * Maximum delay between reconnection attempts in milliseconds
     */
    maxReconnectDelayMs: number;

    /**
     * Multiplier for exponential backoff calculation
     */
    reconnectBackoffMultiplier: number;

    /**
     * Timeout for connection attempt in milliseconds
     */
    connectionTimeoutMs: number;

    /**
     * Interval for sending heartbeat/ping messages (optional)
     */
    heartbeatIntervalMs?: number;

    /**
     * User agent string for WebSocket connections
     */
    userAgent?: string;

    /**
     * Circuit breaker configuration (optional)
     */
    circuitBreaker?: Partial<CircuitBreakerConfig>;
}

/**
 * Default WebSocket configuration for production use
 */
export const DEFAULT_WEBSOCKET_CONFIG: WebSocketConfig = {
    maxReconnectAttempts: DEFAULT_MAX_RECONNECT_ATTEMPTS,
    initialReconnectDelayMs: DEFAULT_INITIAL_RECONNECT_DELAY_MS,
    maxReconnectDelayMs: DEFAULT_MAX_RECONNECT_DELAY_MS,
    reconnectBackoffMultiplier: DEFAULT_RECONNECT_BACKOFF_MULTIPLIER,
    connectionTimeoutMs: DEFAULT_CONNECTION_TIMEOUT_MS,
    heartbeatIntervalMs: DEFAULT_HEARTBEAT_INTERVAL_MS,
    userAgent: DEFAULT_USER_AGENT,
    circuitBreaker: {
        failureThreshold: DEFAULT_CB_FAILURE_THRESHOLD,
        failureWindowMs: DEFAULT_CB_FAILURE_WINDOW_MS,
        resetTimeoutMs: DEFAULT_CB_RESET_TIMEOUT_MS,
        successThreshold: DEFAULT_CB_SUCCESS_THRESHOLD
    }
};

/**
 * Abstract base class for exchange-specific WebSocket implementations.
 * 
 * Handles:
 * - Connection lifecycle (connect, authenticate, reconnect, disconnect)
 * - Exponential backoff reconnection logic
 * - Listener registry and event notification
 * - Error handling and recovery
 * - Heartbeat/ping-pong for connection health
 * - Circuit breaker protection against repeated failures
 * 
 * Subclasses must implement:
 * - getWebSocketUrl(): URL for exchange WebSocket endpoint
 * - onMessage(): Parse and handle incoming WebSocket messages
 * - authenticate(): Exchange-specific authentication
 */
export abstract class WebSocketManager {
    // Internal event emitter (composition over inheritance)
    private eventEmitter: EventEmitter = new EventEmitter();
    
    // Connection state
    private state: WebSocketConnectionState = WebSocketConnectionState.DISCONNECTED;
    protected websocket: WebSocket | null = null;
    
    // Reconnection tracking
    private reconnectAttempts: number = 0;
    private reconnectTimeout: NodeJS.Timeout | null = null;
    private lastReconnectAttemptTime: number | null = null;
    
    // Connection lifecycle tracking
    private heartbeatInterval: NodeJS.Timeout | null = null;
    private connectionStartTime: number | null = null;
    private lastEventTime: number | null = null;
    
    // Circuit breaker for fault tolerance
    protected circuitBreaker: CircuitBreaker;
    
    // Listener management
    protected pairListeners: Map<string, Set<IOrderFillListener>> = new Map();
    protected config: WebSocketConfig;

    constructor(
        protected exchangeName: string,
        protected apiKey: string,
        protected apiSecret: string,
        configOverrides?: Partial<WebSocketConfig>
    ) {
        this.config = { ...DEFAULT_WEBSOCKET_CONFIG, ...configOverrides };
        
        // Initialize circuit breaker with merged config
        const cbConfig = { ...DEFAULT_WEBSOCKET_CONFIG.circuitBreaker, ...this.config.circuitBreaker };
        this.circuitBreaker = new CircuitBreaker(`${exchangeName}-WebSocket`, cbConfig as CircuitBreakerConfig);
    }

    /**
     * Get the WebSocket URL for this exchange.
     * Must be implemented by subclass.
     */
    protected abstract getWebSocketUrl(): string;

    /**
     * Handle incoming WebSocket message.
     * Must be implemented by subclass.
     */
    protected abstract onMessage(data: WebSocket.RawData): Promise<void>;

    /**
     * Authenticate the WebSocket connection.
     * Exchange-specific implementation required.
     */
    protected abstract authenticate(): Promise<void>;

    /**
     * Parse raw WebSocket data into a string.
     * Handles multiple data formats: string, Buffer, Buffer array, or ArrayBuffer.
     * 
     * @param data - Raw data from WebSocket message
     * @returns Parsed string content
     */
    protected parseRawData(data: WebSocket.RawData): string {
        if (typeof data === 'string') return data;
        if (Array.isArray(data)) return Buffer.concat(data as Buffer[]).toString();
        if (Buffer.isBuffer(data)) return data.toString();
        return Buffer.from(data as ArrayBuffer).toString();
    }

    /**
     * Get the current status of the WebSocket connection including circuit breaker stats
     */
    public getStatus() {
        return {
            exchange: this.exchangeName,
            state: this.state,
                        isConnected: this.isConnected(),
            reconnectAttempts: this.reconnectAttempts,
            connectionUptime: this.connectionStartTime ? Date.now() - this.connectionStartTime : 0,
            lastEventTime: this.lastEventTime ?? undefined,
            subscriptionCount: Array.from(this.pairListeners.values()).reduce(
                (sum, set) => sum + set.size,
                0
            ),
            circuitBreaker: this.circuitBreaker.getStats(),
            listenersByPair: Object.fromEntries(
                Array.from(this.pairListeners.entries()).map(([pair, listeners]) => [
                    pair,
                    listeners.size
                ])
            )
        };
    }

    /**
     * Register internal event listener (for monitoring purposes only)
     * Events: 'connected', 'disconnected', 'error', 'max_reconnect_attempts_reached', 'state_change'
     * 
     * @internal
     */
    public on(event: string, listener: (...args: any[]) => void): void {
        this.eventEmitter.on(event, listener);
    }

    /**
     * Remove internal event listener
     * 
     * @internal
     */
    public off(event: string, listener: (...args: any[]) => void): void {
        this.eventEmitter.off(event, listener);
    }

    /**
     * Subscribe a listener to order fills for a specific pair
     */
    public async subscribeToOrderFills(pair: string, listener: IOrderFillListener): Promise<void> {
        if (!this.pairListeners.has(pair)) {
            this.pairListeners.set(pair, new Set());
        }
        this.pairListeners.get(pair)!.add(listener);

        // Ensure connection is active
        if (this.state === WebSocketConnectionState.DISCONNECTED) {
            await this.connect();
        }

        // Notify subclass to subscribe to this pair if needed
        await this.onPairSubscribed?.(pair);
    }

    /**
     * Optional hook for subclasses to handle pair subscriptions
     */
    protected async onPairSubscribed?(pair: string): Promise<void>;

    /**
     * Unsubscribe a listener from order fills for a specific pair
     */
    public async unsubscribeFromOrderFills(pair: string, listener: IOrderFillListener): Promise<void> {
        const listeners = this.pairListeners.get(pair);
        if (!listeners) return;

        listeners.delete(listener);
        if (listeners.size === 0) {
            this.pairListeners.delete(pair);
            await this.onPairUnsubscribed?.(pair);
        }

        // Disconnect if no more listeners
        if (this.pairListeners.size === 0) {
            await this.disconnect();
        }
    }

    /**
     * Optional hook for subclasses to handle pair unsubscriptions
     */
    protected async onPairUnsubscribed?(pair: string): Promise<void>;

    /**
     * Get the current connection state
     */
    public getConnectionState(): WebSocketConnectionState {
        return this.state;
    }

    /**
     * Check if the WebSocket is connected
     */
    public isConnected(): boolean {
        return this.state === WebSocketConnectionState.AUTHENTICATED;
    }

    /**
     * Connect to the exchange WebSocket with circuit breaker protection
     */
    public async connect(): Promise<void> {
        if (this.state !== WebSocketConnectionState.DISCONNECTED && this.state !== WebSocketConnectionState.RECONNECTING) {
            console.log(`[${this.exchangeName}] Already in state ${this.state}, skipping connect`);
            return;
        }

        // Check if circuit breaker allows connection
        const cbState = this.circuitBreaker.getState();
        if (cbState === 'OPEN') {
            console.log(`[${this.exchangeName}] Circuit breaker is OPEN, connection not allowed`);
            throw new CircuitBreakerError(this.exchangeName, CircuitBreakerState.OPEN);
        }

        // Wrap connection with circuit breaker
        try {
            await this.circuitBreaker.execute(async () => {
                await this.performConnection();
            });
            
            // Connection successful, reset reconnect attempts
            this.reconnectAttempts = 0;
            this.eventEmitter.emit('connected');
        } catch (error) {
            console.error(`[${this.exchangeName}] Connection failed:`, error);
            this.setState(WebSocketConnectionState.ERROR);
            
            // Schedule reconnection if not at max attempts
            if (this.reconnectAttempts < this.config.maxReconnectAttempts) {
                this.scheduleReconnect();
            } else {
                this.eventEmitter.emit('max_reconnect_attempts_reached');
            }
            
            throw error;
        }
    }

    /**
     * Perform the actual connection logic (wrapped by circuit breaker)
     */
    private async performConnection(): Promise<void> {
        this.setState(WebSocketConnectionState.CONNECTING);

        return new Promise((resolve, reject) => {
            const url = this.getWebSocketUrl();
            const websocket = new WebSocket(url, {
                headers: {
                    'User-Agent': this.config.userAgent
                }
            });

            const connectionTimeout = setTimeout(() => {
                websocket.terminate();
                reject(new Error('Connection timeout'));
            }, this.config.connectionTimeoutMs);

            websocket.on('open', async () => {
                clearTimeout(connectionTimeout);
                this.websocket = websocket;
                this.setState(WebSocketConnectionState.CONNECTED);
                this.connectionStartTime = Date.now();

                try {
                    this.setState(WebSocketConnectionState.AUTHENTICATING);
                    await this.authenticate();
                    this.setState(WebSocketConnectionState.AUTHENTICATED);
                    this.startHeartbeat();
                    resolve();
                } catch (error) {
                    reject(error);
                }
            });

            websocket.on('message', async (data: WebSocket.RawData) => {
                try {
                    await this.onMessage(data);
                } catch (error) {
                    console.error(`[${this.exchangeName}] Message handling error:`, error);
                    this.eventEmitter.emit('error', error);
                }
            });

            websocket.on('error', (error) => {
                clearTimeout(connectionTimeout);
                console.error(`[${this.exchangeName}] WebSocket error:`, error);
                this.setState(WebSocketConnectionState.ERROR);
                this.eventEmitter.emit('error', error);
                reject(error);
            });

            websocket.on('close', () => {
                clearTimeout(connectionTimeout);
                console.log(`[${this.exchangeName}] WebSocket closed`);
                this.stopHeartbeat();
                this.setState(WebSocketConnectionState.DISCONNECTED);
                this.eventEmitter.emit('disconnected');
                
                // Auto-reconnect if we have listeners
                if (this.pairListeners.size > 0 && this.reconnectAttempts < this.config.maxReconnectAttempts) {
                    this.scheduleReconnect();
                }
            });
        });
    }

    /**
     * Disconnect from the exchange WebSocket
     */
    public async disconnect(): Promise<void> {
        this.setState(WebSocketConnectionState.CLOSING);
        this.stopHeartbeat();
        this.cancelReconnect();

        if (this.websocket) {
            this.websocket.close();
            this.websocket = null;
        }
        this.setState(WebSocketConnectionState.CLOSED);
    }

    /**
     * Emit order filled event to all listeners for this pair
     */
    protected async emitOrderFilled(pair: string, order: TradeOrder): Promise<void> {
        this.lastEventTime = Date.now();
        const listeners = this.pairListeners.get(pair);
        if (!listeners) return;

        // Notify listeners in parallel to prevent slow listeners from blocking others
        await Promise.allSettled(
            Array.from(listeners).map(listener => 
                this.notifyListener(listener, 'onOrderFilled', [pair, order])
            )
        );
    }

    /**
     * Emit order partially filled event
     */
    protected async emitOrderPartiallyFilled(pair: string, order: TradeOrder): Promise<void> {
        this.lastEventTime = Date.now();
        const listeners = this.pairListeners.get(pair);
        if (!listeners) return;

        // Notify listeners in parallel to prevent slow listeners from blocking others
        await Promise.allSettled(
            Array.from(listeners).map(listener => 
                this.notifyListener(listener, 'onOrderPartiallyFilled', [pair, order])
            )
        );
    }

    /**
     * Emit order cancelled event
     */
    protected async emitOrderCancelled(pair: string, orderId: string): Promise<void> {
        this.lastEventTime = Date.now();
        const listeners = this.pairListeners.get(pair);
        if (!listeners) return;

        // Notify listeners in parallel to prevent slow listeners from blocking others
        await Promise.allSettled(
            Array.from(listeners).map(listener => 
                this.notifyListener(listener, 'onOrderCancelled', [pair, orderId])
            )
        );
    }

    /**
     * Safely notify a single listener
     */
    private async notifyListener(
        listener: IOrderFillListener,
        method: keyof IOrderFillListener,
        args: any[]
    ): Promise<void> {
        try {
            const fn = (listener[method] as any).bind(listener);
            await fn(...args);
        } catch (error) {
            console.error(`[${this.exchangeName}] Error notifying listener for ${method}:`, error);
            // Don't propagate listener errors
        }
    }

    /**
     * Notify all listeners across all pairs (e.g., for connection events)
     */
    private async notifyAllListeners(
        method: keyof IOrderFillListener,
        args: any[]
    ): Promise<void> {
        const allListeners = new Set<IOrderFillListener>();
        for (const listeners of this.pairListeners.values()) {
            for (const listener of listeners) {
                allListeners.add(listener);
            }
        }

        // Notify listeners in parallel to prevent slow listeners from blocking others
        await Promise.allSettled(
            Array.from(allListeners).map(listener => 
                this.notifyListener(listener, method, args)
            )
        );
    }

    /**
     * Notify all listeners about WebSocket connection
     */
    protected async notifyWebSocketConnected(): Promise<void> {
        await this.notifyAllListeners('onWebSocketConnected', [this.exchangeName]);
    }

    /**
     * Notify all listeners about WebSocket disconnection
     */
    protected async notifyWebSocketDisconnected(): Promise<void> {
        await this.notifyAllListeners('onWebSocketDisconnected', [this.exchangeName]);
    }

    /**
     * Notify all listeners about WebSocket error
     */
    protected async notifyWebSocketError(error: Error): Promise<void> {
        await this.notifyAllListeners('onWebSocketError', [this.exchangeName, error]);
    }

    /**
     * Schedule a reconnection attempt with exponential backoff
     */
    private scheduleReconnect(): void {
        // Time-based reset: Reset counter if last attempt was > 5 minutes ago
        const RECONNECT_COUNTER_RESET_MS = 5 * 60 * 1000; // 5 minutes
        const now = Date.now();
        if (this.lastReconnectAttemptTime && (now - this.lastReconnectAttemptTime) > RECONNECT_COUNTER_RESET_MS) {
            console.log(`[${this.exchangeName}] Resetting reconnect counter after ${Math.floor((now - this.lastReconnectAttemptTime) / 1000)}s idle`);
            this.reconnectAttempts = 0;
        }

        if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
            console.error(`[${this.exchangeName}] Max reconnection attempts reached`);
            this.eventEmitter.emit('max_reconnect_attempts_reached');
            return;
        }

        // Check circuit breaker state before scheduling
        const cbState = this.circuitBreaker.getState();
        if (cbState === 'OPEN') {
            console.log(`[${this.exchangeName}] Circuit breaker is OPEN, postponing reconnect`);
            // Wait for reset timeout before trying again
            const resetTimeoutMs = this.config.circuitBreaker?.resetTimeoutMs || 30000;
            this.reconnectTimeout = setTimeout(() => {
                this.scheduleReconnect();
            }, resetTimeoutMs);
            return;
        }

        this.reconnectAttempts++;
        this.lastReconnectAttemptTime = Date.now();
        const delay = Math.min(
            this.config.initialReconnectDelayMs * Math.pow(this.config.reconnectBackoffMultiplier, this.reconnectAttempts - 1),
            this.config.maxReconnectDelayMs
        );

        console.log(`[${this.exchangeName}] Scheduling reconnect attempt ${this.reconnectAttempts} in ${delay}ms`);
        this.setState(WebSocketConnectionState.RECONNECTING);

        this.reconnectTimeout = setTimeout(async () => {
            try {
                await this.connect();
            } catch (error) {
                console.error(`[${this.exchangeName}] Reconnection attempt failed:`, error);
            }
        }, delay);
    }

    /**
     * Cancel any pending reconnection attempt
     */
    private cancelReconnect(): void {
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
    }

    /**
     * Start the heartbeat interval
     */
    private startHeartbeat(): void {
        if (!this.config.heartbeatIntervalMs) return;

        const heartbeatInterval = this.config.heartbeatIntervalMs;
        this.heartbeatInterval = setInterval(() => {
            if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
                // Only ping if no recent message activity (optimization)
                const timeSinceLastEvent = this.lastEventTime ? Date.now() - this.lastEventTime : Infinity;
                if (timeSinceLastEvent > heartbeatInterval) {
                    this.websocket.ping();
                }
            }
        }, heartbeatInterval);
    }

    /**
     * Stop the heartbeat interval
     */
    private stopHeartbeat(): void {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    /**
     * Update connection state and emit event
     */
    private setState(newState: WebSocketConnectionState): void {
        if (this.state !== newState) {
            const oldState = this.state;
            this.state = newState;
            this.eventEmitter.emit('state_change', { from: oldState, to: newState });
        }
    }
}

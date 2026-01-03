import WebSocket from 'ws';
import { TradeOrder } from '@trading-tower/shared';
import { WebSocketManager, WebSocketConfig } from '../utils/WebSocketManager';
import { AuthUtils } from '../utils/AuthUtils';

/**
 * Binance User Data Stream authentication response
 */
interface BinanceListenKeyResponse {
    listenKey: string;
}

/**
 * Binance execution report from User Data Stream
 */
interface BinanceExecutionReport {
    e: string; // Event type: "executionReport"
    E: number; // Event time
    s: string; // Symbol
    c: number; // Client order ID
    S: string; // Side
    o: string; // Order type
    f: string; // Time in force
    q: string; // Order quantity
    p: string; // Order price
    P: string; // Stop price
    F: string; // Iceberg quantity
    g: number; // Ignore
    C: string | null; // Client order ID
    x: string; // Current execution type
    X: string; // Current order status
    r: string; // Order reject reason
    i: number; // Order ID
    l: string; // Last executed quantity
    z: string; // Cumulative filled quantity
    L: string; // Last executed price
    n: string; // Commission
    N: string; // Commission asset
    T: number; // Transaction time
    t: number; // Trade ID
    b: string; // Bids notional
    a: string; // Ask notional
    m: boolean; // Is this trade the maker side?
    R: boolean; // Is this reduce only
    wt: string; // Stop price working type
    ot: string; // Original order type
    ps: string; // Position side
    cp: boolean; // Close position
    AP: string; // Activation price
    cr: string; // Callback rate
    pP: boolean; // Protected profit
    si: number; // Self trade prevention mode
    tc: string; // Trade commission asset type
}

/**
 * Binance WebSocket User Data Stream Manager
 * 
 * Manages WebSocket connection to Binance User Data Stream API for receiving
 * real-time order execution reports, fill events, and balance updates.
 * 
 * Uses Binance's listenKey-based authentication for secure user data access.
 * Automatically refreshes listen key to maintain connection.
 */
export class BinanceWebSocketManager extends WebSocketManager {
    private listenKey: string = '';
    private listenKeyRefreshInterval: NodeJS.Timeout | null = null;
    
    /**
     * Refresh listen key every 30 minutes for reliability.
     * Binance requires refresh within 60 minutes, but we use 30 minutes as a safety buffer
     * to account for network delays and ensure the connection remains active.
     */
    private listenKeyRefreshIntervalMs: number = 30 * 60 * 1000;

    constructor(apiKey: string, apiSecret: string, configOverrides?: Partial<WebSocketConfig>) {
        super('Binance', apiKey, apiSecret, configOverrides);
    }

    /**
     * Get Binance User Data Stream WebSocket URL
     * Uses listenKey obtained from REST API
     */
    protected getWebSocketUrl(): string {
        if (!this.listenKey) {
            throw new Error('Listen key not obtained - call authenticate() first');
        }
        return `wss://stream.binance.com:9443/ws/${this.listenKey}`;
    }

    /**
     * Authenticate WebSocket by obtaining listenKey from Binance REST API
     * 
     * The listenKey is valid for 60 minutes and must be refreshed periodically.
     * We refresh every 30 minutes to be safe.
     */
    protected async authenticate(): Promise<void> {
        try {
            // Get listenKey from Binance REST API
            this.listenKey = await this.getListenKey();

            // Start listenKey refresh interval
            this.startListenKeyRefresh();

            console.log(`[${this.exchangeName}] WebSocket authenticated with listenKey`);
        } catch (error) {
            console.error(`[${this.exchangeName}] Failed to obtain listenKey:`, error);
            throw error;
        }
    }

    /**
     * Parse incoming WebSocket message and emit appropriate events
     */
    protected async onMessage(data: WebSocket.RawData): Promise<void> {
        try {
            const text = this.parseRawData(data);
            const message = JSON.parse(text);

            if (message.e === 'executionReport') {
                await this.handleExecutionReport(message as BinanceExecutionReport);
            } else if (message.e === 'outboundAccountPosition') {
                // Balance update - could implement if needed
                console.debug(`[${this.exchangeName}] Account position update received`);
            } else if (message.e === 'listStatus') {
                // Order List status update
                console.debug(`[${this.exchangeName}] Order list status update received`);
            }
        } catch (error) {
            console.error(`[${this.exchangeName}] Error parsing WebSocket message:`, error);
            throw error;
        }
    }

    /**
     * Handle Binance execution report from User Data Stream
     * 
     * Binance sends execution reports for:
     * - New order accepted (status: NEW)
     * - Order partially filled (status: PARTIALLY_FILLED)
     * - Order fully filled (status: FILLED)
     * - Order cancelled (status: CANCELED)
     * - Order rejected (status: REJECTED)
     * - Order expired (status: EXPIRED)
     */
    private async handleExecutionReport(report: BinanceExecutionReport): Promise<void> {
        // Only process fills, partial fills, and cancellations
        const executionType = report.x;

        if (executionType === 'TRADE') {
            // Order has been filled (partial or full)
            const pair = this.formatPair(report.s);
            const order = this.mapBinanceToTradeOrder(report);

            if (report.X === 'FILLED') {
                // Fully filled
                await this.emitOrderFilled(pair, order);
            } else if (report.X === 'PARTIALLY_FILLED') {
                // Partially filled
                await this.emitOrderPartiallyFilled(pair, order);
            }
        } else if (executionType === 'CANCELED') {
            // Order cancelled
            const pair = this.formatPair(report.s);
            await this.emitOrderCancelled(pair, report.i.toString());
        } else if (executionType === 'EXPIRED' || executionType === 'REJECTED') {
            // Order expired or rejected - treat like cancellation
            const pair = this.formatPair(report.s);
            await this.emitOrderCancelled(pair, report.i.toString());
        }
        // Ignore other execution types (PENDING, NEW)
    }

    /**
     * Map Binance execution report to TradeOrder format
     */
    private mapBinanceToTradeOrder(report: BinanceExecutionReport): TradeOrder {
        const filledAmount = parseFloat(report.z); // cumulative filled quantity
        const executedPrice = parseFloat(report.L); // last executed price (0 if no fill yet)
        const commission = parseFloat(report.n) || 0;

        return {
            id: report.i.toString(),
            userId: '', // Set by caller
            botId: '', // Set by caller
            exchangeId: 'binance',
            pair: this.formatPair(report.s),
            side: report.S.toLowerCase() as 'buy' | 'sell',
            type: this.mapOrderType(report.o),
            status: this.mapOrderStatus(report.X),
            price: parseFloat(report.p) || executedPrice,
            amount: parseFloat(report.q),
            filledAmount: filledAmount,
            fee: commission,
            feeCurrency: report.N || 'USDT',
            timestamp: new Date(report.T).toISOString()
        };
    }

    /**
     * Map Binance order type to TradeOrder type
     */
    private mapOrderType(type: string): 'limit' | 'market' {
        switch (type) {
            case 'MARKET':
            case 'MARKET_OCO':
                return 'market';
            case 'LIMIT':
            case 'LIMIT_MAKER':
            case 'STOP_LOSS':
            case 'STOP_LOSS_LIMIT':
            case 'TAKE_PROFIT':
            case 'TAKE_PROFIT_LIMIT':
            default:
                return 'limit';
        }
    }

    /**
     * Map Binance order status to TradeOrder status
     */
    private mapOrderStatus(
        status: string
    ): 'open' | 'filled' | 'canceled' | 'rejected' | 'expired' {
        switch (status) {
            case 'FILLED':
                return 'filled';
            case 'CANCELED':
                return 'canceled';
            case 'REJECTED':
                return 'rejected';
            case 'EXPIRED':
                return 'expired';
            case 'NEW':
            case 'PARTIALLY_FILLED':
            default:
                return 'open';
        }
    }

    /**
     * Format Binance symbol to standard pair format
     * 
     * Binance symbols are concatenated without separator (e.g., BTCUSDT, ETHBUSD).
     * This method converts them to standard format with slash separator (e.g., BTC/USDT, ETH/BUSD).
     */
    private formatPair(symbol: string): string {
        // Strategy 1: Match common stablecoins/quote currencies at the end
        // Binance primarily uses these as quote currencies, ordered by popularity
        // USDT (Tether), BUSD (Binance USD), USDC (USD Coin), etc.
        for (const quote of ['USDT', 'BUSD', 'USDC', 'USDT', 'USDS', 'TUSD', 'DAI']) {
            if (symbol.endsWith(quote)) {
                const base = symbol.slice(0, -quote.length);
                return `${base}/${quote}`;
            }
        }
        
        // Strategy 2: Fallback for other quote currencies (BTC, ETH, BNB)
        // Assumes 3-letter quote currency if no stablecoin match
        if (symbol.length > 4) {
            const base = symbol.slice(0, -3);
            const quote = symbol.slice(-3);
            return `${base}/${quote}`;
        }
        
        // Strategy 3: Return original if parsing fails (shouldn't happen in practice)
        return symbol;
    }

    /**
     * Get listenKey from Binance REST API for User Data Stream authentication
     */
    private async getListenKey(): Promise<string> {
        try {
            const response = await fetch('https://api.binance.com/api/v3/userDataStream', {
                method: 'POST',
                headers: {
                    'X-MBX-APIKEY': this.apiKey
                }
            });

            if (!response.ok) {
                throw new Error(
                    `Failed to get listenKey: ${response.status} ${response.statusText}`
                );
            }

            const data = (await response.json()) as BinanceListenKeyResponse;
            return data.listenKey;
        } catch (error) {
            console.error(`[${this.exchangeName}] Error obtaining listenKey:`, error);
            throw error;
        }
    }

    /**
     * Refresh listenKey to maintain User Data Stream connection
     * Binance listenKey expires after 60 minutes of inactivity
     */
    private async refreshListenKey(): Promise<void> {
        if (!this.listenKey) return;

        try {
            const response = await fetch('https://api.binance.com/api/v3/userDataStream', {
                method: 'PUT',
                headers: {
                    'X-MBX-APIKEY': this.apiKey
                },
                body: new URLSearchParams({ listenKey: this.listenKey }).toString()
            });

            if (!response.ok) {
                console.warn(
                    `[${this.exchangeName}] Failed to refresh listenKey: ${response.status}`
                );
            } else {
                console.debug(`[${this.exchangeName}] listenKey refreshed successfully`);
            }
        } catch (error) {
            console.warn(`[${this.exchangeName}] Error refreshing listenKey:`, error);
            // Non-fatal, connection will continue with current key
        }
    }

    /**
     * Start periodic listenKey refresh
     */
    private startListenKeyRefresh(): void {
        // Refresh every 30 minutes (Binance requires refresh every 60 min)
        this.listenKeyRefreshInterval = setInterval(() => {
            this.refreshListenKey().catch((error) => {
                console.error(
                    `[${this.exchangeName}] Error in listenKey refresh interval:`,
                    error
                );
            });
        }, this.listenKeyRefreshIntervalMs);
    }

    /**
     * Stop listenKey refresh interval
     */
    private stopListenKeyRefresh(): void {
        if (this.listenKeyRefreshInterval) {
            clearInterval(this.listenKeyRefreshInterval);
            this.listenKeyRefreshInterval = null;
        }
    }

    /**
     * Override disconnect to clean up listenKey refresh
     */
    public async disconnect(): Promise<void> {
        this.stopListenKeyRefresh();
        await super.disconnect();
    }
}

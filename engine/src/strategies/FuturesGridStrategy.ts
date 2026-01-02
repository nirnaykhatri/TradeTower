import { BaseStrategy, ExitMode } from './BaseStrategy';
import { FuturesGridConfig } from '../types/strategyConfig';
import { TradeOrder } from '@trading-tower/shared';
import { PRICE_TOLERANCE } from '../constants/strategy.constants';

/**
 * Futures Grid Strategy
 * 
 * Implements a grid trading strategy for leveraged futures trading.
 * Places a grid of limit orders across a defined price range with automatic
 * profit-taking at adjacent grid levels. Supports both arithmetic and geometric
 * grid spacing and includes trailing functionality to adapt to price movements.
 * 
 * Key Features:
 * - Configurable grid quantity and spacing (arithmetic or geometric)
 * - Trailing up/down to follow price movements
 * - Automatic profit-taking on adjacent grid levels
 * - Long, short, and neutral directional modes
 * - Leverage support with stop-loss and take-profit targets
 */
export class FuturesGridStrategy extends BaseStrategy<FuturesGridConfig> {
    private gridLevels: number[] = [];
    private activeOrders: Map<string, TradeOrder> = new Map();
    private currentPositionSize: number = 0;
    private currentLowPrice: number;
    private currentHighPrice: number;
    private gridStepValue: number = 0;

    constructor(bot: any, exchange: any, config: FuturesGridConfig) {
        super(bot, exchange, config);
        this.currentLowPrice = config.lowPrice;
        this.currentHighPrice = config.highPrice;
    }

    /**
     * Get active orders currently managed by this strategy
     * @returns Map of active orders indexed by order ID
     */
    getActiveOrders(): Map<string, TradeOrder> {
        return this.activeOrders;
    }

    /**
     * Initialize the grid by calculating grid levels
     * @returns Promise<void>
     */
    async initialize(): Promise<void> {
        this.calculateGrid();
    }

    /**
     * Calculate grid levels based on configured mode (arithmetic or geometric)
     * Populates gridLevels array and calculates step value
     */
    private calculateGrid(): void {
        const { gridQuantity, gridMode } = this.config;
        this.gridLevels = [];

        if (gridMode === 'ARITHMETIC') {
            this.gridStepValue = (this.currentHighPrice - this.currentLowPrice) / (gridQuantity - 1);
            for (let i = 0; i < gridQuantity; i++) {
                this.gridLevels.push(this.currentLowPrice + i * this.gridStepValue);
            }
        } else {
            const ratio = Math.pow(this.currentHighPrice / this.currentLowPrice, 1 / (gridQuantity - 1));
            for (let i = 0; i < gridQuantity; i++) {
                this.gridLevels.push(this.currentLowPrice * Math.pow(ratio, i));
            }
        }
        this.gridLevels.sort((a, b) => a - b);
    }

    /**
     * Start the grid strategy by placing initial orders across the grid range
     * @returns Promise<void>
     */
    async start(): Promise<void> {
        await this.updateBotStatus('running');
        const ticker = await this.exchange.getTicker(this.bot.pair);
        this.lastPrice = ticker.lastPrice;
        await this.placeInitialGrid(ticker.lastPrice);
    }

    /**
     * Place initial grid of orders at all grid levels
     * Determines buy/sell side based on current price and strategy direction
     * 
     * @param currentPrice Current market price
     * @returns Promise<void>
     */
    private async placeInitialGrid(currentPrice: number): Promise<void> {
        const totalCapital = this.config.investment * this.config.leverage;
        const amountPerLevel = totalCapital / this.config.gridQuantity;

        for (const price of this.gridLevels) {
            let side: 'buy' | 'sell' | null = null;
            if (this.config.strategyType === 'LONG') {
                side = price < currentPrice ? 'buy' : 'sell';
            } else if (this.config.strategyType === 'SHORT') {
                side = price > currentPrice ? 'sell' : 'buy';
            } else {
                if (price < currentPrice) side = 'buy';
                else if (price > currentPrice) side = 'sell';
            }
            if (side) {
                await this.placeGridOrder(side, price, amountPerLevel / price);
            }
        }
    }

    /**
     * Place a single grid order at the specified price and amount
     * @param side Buy or sell side
     * @param price Order price
     * @param amount Order amount
     * @returns Promise<void>
     */
    private async placeGridOrder(side: 'buy' | 'sell', price: number, amount: number): Promise<void> {
        if (this.isPaused) return;
        const adjustedPrice = side === 'buy'
            ? price * (1 - this.feeBuffer)
            : price * (1 + this.feeBuffer);
        try {
            const order = await this.executeOrderWithRetry({
                userId: this.bot.userId,
                botId: this.bot.id,
                pair: this.bot.pair,
                side,
                type: 'limit',
                price: adjustedPrice,
                amount
            });
            this.activeOrders.set(order.id, order);
        } catch (e) {
            await this.handleStrategyError(e as Error, 'placeGridOrder');
        }
    }

    /**
     * Cancel all active orders and clear tracking
     * @returns Promise<void>
     */
    protected async cancelAllActiveOrders(): Promise<void> {
        for (const id of this.activeOrders.keys()) {
            await this.cancelOrderWithRetry(id, this.bot.pair).catch(() => { });
        }
        this.activeOrders.clear();
    }

    /**
     * Handle price updates with trailing grid and exit checks
     * @param price Current market price
     * @returns Promise<void>
     */
    async onPriceUpdate(price: number): Promise<void> {
        if (this.isPaused) return;
        this.lastPrice = price;

        if (this.config.gridMode === 'ARITHMETIC') {
            if (this.config.trailingUp && price > (this.currentHighPrice + this.gridStepValue)) {
                await this.handleTrailingUp();
            }
            if (this.config.trailingDown && price < (this.currentLowPrice - this.gridStepValue)) {
                await this.handleTrailingDown();
            }
        }

        const isShort = this.config.strategyType === 'SHORT';
        if (this.config.takeProfit) {
            const tpHit = isShort
                ? price <= this.config.takeProfit * (1 - this.feeBuffer)
                : price >= this.config.takeProfit * (1 + this.feeBuffer);
            if (tpHit) await this.stop('MARKET_SELL');
        }

        if (this.config.stopLoss) {
            const slHit = isShort
                ? price >= this.config.stopLoss * (1 + this.feeBuffer)
                : price <= this.config.stopLoss * (1 - this.feeBuffer);
            if (slHit) await this.stop('MARKET_SELL');
        }
    }

    /**
     * Handle trailing up of grid when price moves above highest level
     * Removes lowest level, adds new highest level, and executes market buy
     * 
     * @returns Promise<void>
     */
    private async handleTrailingUp(): Promise<void> {
        try {
            this.gridLevels.sort((a, b) => a - b);
            const lowestLevel = this.gridLevels[0];

            for (const [id, order] of this.activeOrders.entries()) {
                if (Math.abs(order.price - lowestLevel) / lowestLevel < PRICE_TOLERANCE) {
                    await this.cancelOrderWithRetry(id, this.bot.pair).catch(() => { });
                    this.activeOrders.delete(id);
                    try {
                        const fill = await this.executeOrderWithRetry({
                            userId: this.bot.userId,
                            botId: this.bot.id,
                            pair: this.bot.pair,
                            side: 'buy',
                            type: 'market',
                            amount: order.amount
                        });
                        this.currentPositionSize += fill.amount;
                        await this.recordTrade(fill);
                    } catch (e) { }
                    break;
                }
            }

            this.gridLevels.shift();
            const newHigh = this.currentHighPrice + this.gridStepValue;
            this.gridLevels.push(newHigh);
            this.currentLowPrice += this.gridStepValue;
            this.currentHighPrice = newHigh;

            const amountPerLevel = (this.config.investment * this.config.leverage) / this.config.gridQuantity;
            await this.placeGridOrder('sell', newHigh, amountPerLevel / newHigh);
        } catch (error) {
            await this.handleStrategyError(error as Error, 'handleTrailingUp');
        }
    }

    /**
     * Handle trailing down of grid when price moves below lowest level
     * Removes highest level, adds new lowest level, and executes market sell
     * 
     * @returns Promise<void>
     */
    private async handleTrailingDown(): Promise<void> {
        try {
            this.gridLevels.sort((a, b) => a - b);
            const highestLevel = this.gridLevels[this.gridLevels.length - 1];

            for (const [id, order] of this.activeOrders.entries()) {
                if (Math.abs(order.price - highestLevel) / highestLevel < PRICE_TOLERANCE) {
                    await this.cancelOrderWithRetry(id, this.bot.pair).catch(() => { });
                    this.activeOrders.delete(id);
                    try {
                        const fill = await this.executeOrderWithRetry({
                            userId: this.bot.userId,
                            botId: this.bot.id,
                            pair: this.bot.pair,
                            side: 'sell',
                            type: 'market',
                            amount: order.amount
                        });
                        this.currentPositionSize -= fill.amount;
                        await this.recordTrade(fill);
                    } catch (e) { }
                    break;
                }
            }

            this.gridLevels.pop();
            const newLow = this.currentLowPrice - this.gridStepValue;
            this.gridLevels.unshift(newLow);
            this.currentLowPrice = newLow;
            this.currentHighPrice -= this.gridStepValue;

            const amountPerLevel = (this.config.investment * this.config.leverage) / this.config.gridQuantity;
            await this.placeGridOrder('buy', newLow, amountPerLevel / newLow);
        } catch (error) {
            await this.handleStrategyError(error as Error, 'handleTrailingDown');
        }
    }

    /**
     * Handle order filled events with position tracking and grid replenishment
     * Places new orders at adjacent grid levels to continue grid trading
     * 
     * @param order The filled TradeOrder
     * @returns Promise<void>
     */
    async onOrderFilled(order: TradeOrder): Promise<void> {
        this.activeOrders.delete(order.id);
        if (order.side === 'buy') this.currentPositionSize += order.amount;
        else this.currentPositionSize -= order.amount;

        await this.recordTrade(order);

        if (this.isPaused) return;

        const gridIndex = this.gridLevels.findIndex(p => Math.abs(p - order.price) / p < 0.001);
        if (gridIndex === -1) return;

        if (order.side === 'buy') {
            if (gridIndex + 1 < this.gridLevels.length) {
                const sellPrice = this.gridLevels[gridIndex + 1];
                await this.placeGridOrder('sell', sellPrice, order.amount);
            }
        } else {
            if (gridIndex - 1 >= 0) {
                const buyPrice = this.gridLevels[gridIndex - 1];
                await this.placeGridOrder('buy', buyPrice, order.amount);
            }
        }
    }

    /**
     * Increase investment and recalculate grid
     * Cancels all active orders and places a new grid at current market price
     * 
     * @param amount Amount to increase investment by
     * @returns Promise<void>
     */
    async increaseInvestment(amount: number): Promise<void> {
        console.log(`[FuturesGrid] Increasing investment by ${amount}. Re-allocating orders...`);
        await this.cancelAllActiveOrders();
        await super.increaseInvestment(amount);
        const ticker = await this.exchange.getTicker(this.bot.pair);
        await this.placeInitialGrid(ticker.lastPrice);
    }
}

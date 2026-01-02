import { DCAFuturesStrategy } from './DCAFuturesStrategy';
import { ComboConfig } from '../types/strategyConfig';
import { TradeOrder } from '@trading-tower/shared';
import { PRICE_TOLERANCE } from '../constants/strategy.constants';

/**
 * Combo Bot Strategy (DCA Entry + Grid Exit)
 * 
 * Implements Bitsgap's COMBO Bot specification:
 * https://bitsgap.com/helpdesk/article/18026929618844-What-is-COMBO-Bot
 * 
 * COMBO combines two distinct order management phases:
 * 
 * 1. **DCA Entry Phase** (inherited from DCAFuturesStrategy):
 *    - Places base order at trigger condition (IMMEDIATELY, PRICE_CHANGE, or MANUAL)
 *    - Places safety orders to average down/up with each drop/rise
 *    - Uses `averagingOrdersStep` to space safety orders
 *    - Uses `averagingOrdersQuantity` to limit number of safety orders
 *    - Stops when max orders or position size reached
 * 
 * 2. **Grid Exit Phase** (profit-taking grid):
 *    - Triggered on first entry fill
 *    - Places multiple grid orders to distribute exit across price levels
 *    - Uses `gridStep` (same % spacing as DCA step in most cases)
 *    - Uses `gridLevels` to define number of exit orders
 *    - Grid is recalculated after each averaging (entry fill)
 * 
 * **Price Range Logic** (per Bitsgap):
 * - LONG:  Buys below/at highPrice (DCA zone), sells above highPrice (Grid zone)
 * - SHORT: Sells above/at lowPrice (DCA zone), buys below lowPrice (Grid zone)
 * 
 * **Trailing Stop Loss** (enabled by default):
 * - Automatically follows favorable price movement
 * - LONG: Tracks highest price, stops if price falls by trailingStopPercent
 * - SHORT: Tracks lowest price, stops if price rises by trailingStopPercent
 * 
 * **Position Closure**:
 * - When Take Profit % or price level is hit → close entire position
 * - When Stop Loss % or price level is hit → close entire position
 * - When trailing stop is triggered → close entire position
 * - Closure is done with MARKET order to ensure execution
 * 
 * **CSV Execution Pattern** (from real bot logs):
 * - Initial: All DCA buy orders + All grid sell orders placed simultaneously
 * - Fill 1: Entry filled → Grid recalculated if position size changed
 * - Fill 2-N: More entries fill, grid continues distributing exit
 * - Final: On TP/SL, all orders canceled, position closed with market order
 */
export class ComboStrategy extends DCAFuturesStrategy {
    /** Grid orders for profit taking */
    private profitGridOrders: Map<string, TradeOrder> = new Map();
    
    /** Highest price reached for trailing stop loss (LONG positions) */
    private highestPrice: number = Number.NEGATIVE_INFINITY;
    
    /** Lowest price reached for trailing stop loss (SHORT positions) */
    private lowestPrice: number = Number.POSITIVE_INFINITY;
    
    /** Current trailing stop loss price */
    private trailingStopPrice: number = 0;

    /**
     * Get active orders: combines DCA entry orders + Grid exit orders
     * @returns Map of all active orders (entry + exit)
     */
    getActiveOrders(): Map<string, TradeOrder> {
        const combined = new Map<string, TradeOrder>(super.getActiveOrders());
        for (const [id, order] of this.profitGridOrders) {
            combined.set(id, order);
        }
        return combined;
    }

    protected get comboConfig(): ComboConfig {
        return this.config as unknown as ComboConfig;
    }

    /**
     * Initialize COMBO strategy
     * Sets up initial price tracking for trailing stop loss
     */
    async initialize(): Promise<void> {
        await super.initialize();
        
        // Initialize price tracking for trailing stop loss
        const ticker = await this.exchange.getTicker(this.bot.pair);
        this.highestPrice = ticker.lastPrice;
        this.lowestPrice = ticker.lastPrice;
        
        // Initialize trailing stop price if trailing is enabled
        if (this.shouldUseTrailingStopLoss()) {
            this.initializeTrailingStopLoss(ticker.lastPrice);
        }
    }

    /**
     * Check if trailing stop loss is enabled (default: true per Bitsgap docs)
     */
    private shouldUseTrailingStopLoss(): boolean {
        return this.comboConfig.trailingStopLoss !== false; // Default true
    }

    /**
     * Initialize trailing stop loss price
     */
    private initializeTrailingStopLoss(currentPrice: number): void {
        const isLong = this.comboConfig.strategy === 'LONG';
        if (isLong) {
            this.trailingStopPrice = currentPrice * (1 - (this.comboConfig.trailingStopPercent || 1) / 100);
        } else {
            this.trailingStopPrice = currentPrice * (1 + (this.comboConfig.trailingStopPercent || 1) / 100);
        }
    }

    /**
     * Handle price updates with TP/SL checking and trailing stop loss adjustment
     * 
     * Checks COMBO-specific exit conditions BEFORE calling parent to avoid double-exit race condition.
     * 
     * Monitors:
     * - Take Profit (fixed price or % based)
     * - Stop Loss with trailing (default enabled)
     * - Grid order placement within price range
     */
    async onPriceUpdate(price: number): Promise<void> {
        if (this.isPaused) return;
        this.lastPrice = price;

        // Update price tracking for trailing stop loss
        this.updateTrailingStopTracking(price);

        // Check COMBO-specific TP/SL FIRST to avoid parent race condition
        if (this.totalAmountFilled > 0) {
            const exitDecision = this.evaluateExitConditions(price);
            if (exitDecision) {
                await this.executeExit(exitDecision);
                return;
            }
        }

        // Now allow parent for liquidation monitoring and DCA logic
        await super.onPriceUpdate(price);
    }

    /**
     * Update trailing stop loss price tracking
     */
    private updateTrailingStopTracking(price: number): void {
        const isLong = this.comboConfig.strategy === 'LONG';
        
        if (isLong) {
            if (price > this.highestPrice) {
                this.highestPrice = price;
                // Update trailing stop when new high is reached
                if (this.shouldUseTrailingStopLoss()) {
                    const newTrailingStop = price * (1 - (this.comboConfig.trailingStopPercent || 1) / 100);
                    if (newTrailingStop > this.trailingStopPrice) {
                        this.trailingStopPrice = newTrailingStop;
                    }
                }
            }
        } else {
            if (price < this.lowestPrice) {
                this.lowestPrice = price;
                // Update trailing stop when new low is reached (short)
                if (this.shouldUseTrailingStopLoss()) {
                    const newTrailingStop = price * (1 + (this.comboConfig.trailingStopPercent || 1) / 100);
                    if (newTrailingStop < this.trailingStopPrice) {
                        this.trailingStopPrice = newTrailingStop;
                    }
                }
            }
        }
    }

    /**
     * Evaluate exit conditions and return decision if exit is needed
     * @returns Exit reason if exit needed, null otherwise
     */
    private evaluateExitConditions(price: number): string | null {
        if (this.checkTakeProfitCondition(price)) {
            return 'Take Profit Target Reached';
        }
        if (this.checkStopLossCondition(price)) {
            return 'Stop Loss Triggered';
        }
        return null;
    }

    /**
     * Check if Take Profit condition is met
     * Supports both percentage and fixed price targets
     */
    private checkTakeProfitCondition(currentPrice: number): boolean {
        if (this.avgEntryPrice === 0) return false;

        const isLong = this.comboConfig.strategy === 'LONG';
        const factor = isLong ? 1 : -1;
        const feePctBuffer = this.feeBuffer * 100 * 2; // round-trip fee allowance
        const priceBufferFactor = isLong
            ? 1 + this.feeBuffer * 2
            : Math.max(0, 1 - this.feeBuffer * 2);

        // Check by price target if specified
        if (this.comboConfig.takeProfitType === 'PRICE' && this.comboConfig.takeProfitPrice) {
            const target = this.comboConfig.takeProfitPrice;
            const adjustedTarget = target * priceBufferFactor;
            const tpReached = isLong ? currentPrice >= adjustedTarget : currentPrice <= adjustedTarget;
            if (tpReached) return true;
        }

        // Check by percentage if specified
        if (this.comboConfig.takeProfitType === 'PERCENT' && this.comboConfig.takeProfitPercent) {
            const pnlPercent = ((currentPrice - this.avgEntryPrice) / this.avgEntryPrice) * 100 * factor;
            if (pnlPercent >= (this.comboConfig.takeProfitPercent + feePctBuffer)) return true;
        }

        // Default to percent-based if type not specified but percent is set
        if (!this.comboConfig.takeProfitType && this.comboConfig.takeProfitPercent) {
            const pnlPercent = ((currentPrice - this.avgEntryPrice) / this.avgEntryPrice) * 100 * factor;
            if (pnlPercent >= (this.comboConfig.takeProfitPercent + feePctBuffer)) return true;
        }

        return false;
    }

    /**
     * Check if Stop Loss condition is met
     * Supports both percentage and fixed price levels (with trailing enabled by default)
     */
    private checkStopLossCondition(currentPrice: number): boolean {
        if (this.avgEntryPrice === 0) return false;

        const isLong = this.comboConfig.strategy === 'LONG';
        const factor = isLong ? 1 : -1;

        // Check trailing stop loss (enabled by default per Bitsgap docs)
        if (this.shouldUseTrailingStopLoss()) {
            const trailingTriggered = isLong ? currentPrice <= this.trailingStopPrice : currentPrice >= this.trailingStopPrice;
            if (trailingTriggered) return true;
        }

        // Check fixed price stop loss if specified
        if (this.comboConfig.stopLossType === 'PRICE' && this.comboConfig.stopLossPrice) {
            const slTriggered = isLong ? currentPrice <= this.comboConfig.stopLossPrice : currentPrice >= this.comboConfig.stopLossPrice;
            if (slTriggered) return true;
        }

        // Check percentage-based stop loss if specified
        if (this.comboConfig.stopLossType === 'PERCENT' && this.comboConfig.stopLossPercent) {
            const lossPercent = ((currentPrice - this.avgEntryPrice) / this.avgEntryPrice) * 100 * factor;
            if (lossPercent <= -this.comboConfig.stopLossPercent) return true;
        }

        // Default to percent-based if type not specified but percent is set
        if (!this.comboConfig.stopLossType && this.comboConfig.stopLossPercent) {
            const lossPercent = ((currentPrice - this.avgEntryPrice) / this.avgEntryPrice) * 100 * factor;
            if (lossPercent <= -this.comboConfig.stopLossPercent) return true;
        }

        return false;
    }

    /**
     * Handle order fill event with profit grid management
     * 
     * When entry (DCA Buy/Sell) is filled:
     * - Update position tracking
     * - Recalculate profit grid
     * 
     * When exit (Grid) is filled:
     * - Record profit
     * - Remove from grid tracking
     */
    async onOrderFilled(order: TradeOrder): Promise<void> {
        // Let DCA strategy handle entry-side logic (position averaging, safety orders)
        await super.onOrderFilled(order);

        // Determine if this was an entry or exit order
        const isEntry = (this.comboConfig.strategy === 'LONG' && order.side === 'buy') ||
            (this.comboConfig.strategy === 'SHORT' && order.side === 'sell');

        if (isEntry) {
            console.log(`[Combo] Entry filled at ${order.price}. Position: ${this.totalAmountFilled}. Recalculating profit grid.`);
            // On entry fill: recalculate and place profit grid
            await this.placeProfitGrid();
        } else {
            // On profit grid fill: record and remove from tracking
            if (this.profitGridOrders.has(order.id)) {
                this.profitGridOrders.delete(order.id);
                console.log(`[Combo] Profit grid level filled at ${order.price}. Remaining position.`);
            }
        }
    }

    /**
     * Place grid of profit-taking limit orders
     * 
     * Per Bitsgap COMBO specification:
     * - LONG: Grid orders above entry price to take profit (uses +gridStep for each level)
     * - SHORT: Grid orders below entry price to take profit (uses -gridStep for each level)
     * 
     * Price boundaries are SOFT limits:
     * - LONG: Grid should ideally be above highPrice (profit zone), but minimum above entry
     * - SHORT: Grid should ideally be below lowPrice (profit zone), but minimum below entry
     * 
     * CSV execution pattern shows:
     * - Multiple grid levels placed simultaneously on first entry fill
     * - Grid levels calculated from average entry price
     * - Each grid level sized to distribute total position evenly
     */
    private async placeProfitGrid(): Promise<void> {
        try {
            // Cancel existing grid orders to recalculate (necessary when averaging)
            for (const id of this.profitGridOrders.keys()) {
                try {
                    await this.cancelOrderWithRetry(id, this.bot.pair);
                } catch (e) {
                    // Ignore if already filled/gone
                }
            }
            this.profitGridOrders.clear();

            const totalPos = this.totalAmountFilled;
            if (totalPos <= 0) return;

            const config = this.comboConfig;
            const isLong = config.strategy === 'LONG';

            // Amount per grid level (distribute current position evenly across grid levels)
            const amountPerLevel = totalPos / config.gridLevels;

            // Base price for grid calculation: use average entry price as reference
            const basePrice = this.avgEntryPrice > 0 ? this.avgEntryPrice : this.lastPrice;

            let placedCount = 0;

            // Place grid levels starting from first level (i=1)
            for (let i = 1; i <= config.gridLevels; i++) {
                // Calculate grid level price: each level moves by gridStep %
                // LONG: gridStep moves UPWARD (profitable sells above entry)
                // SHORT: gridStep moves DOWNWARD (profitable buys below entry)
                const direction = isLong ? 1 : -1;
                const gridPrice = basePrice * (1 + (config.gridStep * i / 100) * direction);

                // Soft price boundary validation
                // Allow some flexibility but warn if significantly outside range
                const aboveHighPrice = gridPrice > config.highPrice;
                const belowLowPrice = gridPrice < config.lowPrice;

                if ((isLong && belowLowPrice) || (!isLong && aboveHighPrice)) {
                    console.warn(`[Combo] Grid level ${i} price ${gridPrice} outside trading range [${config.lowPrice}, ${config.highPrice}]. Skipping.`);
                    continue;
                }

                const side = isLong ? 'sell' : 'buy';
                const adjustedPrice = side === 'sell'
                    ? gridPrice * (1 + this.feeBuffer)
                    : gridPrice * (1 - this.feeBuffer);

                try {
                    const order = await this.executeOrderWithRetry({
                        userId: this.bot.userId,
                        botId: this.bot.id,
                        pair: this.bot.pair,
                        side,
                        type: 'limit',
                        price: adjustedPrice,
                        amount: amountPerLevel
                    });
                    this.profitGridOrders.set(order.id, order);
                    placedCount++;
                    console.log(`[Combo] Placed grid level ${i}/${config.gridLevels}: ${side} ${amountPerLevel} @ ${gridPrice}`);
                } catch (e) {
                    console.error(`[Combo] Failed to place grid level ${i}:`, (e as Error)?.message);
                }
            }

            console.log(`[Combo] Grid recalculation complete: ${placedCount}/${config.gridLevels} levels placed. Total position: ${totalPos}`);
        } catch (error) {
            await this.handleStrategyError(error as Error, 'placeProfitGrid');
        }
    }

    /**
     * Execute full position exit
     * 
     * Per Bitsgap docs: "When either the Take Profit or Stop Loss level is reached, the bot will:
     * - Cancel all active orders
     * - Place a market order to close the position"
     * 
     * Clears both DCA entry orders and profit grid orders.
     */
    protected async executeExit(reason: string): Promise<void> {
        console.log(`[Combo] Exiting position: ${reason}`);
        
        try {
            // Cancel all active orders (both entry and grid)
            const allOrders = this.getActiveOrders();
            for (const [id, order] of allOrders) {
                await this.cancelOrderWithRetry(id, order.pair).catch((e) => {
                    console.warn(`[Combo] Failed to cancel order ${id}:`, e?.message);
                });
            }

            // Close entire position at market price
            if (this.totalAmountFilled > 0) {
                const side = this.comboConfig.strategy === 'LONG' ? 'sell' : 'buy';
                const exitOrder = await this.executeOrderWithRetry({
                    userId: this.bot.userId,
                    botId: this.bot.id,
                    pair: this.bot.pair,
                    side,
                    type: 'market',
                    amount: this.totalAmountFilled
                });
                await this.recordTrade(exitOrder);
            }

            // Clear tracking
            this.profitGridOrders.clear();
            this.totalAmountFilled = 0;
            this.avgEntryPrice = 0;

            // Update bot status
            await this.updateBotStatus('stopped');
        } catch (error) {
            await this.handleStrategyError(error as Error, `executeExit(${reason})`);
            throw error;
        }
    }
}

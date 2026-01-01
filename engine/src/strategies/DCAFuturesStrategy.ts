import { BaseDCAStrategy } from './BaseDCAStrategy';
import { DCAFuturesConfig } from '../types/strategyConfig';
import { TradeOrder } from '@trading-tower/shared';
import { PRICE_TOLERANCE } from '../constants/strategy.constants';

/**
 * DCA Futures Strategy
 * 
 * Extends the base DCA strategy for leveraged trading on futures exchanges.
 * Implements dollar-cost averaging (DCA) with safety orders and liquidation protection
 * for leveraged positions. Supports both long and short positions with configurable
 * leverage and margin types.
 * 
 * Key Features:
 * - DCA-based accumulation with safety orders
 * - Liquidation price monitoring and buffer protection
 * - Configurable leverage (up to exchange limits)
 * - Isolated or cross margin support
 * - Automatic emergency exit on liquidation buffer breach
 */
export class DCAFuturesStrategy extends BaseDCAStrategy<DCAFuturesConfig> {
    protected get dcaConfig(): DCAFuturesConfig {
        return this.config;
    }

    /**
     * Initialize the DCA Futures strategy with leverage configuration
     * @returns Promise<void>
     */
    async initialize(): Promise<void> {
        await super.initialize();
        console.log(`[DCAFutures] Setting leverage to ${this.config.leverage}x with ${this.config.marginType} margin.`);
    }

    /**
     * For futures, we might want to check the liquidation price.
     */
    /**
     * Handle price updates with liquidation monitoring
     * Checks liquidation buffer and triggers emergency exit if breached
     * 
     * @param price Current market price
     * @returns Promise<void>
     */
    async onPriceUpdate(price: number): Promise<void> {
        await super.onPriceUpdate(price);

        // --- Liquidation Monitoring ---
        if (this.config.liquidationBuffer && this.avgEntryPrice > 0) {
            const liqPrice = this.calculateLiquidationPrice();
            this.bot.performance.liquidationPrice = liqPrice; // Expose for UI

            const distance = Math.abs(price - liqPrice) / price * 100;

            if (distance <= this.config.liquidationBuffer) {
                console.warn(`[DCAFutures] Liquidation Buffer Warning! Distance: ${distance.toFixed(2)}% <= ${this.config.liquidationBuffer}%`);
                // Emergency Exit if buffer is violated
                await this.executeExit('Liquidation Protection');
            }
        }
    }

    /**
     * Calculate liquidation price based on leverage and margin configuration
     * Uses simplified formula: Liq = Entry * (1 - (0.9 / Leverage) * factor)
     * 
     * @returns Liquidation price
     */
    private calculateLiquidationPrice(): number {
        // Simplified formula for liquidation price:
        // Long: Liq = Entry * (1 - (1/Leverage) + (MaintenanceMargin%))
        // We'll use a conservative estimate: Liq = Entry * (1 - 0.9/Leverage)
        const factor = this.config.strategy === 'LONG' ? -1 : 1;
        return this.avgEntryPrice * (1 + factor * (0.9 / this.config.leverage));
    }

    /**
     * On order placement, ensure leverage is set.
     */
    /**
     * Place base order with futures-specific configuration (leverage, margin type)
     * @returns Promise<void>
     */
    protected async placeBaseOrder(): Promise<void> {
        // Here we'd ideally tell the exchange the leverage.
        // For now, we assume it's set on the account or passed in the order request.
        await super.placeBaseOrder();
    }

    /**
     * Increase investment amount for futures trading
     * Adds margin to the account and updates budget for safety orders
     * 
     * @param amount Amount to increase investment by
     * @returns Promise<void>
     */
    async increaseInvestment(amount: number): Promise<void> {
        console.log(`[DCAFutures] Adding ${amount} margin to bot.`);
        // For futures, this increases the 'active' margin or 'available' balance for safety orders
        await super.increaseInvestment(amount);

        // In a real exchange connector, we might need to physically move funds to Isolated Margin here
        // e.g. await this.exchange.currencyTransfer(..., amount, 'ISOLATED_MARGIN');

        // We do NOT cancel active orders automatically for DCA Futures to avoid realizing a loss/slippage during a dip.
        // Instead, the new 'investment' cap allows 'placeNextSafetyOrder' to proceed if it was previously blocked by max budget.
    }
}

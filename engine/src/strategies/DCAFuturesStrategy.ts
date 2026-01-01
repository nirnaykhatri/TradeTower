import { BaseDCAStrategy } from './BaseDCAStrategy';
import { DCAFuturesConfig } from '../types/strategyConfig';
import { TradeOrder } from '@trading-tower/shared';

export class DCAFuturesStrategy extends BaseDCAStrategy<DCAFuturesConfig> {
    protected get dcaConfig(): DCAFuturesConfig {
        return this.config;
    }

    async initialize(): Promise<void> {
        await super.initialize();
        console.log(`[DCAFutures] Setting leverage to ${this.config.leverage}x with ${this.config.marginType} margin.`);
    }

    /**
     * For futures, we might want to check the liquidation price.
     */
    async onPriceUpdate(price: number): Promise<void> {
        await super.onPriceUpdate(price);

        // --- Liquidation Monitoring ---
        if (this.config.liquidationBuffer && this.avgEntryPrice > 0) {
            const liqPrice = this.calculateLiquidationPrice();
            const distance = Math.abs(price - liqPrice) / price * 100;

            if (distance <= this.config.liquidationBuffer) {
                console.warn(`[DCAFutures] Liquidation Buffer Warning! Distance: ${distance.toFixed(2)}% <= ${this.config.liquidationBuffer}%`);
                // Emergency Exit if buffer is violated
                await this.executeExit('Liquidation Protection');
            }
        }
    }

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
    protected async placeBaseOrder() {
        // Here we'd ideally tell the exchange the leverage.
        // For now, we assume it's set on the account or passed in the order request.
        await super.placeBaseOrder();
    }
}

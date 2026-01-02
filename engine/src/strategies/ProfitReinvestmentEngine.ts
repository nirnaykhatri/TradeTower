/**
 * Profit Reinvestment Engine
 * 
 * Responsible for:
 * - Calculating realized profit from trades
 * - Determining reinvestment amounts and percentages
 * - Distributing reinvested profit across base and safety orders
 * - Updating investment configuration
 */

export interface ReinvestmentConfig {
    enabled: boolean;
    profitPercent?: number; // Percentage of profit to reinvest (default 100%)
    baseOrderAmount: number;
    averagingOrdersAmount: number;
    investment: number;
}

export interface ReinvestmentResult {
    totalProfit: number;
    reinvestAmount: number;
    newBaseOrderAmount: number;
    newAveragingOrdersAmount: number;
    newTotalInvestment: number;
}

export class ProfitReinvestmentEngine {
    private config: ReinvestmentConfig;

    constructor(config: ReinvestmentConfig) {
        this.config = config;
    }

    /**
     * Calculate reinvestment when position is closed
     * 
     * Distributes reinvested profit based on original allocation ratio.
     * 
     * Example: If base:safety = 30:70, reinvest maintains that ratio
     */
    calculateReinvestment(realizedProfit: number): ReinvestmentResult {
        const result: ReinvestmentResult = {
            totalProfit: realizedProfit,
            reinvestAmount: 0,
            newBaseOrderAmount: this.config.baseOrderAmount,
            newAveragingOrdersAmount: this.config.averagingOrdersAmount,
            newTotalInvestment: this.config.investment
        };

        // Only reinvest if profitable
        if (!this.config.enabled || realizedProfit <= 0) {
            return result;
        }

        // Calculate percentage to reinvest
        const reinvestPercent = this.config.profitPercent ?? 100;
        const reinvestAmount = realizedProfit * (reinvestPercent / 100);

        // Calculate original allocation ratio
        const totalAllocated = this.config.baseOrderAmount + this.config.averagingOrdersAmount;
        if (totalAllocated === 0) {
            console.warn('[ProfitReinvestmentEngine] Cannot reinvest: no allocation configured');
            return result;
        }

        const baseOrderPercent = this.config.baseOrderAmount / totalAllocated;
        const safetyOrderPercent = this.config.averagingOrdersAmount / totalAllocated;

        // Distribute reinvested amount according to original ratio
        const baseIncrease = reinvestAmount * baseOrderPercent;
        const safetyIncrease = reinvestAmount * safetyOrderPercent;

        result.reinvestAmount = reinvestAmount;
        result.newBaseOrderAmount = this.config.baseOrderAmount + baseIncrease;
        result.newAveragingOrdersAmount = this.config.averagingOrdersAmount + safetyIncrease;
        result.newTotalInvestment = this.config.investment + reinvestAmount;

        console.log(`[ProfitReinvestmentEngine] Reinvesting ${reinvestAmount.toFixed(2)} (${reinvestPercent}% of ${realizedProfit.toFixed(2)} profit)`);
        console.log(`  Distribution: ${(baseOrderPercent * 100).toFixed(1)}% to base (+${baseIncrease.toFixed(2)}), ${(safetyOrderPercent * 100).toFixed(1)}% to safety (+${safetyIncrease.toFixed(2)})`);

        return result;
    }

    /**
     * Apply reinvestment to configuration
     */
    applyReinvestment(result: ReinvestmentResult): void {
        this.config.baseOrderAmount = result.newBaseOrderAmount;
        this.config.averagingOrdersAmount = result.newAveragingOrdersAmount;
        this.config.investment = result.newTotalInvestment;
    }

    /**
     * Get current allocation ratio
     */
    getAllocationRatio(): { basePercent: number; safetyPercent: number } {
        const total = this.config.baseOrderAmount + this.config.averagingOrdersAmount;
        return {
            basePercent: total > 0 ? (this.config.baseOrderAmount / total) * 100 : 0,
            safetyPercent: total > 0 ? (this.config.averagingOrdersAmount / total) * 100 : 0
        };
    }

    /**
     * Update configuration
     */
    updateConfig(partialConfig: Partial<ReinvestmentConfig>): void {
        this.config = { ...this.config, ...partialConfig };
    }

    /**
     * Get current configuration
     */
    getConfig(): ReinvestmentConfig {
        return this.config;
    }
}

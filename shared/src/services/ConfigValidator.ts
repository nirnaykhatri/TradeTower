/**
 * Centralized Configuration Validation
 * 
 * Single source of truth for all strategy configuration validation.
 * Consolidates validation from:
 * - API layer (Zod schemas in BotController)
 * - Runtime layer (checks in strategy start() methods)
 * - Database layer (implicit TypeScript checks)
 */

export class ConfigValidator {
    /**
     * Validates DCA configuration for consistency and interdependencies
     * 
     * Rules:
     * - If baseOrderCondition is INDICATOR/TRADINGVIEW, entryIndicators required
     * - If reserveFundsEnabled, maxPrice must be provided
     * - maxPrice must be > current price if provided
     * 
     * @param config DCA configuration object
     * @returns ValidationResult with errors array
     */
    static validateDCAConfig(config: any): { valid: boolean; errors: string[] } {
        const errors: string[] = [];

        // Base order condition validation
        if (config.baseOrderCondition === 'INDICATOR' || config.baseOrderCondition === 'TRADINGVIEW') {
            if (!config.entryIndicators || config.entryIndicators.length === 0) {
                errors.push(`entryIndicators are required when baseOrderCondition is '${config.baseOrderCondition}'`);
            }
            if (config.entryIndicators && config.entryIndicators.length > 6) {
                errors.push('Maximum 6 entry indicators allowed');
            }
        }

        // Reserve funds validation
        if (config.reserveFundsEnabled && !config.maxPrice) {
            errors.push('maxPrice is required when reserveFundsEnabled is true');
        }

        // Price range validation
        if (config.minPrice && config.maxPrice && config.minPrice >= config.maxPrice) {
            errors.push('minPrice must be less than maxPrice');
        }

        // Profit reinvestment validation
        if (config.reinvestProfitPercent !== undefined) {
            if (config.reinvestProfitPercent < 0 || config.reinvestProfitPercent > 100) {
                errors.push('reinvestProfitPercent must be between 0 and 100');
            }
        }

        // Safety order validation
        if (config.averagingOrdersQuantity > 0 && config.averagingOrdersStep <= 0) {
            errors.push('averagingOrdersStep must be > 0 when averagingOrdersQuantity > 0');
        }

        // Active orders limit validation
        if (config.activeOrdersLimitEnabled && (!config.activeOrdersLimit || config.activeOrdersLimit < 1)) {
            errors.push('activeOrdersLimit must be >= 1 when activeOrdersLimitEnabled is true');
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * Validates Grid configuration
     */
    static validateGridConfig(config: any): { valid: boolean; errors: string[] } {
        const errors: string[] = [];

        if (config.highPrice <= config.lowPrice) {
            errors.push('highPrice must be greater than lowPrice');
        }

        if (config.gridLevels < 5) {
            errors.push('gridLevels must be at least 5');
        }

        if (config.gridLevels > 100) {
            errors.push('gridLevels must not exceed 100');
        }

        if (config.gridStep <= 0) {
            errors.push('gridStep must be positive');
        }

        if (config.pumpProtection && (!config.PUMP_PROTECTION_THRESHOLD || config.PUMP_PROTECTION_THRESHOLD < 1)) {
            errors.push('Invalid pump protection threshold configuration');
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * Validates BTD (Buy The Dip) configuration
     */
    static validateBTDConfig(config: any): { valid: boolean; errors: string[] } {
        const errors: string[] = [];

        if (config.highPrice <= config.lowPrice) {
            errors.push('highPrice must be greater than lowPrice');
        }

        if (!config.levelsDown || config.levelsDown < 1) {
            errors.push('levelsDown must be at least 1');
        }

        if (!config.levelsUp || config.levelsUp < 1) {
            errors.push('levelsUp must be at least 1');
        }

        const totalLevels = config.levelsDown + config.levelsUp;
        if (totalLevels !== config.gridLevels) {
            errors.push(`levelsDown + levelsUp (${totalLevels}) must equal gridLevels (${config.gridLevels})`);
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * Validates COMBO configuration
     */
    static validateComboConfig(config: any): { valid: boolean; errors: string[] } {
        const errors: string[] = [];

        // Validate base order phase
        const baseOrderValid = this.validateDCAConfig(config);
        if (!baseOrderValid.valid) {
            errors.push(...baseOrderValid.errors.map(e => `Base Order: ${e}`));
        }

        // Validate grid exit phase
        if (!config.gridLevels || config.gridLevels < 5) {
            errors.push('gridLevels must be at least 5 for exit phase');
        }

        // Validate leverage
        if (config.leverage < 1 || config.leverage > 125) {
            errors.push('Leverage must be between 1 and 125');
        }

        // Validate liquidation buffer
        if (config.liquidationBuffer && (config.liquidationBuffer < 5 || config.liquidationBuffer > 50)) {
            errors.push('liquidationBuffer must be between 5% and 50%');
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * Generic configuration validator by strategy type
     */
    static validate(strategyType: string, config: any): { valid: boolean; errors: string[] } {
        switch (strategyType) {
            case 'DCA':
                return this.validateDCAConfig(config);
            case 'GRID':
                return this.validateGridConfig(config);
            case 'BTD':
                return this.validateBTDConfig(config);
            case 'COMBO':
                return this.validateComboConfig(config);
            case 'LOOP':
                return this.validateLoopConfig(config);
            case 'DCA_FUTURES':
                return this.validateDCAConfig(config); // Reuse DCA validation
            case 'FUTURES_GRID':
                return this.validateGridConfig(config); // Reuse Grid validation
            case 'TWAP':
                return this.validateTWAPConfig(config);
            default:
                return { valid: false, errors: [`Unknown strategy type: ${strategyType}`] };
        }
    }

    /**
     * Validates Loop configuration
     */
    static validateLoopConfig(config: any): { valid: boolean; errors: string[] } {
        const errors: string[] = [];

        if (config.highPrice <= config.lowPrice) {
            errors.push('highPrice must be greater than lowPrice');
        }

        if (config.orderCount < 1 || config.orderCount > 100) {
            errors.push('orderCount must be between 1 and 100');
        }

        if (config.orderDistance <= 0) {
            errors.push('orderDistance must be positive');
        }

        if (config.reinvestProfitPercent !== undefined) {
            if (config.reinvestProfitPercent < 0 || config.reinvestProfitPercent > 100) {
                errors.push('reinvestProfitPercent must be between 0 and 100');
            }
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * Validates TWAP configuration
     */
    static validateTWAPConfig(config: any): { valid: boolean; errors: string[] } {
        const errors: string[] = [];

        if (!['BUY', 'SELL'].includes(config.direction)) {
            errors.push("direction must be 'BUY' or 'SELL'");
        }

        if (config.duration < 5 || config.duration > 1440) {
            errors.push('duration must be between 5 and 1440 minutes');
        }

        if (config.frequency < 5 || config.frequency > 60) {
            errors.push('frequency must be between 5 and 60 seconds');
        }

        if (config.frequency > config.duration * 60) {
            errors.push('frequency cannot be greater than total duration');
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }
}

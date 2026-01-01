/**
 * Input validation utilities for trading operations
 */

import { ValidationError } from '../errors';

/**
 * Validate a required string field
 */
export function validateRequired(value: any, fieldName: string): void {
    if (value === undefined || value === null || value === '') {
        throw new ValidationError(`${fieldName} is required`, fieldName);
    }
}

/**
 * Validate a positive number
 */
export function validatePositiveNumber(value: number, fieldName: string): void {
    if (typeof value !== 'number' || isNaN(value) || value <= 0) {
        throw new ValidationError(`${fieldName} must be a positive number`, fieldName);
    }
}

/**
 * Validate a non-negative number
 */
export function validateNonNegativeNumber(value: number, fieldName: string): void {
    if (typeof value !== 'number' || isNaN(value) || value < 0) {
        throw new ValidationError(`${fieldName} must be a non-negative number`, fieldName);
    }
}

/**
 * Validate a number within a range
 */
export function validateRange(
    value: number,
    min: number,
    max: number,
    fieldName: string
): void {
    if (typeof value !== 'number' || isNaN(value) || value < min || value > max) {
        throw new ValidationError(
            `${fieldName} must be between ${min} and ${max}`,
            fieldName
        );
    }
}

/**
 * Validate percentage (0-100)
 */
export function validatePercentage(value: number, fieldName: string): void {
    validateRange(value, 0, 100, fieldName);
}

/**
 * Validate trading pair format (e.g., BTC/USD, ETH/USDT)
 */
export function validateTradingPair(pair: string): void {
    if (!pair || typeof pair !== 'string') {
        throw new ValidationError('Trading pair is required', 'pair');
    }
    
    const pairRegex = /^[A-Z0-9]+\/[A-Z0-9]+$/;
    if (!pairRegex.test(pair)) {
        throw new ValidationError(
            'Trading pair must be in format BASE/QUOTE (e.g., BTC/USD)',
            'pair'
        );
    }
}

/**
 * Validate UUID format
 */
export function validateUUID(id: string, fieldName: string = 'id'): void {
    if (!id || typeof id !== 'string') {
        throw new ValidationError(`${fieldName} is required`, fieldName);
    }
    
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
        throw new ValidationError(`${fieldName} must be a valid UUID`, fieldName);
    }
}

/**
 * Validate order side
 */
export function validateOrderSide(side: string): void {
    const validSides = ['buy', 'sell'];
    if (!validSides.includes(side?.toLowerCase())) {
        throw new ValidationError('Order side must be "buy" or "sell"', 'side');
    }
}

/**
 * Validate order type
 */
export function validateOrderType(type: string): void {
    const validTypes = ['market', 'limit'];
    if (!validTypes.includes(type?.toLowerCase())) {
        throw new ValidationError('Order type must be "market" or "limit"', 'type');
    }
}

/**
 * Validate investment amount
 */
export function validateInvestmentAmount(amount: number, minAmount: number = 10): void {
    validatePositiveNumber(amount, 'investment amount');
    
    if (amount < minAmount) {
        throw new ValidationError(
            `Investment amount must be at least ${minAmount}`,
            'amount'
        );
    }
}

/**
 * Validate grid configuration
 */
export function validateGridConfig(config: {
    lowPrice: number;
    highPrice: number;
    gridLevels: number;
    investment: number;
}): void {
    validatePositiveNumber(config.lowPrice, 'lowPrice');
    validatePositiveNumber(config.highPrice, 'highPrice');
    validatePositiveNumber(config.gridLevels, 'gridLevels');
    validateInvestmentAmount(config.investment);

    if (config.lowPrice >= config.highPrice) {
        throw new ValidationError('lowPrice must be less than highPrice', 'lowPrice');
    }

    if (config.gridLevels < 2) {
        throw new ValidationError('gridLevels must be at least 2', 'gridLevels');
    }

    if (config.gridLevels > 100) {
        throw new ValidationError('gridLevels cannot exceed 100', 'gridLevels');
    }
}

/**
 * Validate DCA configuration
 */
export function validateDCAConfig(config: {
    baseOrderAmount: number;
    averagingOrdersAmount: number;
    averagingOrdersQuantity: number;
    averagingOrdersStep: number;
    investment: number;
}): void {
    validatePositiveNumber(config.baseOrderAmount, 'baseOrderAmount');
    validatePositiveNumber(config.averagingOrdersAmount, 'averagingOrdersAmount');
    validatePositiveNumber(config.averagingOrdersQuantity, 'averagingOrdersQuantity');
    validatePositiveNumber(config.averagingOrdersStep, 'averagingOrdersStep');
    validateInvestmentAmount(config.investment);

    const totalRequired =
        config.baseOrderAmount +
        config.averagingOrdersAmount * config.averagingOrdersQuantity;

    if (totalRequired > config.investment) {
        throw new ValidationError(
            `Total required (${totalRequired}) exceeds investment (${config.investment})`,
            'investment'
        );
    }
}

/**
 * Validate leverage for futures trading
 */
export function validateLeverage(leverage: number): void {
    validatePositiveNumber(leverage, 'leverage');
    
    if (leverage < 1 || leverage > 125) {
        throw new ValidationError('Leverage must be between 1 and 125', 'leverage');
    }
}

/**
 * Sanitize string input to prevent injection
 */
export function sanitizeString(input: string, maxLength: number = 255): string {
    if (typeof input !== 'string') {
        return '';
    }
    
    return input
        .trim()
        .slice(0, maxLength)
        .replace(/[<>]/g, ''); // Remove potential HTML/script tags
}

/**
 * Validate database query parameters
 */
export function validateQueryParams(params: { [key: string]: any }): void {
    for (const [key, value] of Object.entries(params)) {
        if (typeof value === 'string' && value.includes(';')) {
            throw new ValidationError(
                `Invalid character in parameter ${key}`,
                key
            );
        }
    }
}

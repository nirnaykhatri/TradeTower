/**
 * Centralized Profit Calculator Service
 * 
 * Consolidates profit calculation logic across all strategies and API endpoints.
 * Ensures consistent profit calculation across the entire platform.
 */

import { TradeOrder } from '../index';
import { ILogger } from './DependencyInjection';

export interface ProfitCalculationResult {
    profit: number;
    profitPercent: number;
    avgBuyPrice: number;
    buyOrderCount: number;
    totalBuyAmount: number;
    totalBuyCost: number;
    totalFees: number;
}

/**
 * Profit Calculator
 * 
 * Provides methods to calculate realized profit for completed trades
 * with support for weighted average buy prices and fee accounting.
 */
export class ProfitCalculator {
    /**
     * Calculate profit for a sell order based on matching buy orders
     * 
     * Formula: profit = (sellPrice - avgBuyPrice) * sellAmount - totalFees
     * 
     * @param sellOrder The sell order to calculate profit for
     * @param allOrders All orders from the same bot/pair (for matching buys)
     * @returns ProfitCalculationResult with detailed profit breakdown
     * 
     * @example
     * ```typescript
     * const result = profitCalculator.calculateForSellOrder(sellOrder, allOrders);
     * console.log(`Profit: ${result.profit} (${result.profitPercent.toFixed(2)}%)`);
     * ```
     */
    calculateForSellOrder(
        sellOrder: TradeOrder,
        allOrders: TradeOrder[]
    ): ProfitCalculationResult {
        // Validate sell order
        if (sellOrder.side !== 'sell' || sellOrder.status !== 'filled') {
            return {
                profit: 0,
                profitPercent: 0,
                avgBuyPrice: 0,
                buyOrderCount: 0,
                totalBuyAmount: 0,
                totalBuyCost: 0,
                totalFees: 0
            };
        }

        // Find matching buy orders (before this sell)
        const buyOrders = allOrders.filter(
            o => o.side === 'buy' && 
                 o.status === 'filled' && 
                 new Date(o.timestamp) < new Date(sellOrder.timestamp)
        );

        if (buyOrders.length === 0) {
            return {
                profit: 0,
                profitPercent: 0,
                avgBuyPrice: 0,
                buyOrderCount: 0,
                totalBuyAmount: 0,
                totalBuyCost: 0,
                totalFees: 0
            };
        }

        // Calculate weighted average buy price
        let totalBuyAmount = 0;
        let totalBuyCost = 0;

        for (const buyOrder of buyOrders) {
            const buyAmount = buyOrder.filledAmount || buyOrder.amount;
            totalBuyAmount += buyAmount;
            totalBuyCost += buyAmount * buyOrder.price;
        }

        const avgBuyPrice = totalBuyAmount > 0 ? totalBuyCost / totalBuyAmount : 0;

        // Calculate profit including fees
        const sellAmount = sellOrder.filledAmount || sellOrder.amount;
        const totalBuyFees = buyOrders.reduce((sum, o) => sum + (o.fee || 0), 0);
        const totalFees = totalBuyFees + (sellOrder.fee || 0);

        const profit = (sellOrder.price - avgBuyPrice) * sellAmount - totalFees;
        const profitPercent = avgBuyPrice > 0 ? (profit / (avgBuyPrice * sellAmount)) * 100 : 0;

        return {
            profit,
            profitPercent,
            avgBuyPrice,
            buyOrderCount: buyOrders.length,
            totalBuyAmount,
            totalBuyCost,
            totalFees
        };
    }

    /**
     * Calculate profit for a completed buy-sell pair
     * 
     * @param buyOrder The initial buy order
     * @param sellOrder The subsequent sell order
     * @returns Profit in quote currency
     * 
     * @example
     * ```typescript
     * const profit = profitCalculator.calculateForCompletedTrade(buyOrder, sellOrder);
     * console.log(`Trade profit: ${profit}`);
     * ```
     */
    calculateForCompletedTrade(
        buyOrder: TradeOrder,
        sellOrder: TradeOrder
    ): number {
        if (buyOrder.status !== 'filled' || sellOrder.status !== 'filled') {
            return 0;
        }

        const buyAmount = buyOrder.filledAmount || buyOrder.amount;
        const sellAmount = sellOrder.filledAmount || sellOrder.amount;
        const amount = Math.min(buyAmount, sellAmount);

        const profit = (sellOrder.price - buyOrder.price) * amount - (buyOrder.fee || 0) - (sellOrder.fee || 0);
        return profit;
    }

    /**
     * Calculate average entry price from multiple buy orders
     * 
     * @param buyOrders Array of buy orders
     * @returns Volume-weighted average buy price
     */
    calculateAverageEntryPrice(buyOrders: TradeOrder[]): number {
        if (buyOrders.length === 0) return 0;

        let totalAmount = 0;
        let totalCost = 0;

        for (const order of buyOrders) {
            if (order.side === 'buy' && order.status === 'filled') {
                const amount = order.filledAmount || order.amount;
                totalAmount += amount;
                totalCost += amount * order.price;
            }
        }

        return totalAmount > 0 ? totalCost / totalAmount : 0;
    }

    /**
     * Calculate unrealized profit for open positions
     * 
     * @param buyOrders Array of filled buy orders
     * @param currentPrice Current market price
     * @returns Unrealized profit including fees
     */
    calculateUnrealizedProfit(
        buyOrders: TradeOrder[],
        currentPrice: number
    ): number {
        const avgPrice = this.calculateAverageEntryPrice(buyOrders);
        if (avgPrice === 0) return 0;

        let totalAmount = 0;
        let totalBuyFees = 0;

        for (const order of buyOrders) {
            if (order.side === 'buy' && order.status === 'filled') {
                const amount = order.filledAmount || order.amount;
                totalAmount += amount;
                totalBuyFees += order.fee || 0;
            }
        }

        // Unrealized = (current price - avg buy) * amount - fees paid so far
        const unrealized = (currentPrice - avgPrice) * totalAmount - totalBuyFees;
        return unrealized;
    }
}

// Export singleton instance
export const profitCalculator = new ProfitCalculator();

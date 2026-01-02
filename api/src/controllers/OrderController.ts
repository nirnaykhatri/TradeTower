import { Request, Response, NextFunction } from 'express';
import { orderRepository } from '../services/db/OrderRepository';
import { logger } from '../services/logger';
import { TradeOrder } from '@trading-tower/shared';

export class OrderController {
    /**
     * Calculate profit for a filled order based on buy/sell pair
     * For sells: profit = (sellPrice - avgBuyPrice) * amount - totalFees
     * For buys: profit = 0 (awaiting sell to realize profit)
     */
    private calculateOrderProfit(order: TradeOrder, relatedOrders: TradeOrder[]): number {
        // Only calculate profit for sell orders (realization)
        if (order.side !== 'sell' || order.status !== 'filled') {
            return 0;
        }

        // Find matching buy orders for this sell
        const buyOrders = relatedOrders.filter(
            o => o.side === 'buy' && 
                 o.status === 'filled' && 
                 new Date(o.timestamp) < new Date(order.timestamp)
        );

        if (buyOrders.length === 0) {
            return 0;
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

        // Calculate profit: (sell price - avg buy price) * amount - fees
        const sellAmount = order.filledAmount || order.amount;
        const profit = ((order.price - avgBuyPrice) * sellAmount) - order.fee;

        return profit;
    }

    /**
     * Get order history for current user
     * GET /api/v1/orders
     */
    public async getOrders(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user.userId;
            const { botId, exchangeId, status, limit, offset } = req.query;

            let query = 'SELECT * FROM c WHERE c.userId = @userId';
            const parameters: any[] = [{ name: '@userId', value: userId }];

            if (botId) {
                query += ' AND c.botId = @botId';
                parameters.push({ name: '@botId', value: botId });
            }
            if (exchangeId) {
                query += ' AND c.exchangeId = @exchangeId';
                parameters.push({ name: '@exchangeId', value: exchangeId });
            }
            if (status) {
                query += ' AND c.status = @status';
                parameters.push({ name: '@status', value: status });
            }

            query += ' ORDER BY c.timestamp DESC';

            const resultsLimit = limit ? parseInt(limit as string) : 50;
            const resultsOffset = offset ? parseInt(offset as string) : 0;

            query += ' OFFSET @offset LIMIT @limit';
            parameters.push({ name: '@offset', value: resultsOffset });
            parameters.push({ name: '@limit', value: resultsLimit });

            let orders = await orderRepository.query({ query, parameters });

            // Calculate profit for each sell order
            // Get all orders for this user to find matching buy/sell pairs
            const allOrdersQuery = 'SELECT * FROM c WHERE c.userId = @userId ORDER BY c.timestamp DESC';
            const allOrders = await orderRepository.query({ 
                query: allOrdersQuery, 
                parameters: [{ name: '@userId', value: userId }] 
            });

            orders = orders.map(order => ({
                ...order,
                profit: this.calculateOrderProfit(order, allOrders as any[])
            }));

            res.status(200).json({
                status: 'success',
                results: orders.length,
                pagination: {
                    limit: resultsLimit,
                    offset: resultsOffset
                },
                data: { orders }
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Get a specific order by ID
     * GET /api/v1/orders/:id
     */
    public async getOrderById(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user.userId;
            const { id } = req.params;

            const order = await orderRepository.getById(id, userId);

            if (!order) {
                res.status(404).json({ status: 'fail', message: 'Order not found' });
                return;
            }

            // Get all orders for profit calculation
            const allOrdersQuery = 'SELECT * FROM c WHERE c.userId = @userId AND c.botId = @botId ORDER BY c.timestamp DESC';
            const allOrders = await orderRepository.query({ 
                query: allOrdersQuery, 
                parameters: [
                    { name: '@userId', value: userId },
                    { name: '@botId', value: order.botId }
                ] 
            });

            const enrichedOrder = {
                ...order,
                profit: this.calculateOrderProfit(order as any, allOrders as any[])
            };

            res.status(200).json({
                status: 'success',
                data: { order: enrichedOrder }
            });
        } catch (error) {
            next(error);
        }
    }
}

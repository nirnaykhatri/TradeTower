import { Request, Response, NextFunction } from 'express';
import { orderRepository } from '../services/db/OrderRepository';
import { logger } from '../services/logger';
import { TradeOrder, profitCalculator } from '@trading-tower/shared';

export class OrderController {

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

            // Calculate profit for each order using centralized service
            // Filter by botId if specified to optimize query scope
            let allOrders: TradeOrder[];
            if (botId) {
                const allOrdersQuery = 'SELECT * FROM c WHERE c.userId = @userId AND c.botId = @botId ORDER BY c.timestamp DESC';
                allOrders = await orderRepository.query({ 
                    query: allOrdersQuery, 
                    parameters: [
                        { name: '@userId', value: userId },
                        { name: '@botId', value: botId }
                    ] 
                });
            } else {
                const allOrdersQuery = 'SELECT * FROM c WHERE c.userId = @userId ORDER BY c.timestamp DESC';
                allOrders = await orderRepository.query({ 
                    query: allOrdersQuery, 
                    parameters: [{ name: '@userId', value: userId }] 
                });
            }

            orders = orders.map(order => ({
                ...order,
                profit: profitCalculator.calculateForSellOrder(order, allOrders).profit
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
                profit: profitCalculator.calculateForSellOrder(order, allOrders).profit
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

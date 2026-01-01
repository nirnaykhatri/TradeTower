import { Request, Response, NextFunction } from 'express';
import { performanceRepository } from '../services/db/PerformanceRepository';
import { botRepository } from '../services/db/BotRepository';
import { logger } from '../services/logger';

export class PerformanceController {
    /**
     * Get global performance metrics for user
     * GET /api/v1/metrics
     */
    public async getGlobalMetrics(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user.userId;

            // 1. Get summary using SQL Aggregation (Scalability fix)
            const summaryQuery = {
                query: `SELECT 
                            SUM(c.totalPnL) as totalPnL, 
                            SUM(c.totalTrades) as totalTrades,
                            COUNT(1) as totalBots,
                            SUM(CASE WHEN c.status = 'running' THEN 1 ELSE 0 END) as activeBots
                        FROM c WHERE c.userId = @userId`,
                parameters: [{ name: '@userId', value: userId }]
            };

            const [summaryData] = await (botRepository as any).query(summaryQuery);

            const summary = {
                totalPnL: summaryData?.totalPnL || 0,
                totalTrades: summaryData?.totalTrades || 0,
                activeBots: summaryData?.activeBots || 0,
                totalBots: summaryData?.totalBots || 0
            };

            // Get historical growth snapshots
            const history = await performanceRepository.getHistory(userId, undefined, 30);

            res.status(200).json({
                status: 'success',
                data: {
                    summary,
                    history
                }
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Get specific bot performance
     * GET /api/v1/metrics/bot/:botId
     */
    public async getBotPerformance(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user.userId;
            const { botId } = req.params;

            const bot = await botRepository.getById(botId, userId);
            if (!bot) {
                res.status(404).json({ status: 'fail', message: 'Bot not found' });
                return;
            }

            const history = await performanceRepository.getHistory(userId, botId, 30);

            res.status(200).json({
                status: 'success',
                data: {
                    botId,
                    currentPnL: bot.performance?.totalPnL || 0,
                    totalTrades: bot.performance?.totalTrades || 0,
                    winRate: bot.performance?.winRate || 0,
                    history
                }
            });
        } catch (error) {
            next(error);
        }
    }
}

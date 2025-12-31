import { PerformanceSnapshot } from '@trading-tower/shared';
import { BaseRepository } from './BaseRepository';

export class PerformanceRepository extends BaseRepository<PerformanceSnapshot> {
    constructor() {
        super('Metrics');
    }

    public async getHistory(userId: string, botId?: string, limit: number = 30): Promise<PerformanceSnapshot[]> {
        const query = botId
            ? 'SELECT * FROM c WHERE c.userId = @userId AND c.botId = @botId ORDER BY c.timestamp DESC OFFSET 0 LIMIT @limit'
            : 'SELECT * FROM c WHERE c.userId = @userId AND c.botId = null ORDER BY c.timestamp DESC OFFSET 0 LIMIT @limit';

        const parameters = [
            { name: '@userId', value: userId },
            { name: '@limit', value: limit }
        ];

        if (botId) {
            parameters.push({ name: '@botId', value: botId });
        }

        return this.query({ query, parameters });
    }
}

export const performanceRepository = new PerformanceRepository();

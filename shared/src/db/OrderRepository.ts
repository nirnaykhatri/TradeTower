import { TradeOrder } from '../index';
import { BaseRepository } from './BaseRepository';
import { DatabaseService } from './CosmosService';

export class OrderRepository extends BaseRepository<TradeOrder> {
    constructor(dbService: DatabaseService) {
        super('Orders', dbService);
    }
}

// Factory function to create repository with default service
export function createOrderRepository(dbService: DatabaseService): OrderRepository {
    return new OrderRepository(dbService);
}

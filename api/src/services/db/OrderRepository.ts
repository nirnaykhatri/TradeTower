import { TradeOrder } from '@trading-tower/shared';
import { BaseRepository } from './BaseRepository';

export class OrderRepository extends BaseRepository<TradeOrder> {
    constructor() {
        super('Orders');
    }
}

export const orderRepository = new OrderRepository();

import { BotInstance } from '@trading-tower/shared';
import { BaseRepository } from './BaseRepository';

export class BotRepository extends BaseRepository<BotInstance> {
    constructor() {
        super('Bots');
    }
}

export const botRepository = new BotRepository();

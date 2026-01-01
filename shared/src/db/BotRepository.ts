import { BotInstance } from '../index';
import { BaseRepository } from './BaseRepository';
import { DatabaseService } from './CosmosService';

export class BotRepository extends BaseRepository<BotInstance> {
    constructor(dbService: DatabaseService) {
        super('Bots', dbService);
    }
}

// Factory function to create repository with default service
export function createBotRepository(dbService: DatabaseService): BotRepository {
    return new BotRepository(dbService);
}

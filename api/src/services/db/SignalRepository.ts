import { TradingSignal } from '../../models/cosmosModels';
import { BaseRepository } from './BaseRepository';

export class SignalRepository extends BaseRepository<TradingSignal> {
    constructor() {
        super('Signals');
    }
}

export const signalRepository = new SignalRepository();

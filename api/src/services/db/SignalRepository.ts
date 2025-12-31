import { TradingSignal } from '@trading-tower/shared';
import { BaseRepository } from './BaseRepository';

export class SignalRepository extends BaseRepository<TradingSignal> {
    constructor() {
        super('Signals');
    }
}

export const signalRepository = new SignalRepository();

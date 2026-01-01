import { BaseDCAStrategy } from './BaseDCAStrategy';
import { DCAConfig } from '../types/strategyConfig';

export class DCAStrategy extends BaseDCAStrategy<DCAConfig> {
    protected get dcaConfig(): DCAConfig {
        return this.config;
    }
}

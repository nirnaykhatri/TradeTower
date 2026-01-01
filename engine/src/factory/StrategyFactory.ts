/**
 * Strategy Factory Pattern Implementation
 * Provides dependency injection and extensibility for bot strategies
 */

import { BotInstance } from '@trading-tower/shared';
import { IExchangeConnector } from '@trading-tower/connectors';
import { IBotStrategy } from '../strategies/BaseStrategy';
import { GridStrategy } from '../strategies/GridStrategy';
import { DCAStrategy } from '../strategies/DCAStrategy';
import { BTDStrategy } from '../strategies/BTDStrategy';
import { ComboStrategy } from '../strategies/ComboStrategy';
import { LoopStrategy } from '../strategies/LoopStrategy';
import { DCAFuturesStrategy } from '../strategies/DCAFuturesStrategy';
import { FuturesGridStrategy } from '../strategies/FuturesGridStrategy';
import { TWAPStrategy } from '../strategies/TWAPStrategy';
import { ConfigurationError } from '@trading-tower/shared';

/**
 * Strategy factory interface
 */
export interface IStrategyFactory {
    /**
     * Create a strategy instance
     * @param bot Bot configuration
     * @param exchange Exchange connector
     * @returns Strategy instance
     */
    create(bot: BotInstance, exchange: IExchangeConnector): IBotStrategy;

    /**
     * Get supported strategy type
     */
    getStrategyType(): string;
}

/**
 * Base strategy factory implementation
 */
abstract class BaseStrategyFactory implements IStrategyFactory {
    abstract create(bot: BotInstance, exchange: IExchangeConnector): IBotStrategy;
    abstract getStrategyType(): string;
}

/**
 * Grid strategy factory
 */
class GridStrategyFactory extends BaseStrategyFactory {
    create(bot: BotInstance, exchange: IExchangeConnector): IBotStrategy {
        return new GridStrategy(bot, exchange, bot.config);
    }

    getStrategyType(): string {
        return 'GRID';
    }
}

/**
 * DCA strategy factory
 */
class DCAStrategyFactory extends BaseStrategyFactory {
    create(bot: BotInstance, exchange: IExchangeConnector): IBotStrategy {
        return new DCAStrategy(bot, exchange, bot.config);
    }

    getStrategyType(): string {
        return 'DCA';
    }
}

/**
 * BTD strategy factory
 */
class BTDStrategyFactory extends BaseStrategyFactory {
    create(bot: BotInstance, exchange: IExchangeConnector): IBotStrategy {
        return new BTDStrategy(bot, exchange, bot.config);
    }

    getStrategyType(): string {
        return 'BTD';
    }
}

/**
 * Combo strategy factory
 */
class ComboStrategyFactory extends BaseStrategyFactory {
    create(bot: BotInstance, exchange: IExchangeConnector): IBotStrategy {
        return new ComboStrategy(bot, exchange, bot.config);
    }

    getStrategyType(): string {
        return 'COMBO';
    }
}

/**
 * Loop strategy factory
 */
class LoopStrategyFactory extends BaseStrategyFactory {
    create(bot: BotInstance, exchange: IExchangeConnector): IBotStrategy {
        return new LoopStrategy(bot, exchange, bot.config);
    }

    getStrategyType(): string {
        return 'LOOP';
    }
}

/**
 * DCA Futures strategy factory
 */
class DCAFuturesStrategyFactory extends BaseStrategyFactory {
    create(bot: BotInstance, exchange: IExchangeConnector): IBotStrategy {
        return new DCAFuturesStrategy(bot, exchange, bot.config);
    }

    getStrategyType(): string {
        return 'DCA_FUTURES';
    }
}

/**
 * Futures Grid strategy factory
 */
class FuturesGridStrategyFactory extends BaseStrategyFactory {
    create(bot: BotInstance, exchange: IExchangeConnector): IBotStrategy {
        return new FuturesGridStrategy(bot, exchange, bot.config);
    }

    getStrategyType(): string {
        return 'FUTURES_GRID';
    }
}

/**
 * TWAP strategy factory
 */
class TWAPStrategyFactory extends BaseStrategyFactory {
    create(bot: BotInstance, exchange: IExchangeConnector): IBotStrategy {
        return new TWAPStrategy(bot, exchange, bot.config);
    }

    getStrategyType(): string {
        return 'TWAP';
    }
}

/**
 * Strategy factory registry
 * Manages registration and creation of strategies
 */
export class StrategyFactoryRegistry {
    private factories: Map<string, IStrategyFactory> = new Map();

    constructor() {
        this.registerDefaultFactories();
    }

    /**
     * Register default strategy factories
     */
    private registerDefaultFactories(): void {
        this.register(new GridStrategyFactory());
        this.register(new DCAStrategyFactory());
        this.register(new BTDStrategyFactory());
        this.register(new ComboStrategyFactory());
        this.register(new LoopStrategyFactory());
        this.register(new DCAFuturesStrategyFactory());
        this.register(new FuturesGridStrategyFactory());
        this.register(new TWAPStrategyFactory());
    }

    /**
     * Register a strategy factory
     * @param factory Strategy factory to register
     */
    register(factory: IStrategyFactory): void {
        const type = factory.getStrategyType();
        if (this.factories.has(type)) {
            console.warn(`[StrategyRegistry] Overwriting existing factory for type: ${type}`);
        }
        this.factories.set(type, factory);
        console.log(`[StrategyRegistry] Registered factory for strategy type: ${type}`);
    }

    /**
     * Unregister a strategy factory
     * @param strategyType Strategy type to unregister
     */
    unregister(strategyType: string): void {
        this.factories.delete(strategyType);
        console.log(`[StrategyRegistry] Unregistered factory for strategy type: ${strategyType}`);
    }

    /**
     * Create a strategy instance
     * @param bot Bot configuration
     * @param exchange Exchange connector
     * @returns Strategy instance
     * @throws {ConfigurationError} If strategy type is not supported
     */
    createStrategy(bot: BotInstance, exchange: IExchangeConnector): IBotStrategy {
        const factory = this.factories.get(bot.strategyType);
        
        if (!factory) {
            throw new ConfigurationError(
                `Unsupported strategy type: ${bot.strategyType}. ` +
                `Available types: ${Array.from(this.factories.keys()).join(', ')}`
            );
        }

        console.log(`[StrategyRegistry] Creating strategy: ${bot.strategyType} for bot ${bot.id}`);
        return factory.create(bot, exchange);
    }

    /**
     * Check if a strategy type is supported
     * @param strategyType Strategy type to check
     */
    isSupported(strategyType: string): boolean {
        return this.factories.has(strategyType);
    }

    /**
     * Get all supported strategy types
     */
    getSupportedTypes(): string[] {
        return Array.from(this.factories.keys());
    }

    /**
     * Get factory for a specific strategy type
     * @param strategyType Strategy type
     */
    getFactory(strategyType: string): IStrategyFactory | undefined {
        return this.factories.get(strategyType);
    }
}

/**
 * Default strategy factory registry instance
 */
export const strategyFactoryRegistry = new StrategyFactoryRegistry();

/**
 * Dependency Injection Interfaces
 * 
 * Defines contracts for services used by strategies, enabling:
 * - Constructor-based dependency injection
 * - Mock-friendly testing
 * - Loose coupling between components
 * - Easy service substitution
 */

import { BotInstance, TradeOrder } from '../index';

/**
 * Repository interface for bot data access
 */
export interface IBotRepository {
    get(userId: string, botId: string): Promise<BotInstance | null>;
    create(bot: BotInstance): Promise<BotInstance>;
    update(bot: BotInstance): Promise<BotInstance>;
    delete(userId: string, botId: string): Promise<void>;
    list(userId: string): Promise<BotInstance[]>;
}

/**
 * Repository interface for order data access
 */
export interface IOrderRepository {
    create(order: TradeOrder): Promise<TradeOrder>;
    get(userId: string, orderId: string): Promise<TradeOrder | null>;
    update(order: TradeOrder): Promise<TradeOrder>;
    query(userId: string, filters?: any): Promise<TradeOrder[]>;
}

/**
 * Logger interface for consistent logging
 */
export interface ILogger {
    debug(message: string | object): void;
    info(message: string | object): void;
    warn(message: string | object): void;
    error(message: string | object): void;
}

/**
 * Indicator calculation service
 */
export interface IIndicatorService {
    calculateMACD(prices: number[], fastPeriod?: number, slowPeriod?: number, signalPeriod?: number): Promise<any>;
    calculateRSI(prices: number[], period?: number): Promise<number>;
    calculateStochastic(prices: number[], period?: number, signalPeriod?: number): Promise<any>;
    evaluateTradingViewSignal(secret: string): Promise<string>;
}

/**
 * Signal cache interface for webhook handling
 */
export interface ISignalCache {
    getLatestSignal(userId: string, source: string): Promise<any | null>;
    cacheSignal(userId: string, source: string, signal: any): Promise<void>;
    clearSignal(userId: string, source: string): Promise<void>;
}

/**
 * Service provider interface for dependency injection
 * 
 * Provides access to all services in a centralized manner
 */
export interface IServiceProvider {
    botRepository: IBotRepository;
    orderRepository: IOrderRepository;
    logger: ILogger;
    indicatorService: IIndicatorService;
    signalCache: ISignalCache;
}

/**
 * Service locator implementation
 * 
 * Centralizes access to all services. While not ideal for testing,
 * provides backward compatibility with existing code while DI is adopted.
 * 
 * USAGE: Only use for bootstrapping; prefer constructor injection in new code.
 */
export class ServiceLocator implements IServiceProvider {
    private static instance: ServiceLocator;
    
    botRepository!: IBotRepository;
    orderRepository!: IOrderRepository;
    logger!: ILogger;
    indicatorService!: IIndicatorService;
    signalCache!: ISignalCache;

    private constructor() {}

    static getInstance(): ServiceLocator {
        if (!ServiceLocator.instance) {
            ServiceLocator.instance = new ServiceLocator();
        }
        return ServiceLocator.instance;
    }

    static setServices(provider: IServiceProvider): void {
        const locator = ServiceLocator.getInstance();
        locator.botRepository = provider.botRepository;
        locator.orderRepository = provider.orderRepository;
        locator.logger = provider.logger;
        locator.indicatorService = provider.indicatorService;
        locator.signalCache = provider.signalCache;
    }
}

/**
 * Indicator Scheduler
 * 
 * Schedules candle-close indicator evaluations for all active bots.
 * - Runs evaluations at candle close for each timeframe (1m, 5m, 15m, 30m, 1h, 4h, 1d)
 * - Loads historical price data from exchange
 * - Delegates evaluation to BotIndicatorEvaluator
 * - Publishes signals to Service Bus
 */

import { BotIndicatorEvaluator, CandleHistory } from './BotIndicatorEvaluator';
import { ServiceBusSignalPublisher } from './ServiceBusSignalPublisher';
import { IndicatorCondition } from '../types/strategyConfig';

export interface BotIndicatorConfig {
    botId: string;
    pair: string;
    exchangeConnectorId: string;
    entryIndicators: IndicatorCondition[];
}

export interface CandleDataProvider {
    /**
     * Fetch historical OHLCV candles for a pair and timeframe
     */
    getCandles(
        pair: string,
        timeframe: string,
        limit?: number
    ): Promise<Array<{
        timestamp: number;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
    }>>;
}

/**
 * Indicator Scheduler
 * 
 * Manages scheduled evaluations of indicators at candle close.
 * Supports multiple timeframes and batches bot evaluations efficiently.
 */
export class IndicatorScheduler {
    private botConfigs: Map<string, BotIndicatorConfig> = new Map();
    private evaluators: Map<string, BotIndicatorEvaluator> = new Map();
    private candleDataProvider: CandleDataProvider;
    private publisher: ServiceBusSignalPublisher;
    private timeouts: Map<string, NodeJS.Timeout> = new Map();
    private isRunning: boolean = false;

    private readonly TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];
    private readonly CANDLE_COUNT = 100; // Last 100 candles for indicator calculation

    constructor(candleDataProvider: CandleDataProvider, publisher: ServiceBusSignalPublisher) {
        this.candleDataProvider = candleDataProvider;
        this.publisher = publisher;
    }

    /**
     * Register a bot for indicator evaluation
     * 
     * @param config Bot indicator configuration
     */
    public registerBot(config: BotIndicatorConfig): void {
        this.botConfigs.set(config.botId, config);

        // Create evaluator for this bot
        const evaluator = new BotIndicatorEvaluator(
            {
                botId: config.botId,
                pair: config.pair,
                entryIndicators: config.entryIndicators
            },
            this.publisher
        );

        this.evaluators.set(config.botId, evaluator);

        console.log(
            `[IndicatorScheduler] Registered bot ${config.botId} for indicator evaluation (${config.entryIndicators.length} indicators)`
        );
    }

    /**
     * Unregister a bot from indicator evaluation
     * 
     * @param botId Bot ID to unregister
     */
    public unregisterBot(botId: string): void {
        this.botConfigs.delete(botId);
        this.evaluators.delete(botId);

        console.log(`[IndicatorScheduler] Unregistered bot ${botId}`);
    }

    /**
     * Start scheduling indicator evaluations
     * Schedules candle-close evaluations for all registered bots
     */
    public async start(): Promise<void> {
        if (this.isRunning) {
            console.warn('[IndicatorScheduler] Already running');
            return;
        }

        this.isRunning = true;
        console.log('[IndicatorScheduler] Starting evaluation schedules...');

        // Schedule evaluation for each timeframe
        for (const timeframe of this.TIMEFRAMES) {
            this.scheduleTimeframeEvaluation(timeframe);
        }
    }

    /**
     * Stop all scheduled evaluations
     */
    public async stop(): Promise<void> {
        if (!this.isRunning) {
            return;
        }

        this.isRunning = false;
        console.log('[IndicatorScheduler] Stopping evaluation schedules...');

        // Clear all scheduled timeouts
        for (const [key, timeout] of this.timeouts) {
            clearTimeout(timeout);
        }
        this.timeouts.clear();

        console.log('[IndicatorScheduler] All schedules stopped');
    }

    /**
     * Get registered bot count
     */
    public getBotCount(): number {
        return this.botConfigs.size;
    }

    /**
     * Schedule evaluation for a specific timeframe
     * Calculates when the next candle closes and schedules evaluation then
     */
    private scheduleTimeframeEvaluation(timeframe: string): void {
        const msPerCandle = this.timeframeToMs(timeframe);
        const now = Date.now();
        const nextCandleClose = this.calculateNextCandleClose(now, msPerCandle);
        const delayMs = nextCandleClose - now;

        console.log(
            `[IndicatorScheduler] Scheduling ${timeframe} evaluation in ${delayMs}ms`
        );

        const timeout = setTimeout(
            () => this.evaluateTimeframe(timeframe),
            delayMs
        );

        this.timeouts.set(timeframe, timeout);
    }

    /**
     * Evaluate all bots for a specific timeframe
     * Loads price data and evaluates indicators
     */
    private async evaluateTimeframe(timeframe: string): Promise<void> {
        if (!this.isRunning) {
            return;
        }

        try {
            // Group bots by pair for efficient data loading
            const botsByPair = new Map<string, BotIndicatorConfig[]>();
            for (const [, config] of this.botConfigs) {
                // Only evaluate bots that have indicators
                if (config.entryIndicators.length === 0) {
                    continue;
                }

                if (!botsByPair.has(config.pair)) {
                    botsByPair.set(config.pair, []);
                }
                botsByPair.get(config.pair)!.push(config);
            }

            // Evaluate each unique pair once
            for (const [pair, configs] of botsByPair) {
                try {
                    const candles = await this.candleDataProvider.getCandles(
                        pair,
                        timeframe,
                        this.CANDLE_COUNT
                    );

                    const candleHistory: CandleHistory = {
                        timeframe,
                        candles
                    };

                    // Evaluate all bots for this pair
                    for (const config of configs) {
                        const evaluator = this.evaluators.get(config.botId);
                        if (!evaluator) {
                            continue;
                        }

                        try {
                            const result = await evaluator.evaluateAtCandleClose(candleHistory);

                            if (result.signal !== 'NEUTRAL') {
                                await evaluator.publishSignalIfTriggered(result);
                            }
                        } catch (error) {
                            console.error(
                                `[IndicatorScheduler] Error evaluating bot ${config.botId}:`,
                                error
                            );
                        }
                    }
                } catch (error) {
                    console.error(
                        `[IndicatorScheduler] Error loading candles for ${pair} ${timeframe}:`,
                        error
                    );
                }
            }
        } catch (error) {
            console.error(`[IndicatorScheduler] Error in ${timeframe} evaluation:`, error);
        } finally {
            // Reschedule for next candle close
            this.scheduleTimeframeEvaluation(timeframe);
        }
    }

    /**
     * Convert timeframe string to milliseconds
     */
    private timeframeToMs(timeframe: string): number {
        const mapping: Record<string, number> = {
            '1m': 60 * 1000,
            '5m': 5 * 60 * 1000,
            '15m': 15 * 60 * 1000,
            '30m': 30 * 60 * 1000,
            '1h': 60 * 60 * 1000,
            '4h': 4 * 60 * 60 * 1000,
            '1d': 24 * 60 * 60 * 1000
        };
        return mapping[timeframe] || 60 * 1000;
    }

    /**
     * Calculate the next candle close time
     * Returns the timestamp of the next candle close for the given timeframe
     */
    private calculateNextCandleClose(now: number, msPerCandle: number): number {
        // Round to next candle close
        const candleIndex = Math.floor(now / msPerCandle);
        return (candleIndex + 1) * msPerCandle;
    }
}

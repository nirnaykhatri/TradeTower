/**
 * Bot Indicator Evaluator
 * 
 * Evaluates indicator conditions for a bot at candle close:
 * - Loads historical OHLCV data
 * - Calculates indicator values (RSI, MACD, Stochastic)
 * - Applies AND logic across multiple entry indicators
 * - Generates BUY/SELL signals
 * - Publishes signals to Service Bus
 */

import { IndicatorCondition } from '../types/strategyConfig';
import { IndicatorService } from '@trading-tower/shared';
import { ServiceBusSignalMessage } from './ServiceBusSignalListener';
import { ServiceBusSignalPublisher } from './ServiceBusSignalPublisher';

export interface EvaluatorConfig {
    botId: string;
    pair: string;
    entryIndicators: IndicatorCondition[];
}

export interface CandleHistory {
    timeframe: string;
    candles: Array<{
        timestamp: number;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
    }>;
}

export interface EvaluationResult {
    signal: 'BUY' | 'SELL' | 'NEUTRAL';
    reason: string;
    timestamp: number;
    indicatorResults: {
        type: string;
        value: any;
        triggered: boolean;
    }[];
}

/**
 * Bot Indicator Evaluator
 * 
 * Evaluates multiple indicator conditions with AND logic.
 * All indicators must trigger their entry condition for BUY signal.
 */
export class BotIndicatorEvaluator {
    private indicatorService: IndicatorService;
    private publisher: ServiceBusSignalPublisher;
    private config: EvaluatorConfig;

    constructor(
        config: EvaluatorConfig,
        publisher: ServiceBusSignalPublisher,
        indicatorService?: IndicatorService
    ) {
        this.config = config;
        this.publisher = publisher;
        this.indicatorService = indicatorService || new IndicatorService();
    }

    /**
     * Evaluate indicators at candle close
     * Applies AND logic: all indicators must signal BUY for entry
     * 
     * @param candleHistory Historical OHLCV data for the timeframe
     * @returns Evaluation result with signal and detailed results
     */
    public async evaluateAtCandleClose(candleHistory: CandleHistory): Promise<EvaluationResult> {
        const result: EvaluationResult = {
            signal: 'NEUTRAL',
            reason: 'No signals triggered',
            timestamp: Date.now(),
            indicatorResults: []
        };

        // No indicators configured
        if (!this.config.entryIndicators || this.config.entryIndicators.length === 0) {
            return result;
        }

        // Extract OHLCV arrays from candles
        const closes = this.config.entryIndicators.map(() =>
            this.config.entryIndicators[0].type === 'Stochastic'
                ? this.config.entryIndicators[0].type === 'Stochastic'
                    ? candleHistory.candles.map((c) => c.close)
                    : []
                : candleHistory.candles.map((c) => c.close)
        )[0] || candleHistory.candles.map((c) => c.close);

        const highs = candleHistory.candles.map((c) => c.high);
        const lows = candleHistory.candles.map((c) => c.low);

        // Evaluate each indicator (AND logic)
        let allIndicatorsTriggered = true;
        const indicatorResults: typeof result.indicatorResults = [];

        for (const condition of this.config.entryIndicators) {
            const evalResult = this.evaluateSingleIndicator(
                condition,
                closes,
                highs,
                lows
            );

            indicatorResults.push(evalResult);

            if (!evalResult.triggered) {
                allIndicatorsTriggered = false;
            }
        }

        result.indicatorResults = indicatorResults;

        // Generate signal only if ALL indicators triggered
        if (allIndicatorsTriggered && this.config.entryIndicators.length > 0) {
            result.signal = 'BUY';
            result.reason = `All ${this.config.entryIndicators.length} indicator(s) triggered`;
        } else {
            const triggered = indicatorResults.filter((r) => r.triggered).length;
            result.reason = `Only ${triggered}/${this.config.entryIndicators.length} indicator(s) triggered`;
        }

        return result;
    }

    /**
     * Evaluate a single indicator condition
     * 
     * @param condition The indicator configuration
     * @param closes Close prices
     * @param highs High prices
     * @param lows Low prices
     * @returns Evaluation result for this indicator
     */
    private evaluateSingleIndicator(
        condition: IndicatorCondition,
        closes: number[],
        highs: number[],
        lows: number[]
    ): {
        type: string;
        value: any;
        triggered: boolean;
    } {
        const baseResult = {
            type: condition.type,
            value: null as any,
            triggered: false
        };

        if (condition.type === 'RSI') {
            const values = this.indicatorService.calculateRSI(closes, condition.config?.rsiPeriod);
            if (values.length > 0) {
                const latest = values[values.length - 1];
                const oversold = condition.config?.oversold ?? 30;
                baseResult.value = latest;
                baseResult.triggered = latest < oversold; // Buy when oversold
            }
        } else if (condition.type === 'MACD') {
            const values = this.indicatorService.calculateMACD(
                closes,
                condition.config?.macdFastPeriod,
                condition.config?.macdSlowPeriod,
                condition.config?.macdSignalPeriod
            );
            if (values.length > 1) {
                const latest = values[values.length - 1] as any;
                const prev = values[values.length - 2] as any;
                baseResult.value = { macd: latest?.MACD, signal: latest?.signal };
                // Buy on bullish crossover (MACD crosses above signal line)
                baseResult.triggered = 
                    (latest?.MACD || 0) > (latest?.signal || 0) &&
                    (prev?.MACD || 0) <= (prev?.signal || 0);
            }
        } else if (condition.type === 'Stochastic') {
            const values = this.indicatorService.calculateStochastic(
                highs,
                lows,
                closes,
                condition.config?.stochasticPeriod,
                condition.config?.stochasticSignalPeriod
            );
            if (values.length > 0) {
                const latest = values[values.length - 1] as any;
                const oversold = condition.config?.oversold ?? 20;
                baseResult.value = { k: latest?.k, d: latest?.d };
                // Buy when both K and D are oversold and K > D (rising)
                baseResult.triggered = 
                    (latest?.k || 0) < oversold &&
                    (latest?.d || 0) < oversold &&
                    (latest?.k || 0) > (latest?.d || 0);
            }
        }

        return baseResult;
    }

    /**
     * Publish evaluation result as a signal if triggered
     * 
     * @param result The evaluation result
     */
    public async publishSignalIfTriggered(result: EvaluationResult): Promise<void> {
        if (result.signal === 'BUY') {
            const message: ServiceBusSignalMessage = {
                botId: this.config.botId,
                signal: result.signal,
                source: 'INDICATOR',
                pair: this.config.pair,
                timestamp: result.timestamp,
                metadata: {
                    reason: result.reason,
                    indicatorCount: this.config.entryIndicators.length,
                    indicatorResults: result.indicatorResults
                }
            };

            try {
                await this.publisher.publishSignal(message);
            } catch (error) {
                console.error(
                    `[BotIndicatorEvaluator] Failed to publish signal for bot ${this.config.botId}:`,
                    error
                );
                throw error;
            }
        }
    }
}

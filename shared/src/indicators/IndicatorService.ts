import { RSI, MACD, Stochastic } from 'technicalindicators';

export interface CandleData {
    open: number[];
    high: number[];
    low: number[];
    close: number[];
    volume: number[];
}

/**
 * Configuration for indicator calculations
 */
export interface IndicatorConfig {
    rsiPeriod?: number;
    macdFastPeriod?: number;
    macdSlowPeriod?: number;
    macdSignalPeriod?: number;
    stochasticPeriod?: number;
    stochasticSignalPeriod?: number;
    oversold?: number;
    overbought?: number;
}

/**
 * Service for calculating technical indicators
 * Supports dependency injection pattern
 */
export class IndicatorService {
    private readonly defaultConfig: IndicatorConfig = {
        rsiPeriod: 14,
        macdFastPeriod: 12,
        macdSlowPeriod: 26,
        macdSignalPeriod: 9,
        stochasticPeriod: 14,
        stochasticSignalPeriod: 3,
        oversold: 30,
        overbought: 70
    };

    /**
     * Creates a new IndicatorService instance
     * @param config Optional configuration overrides
     */
    constructor(private config: IndicatorConfig = {}) {
        this.config = { ...this.defaultConfig, ...config };
    }

    /**
     * Calculate RSI (Relative Strength Index)
     * @param values Price values array
     * @param period Optional period override
     * @returns Array of RSI values
     */
    public calculateRSI(values: number[], period?: number): number[] {
        try {
            return RSI.calculate({
                period: period || this.config.rsiPeriod!,
                values
            });
        } catch (error) {
            console.error('Error calculating RSI', error);
            return [];
        }
    }

    /**
     * Calculate MACD (Moving Average Convergence Divergence)
     * @param values Price values array
     * @param fastPeriod Optional fast period override
     * @param slowPeriod Optional slow period override
     * @param signalPeriod Optional signal period override
     * @returns Array of MACD results
     */
    public calculateMACD(
        values: number[],
        fastPeriod?: number,
        slowPeriod?: number,
        signalPeriod?: number
    ) {
        try {
            return MACD.calculate({
                fastPeriod: fastPeriod || this.config.macdFastPeriod!,
                slowPeriod: slowPeriod || this.config.macdSlowPeriod!,
                signalPeriod: signalPeriod || this.config.macdSignalPeriod!,
                values,
                SimpleMAOscillator: false,
                SimpleMASignal: false
            });
        } catch (error) {
            console.error('Error calculating MACD', error);
            return [];
        }
    }

    /**
     * Calculate Stochastic Oscillator
     * @param high High prices array
     * @param low Low prices array
     * @param close Close prices array
     * @param period Optional period override
     * @param signalPeriod Optional signal period override
     * @returns Array of Stochastic results
     */
    public calculateStochastic(
        high: number[],
        low: number[],
        close: number[],
        period?: number,
        signalPeriod?: number
    ) {
        try {
            return Stochastic.calculate({
                period: period || this.config.stochasticPeriod!,
                signalPeriod: signalPeriod || this.config.stochasticSignalPeriod!,
                high,
                low,
                close
            });
        } catch (error) {
            console.error('Error calculating Stochastic', error);
            return [];
        }
    }

    /**
     * Generate trading signal from indicator values
     * @param type Indicator type
     * @param values Indicator values
     * @param config Optional configuration overrides
     * @returns Trading signal: 'BUY', 'SELL', or 'NEUTRAL'
     */
    public generateSignal(
        type: 'RSI' | 'MACD' | 'Stochastic',
        values: any[],
        config: Partial<IndicatorConfig> = {}
    ): 'BUY' | 'SELL' | 'NEUTRAL' {
        if (values.length === 0) return 'NEUTRAL';

        const mergedConfig = { ...this.config, ...config };
        const latest = values[values.length - 1];

        if (type === 'RSI') {
            const rsiVal = latest as number;
            const oversold = mergedConfig.oversold!;
            const overbought = mergedConfig.overbought!;
            if (rsiVal < oversold) return 'BUY';
            if (rsiVal > overbought) return 'SELL';
        }

        if (type === 'MACD') {
            const macdVal = latest as { MACD?: number; signal?: number; histogram?: number };
            const prevMacd = values[values.length - 2] as { MACD?: number; signal?: number };

            if (macdVal.MACD && macdVal.signal && prevMacd) {
                if (macdVal.MACD > macdVal.signal && (prevMacd.MACD || 0) <= (prevMacd.signal || 0)) {
                    return 'BUY';
                }
                if (macdVal.MACD < macdVal.signal && (prevMacd.MACD || 0) >= (prevMacd.signal || 0)) {
                    return 'SELL';
                }
            }
        }

        if (type === 'Stochastic') {
            const stochVal = latest as { k: number; d: number };
            const oversold = mergedConfig.oversold || 20;
            const overbought = mergedConfig.overbought || 80;

            if (stochVal.k < oversold && stochVal.d < oversold && stochVal.k > stochVal.d) return 'BUY';
            if (stochVal.k > overbought && stochVal.d > overbought && stochVal.k < stochVal.d) return 'SELL';
        }

        return 'NEUTRAL';
    }
}

/**
 * Default indicator service instance
 * Can be replaced with custom configuration via dependency injection
 */
export const indicatorService = new IndicatorService();

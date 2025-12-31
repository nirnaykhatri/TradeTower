import { RSI, MACD, Stochastic } from 'technicalindicators';
import { logger } from '../logger';

export interface CandleData {
    open: number[];
    high: number[];
    low: number[];
    close: number[];
    volume: number[];
}

export class IndicatorService {
    private static instance: IndicatorService;

    private constructor() { }

    public static getInstance(): IndicatorService {
        if (!IndicatorService.instance) {
            IndicatorService.instance = new IndicatorService();
        }
        return IndicatorService.instance;
    }

    /**
     * Calculate RSI
     */
    public calculateRSI(values: number[], period: number = 14): number[] {
        try {
            return RSI.calculate({ period, values });
        } catch (error) {
            logger.error('Error calculating RSI', error);
            return [];
        }
    }

    /**
     * Calculate MACD
     */
    public calculateMACD(values: number[], fastPeriod: number = 12, slowPeriod: number = 26, signalPeriod: number = 9) {
        try {
            return MACD.calculate({
                fastPeriod,
                slowPeriod,
                signalPeriod,
                values,
                SimpleMAOscillator: false,
                SimpleMASignal: false
            });
        } catch (error) {
            logger.error('Error calculating MACD', error);
            return [];
        }
    }

    /**
     * Calculate Stochastic
     */
    public calculateStochastic(high: number[], low: number[], close: number[], period: number = 14, signalPeriod: number = 3) {
        try {
            return Stochastic.calculate({
                period,
                signalPeriod,
                high,
                low,
                close
            });
        } catch (error) {
            logger.error('Error calculating Stochastic', error);
            return [];
        }
    }

    /**
     * Generate Signal based on indicator values and custom thresholds
     */
    public generateSignal(type: 'RSI' | 'MACD' | 'Stochastic', values: any[], config: any = {}): 'BUY' | 'SELL' | 'NEUTRAL' {
        if (values.length === 0) return 'NEUTRAL';

        const latest = values[values.length - 1];

        if (type === 'RSI') {
            const rsiVal = latest as number;
            const oversold = config.oversold || 30;
            const overbought = config.overbought || 70;
            if (rsiVal < oversold) return 'BUY';
            if (rsiVal > overbought) return 'SELL';
        }

        if (type === 'MACD') {
            const macdVal = latest as { MACD?: number; signal?: number; histogram?: number };
            const prevMacd = values[values.length - 2] as { MACD?: number; signal?: number };

            if (macdVal.MACD && macdVal.signal && prevMacd) {
                if (macdVal.MACD > macdVal.signal && (prevMacd.MACD || 0) <= (prevMacd.signal || 0)) {
                    return 'BUY'; // Bullish Cross
                }
                if (macdVal.MACD < macdVal.signal && (prevMacd.MACD || 0) >= (prevMacd.signal || 0)) {
                    return 'SELL'; // Bearish Cross
                }
            }
        }

        if (type === 'Stochastic') {
            const stochVal = latest as { k: number; d: number };
            const oversold = config.oversold || 20;
            const overbought = config.overbought || 80;

            if (stochVal.k < oversold && stochVal.d < oversold && stochVal.k > stochVal.d) return 'BUY';
            if (stochVal.k > overbought && stochVal.d > overbought && stochVal.k < stochVal.d) return 'SELL';
        }

        return 'NEUTRAL';
    }
}

export const indicatorService = IndicatorService.getInstance();

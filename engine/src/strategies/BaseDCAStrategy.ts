import { BaseStrategy, ExitMode } from './BaseStrategy';
import { TradeOrder, indicatorService, botRepository } from '@trading-tower/shared';

export abstract class BaseDCAStrategy<T extends any> extends BaseStrategy<T> {
    protected activeOrders: Map<string, TradeOrder> = new Map();
    protected safetyOrderMap: Map<string, number> = new Map();
    protected filledOrders: TradeOrder[] = [];

    protected avgEntryPrice: number = 0;
    protected totalAmountFilled: number = 0;
    protected totalQuoteAssetSpent: number = 0;

    protected safetyOrdersFilledCount: number = 0;
    protected nextSafetyOrderToIndex: number = 0;

    // Trailing TP State
    protected isTrailingTP: boolean = false;
    protected trailingTPPrice: number = 0;

    // Trailing SL State
    protected currentSLPrice: number = 0;

    // Cycle state
    protected isWaitingForEntry: boolean = false;

    // For drawdown and velocity tracking
    private peakEquity: number = 0;
    private lastFills: number[] = [];

    protected abstract get dcaConfig(): any;

    async initialize(): Promise<void> {
        console.log(`[DCA] Initializing ${this.bot.strategyType} for ${this.bot.pair}`);
        this.peakEquity = this.bot.performance.initialInvestment + this.bot.performance.totalPnL;
    }

    async start(): Promise<void> {
        await this.updateBotStatus('running');

        // Check Kill-Switches (Global Profit/Loss)
        if (this.checkGlobalKillSwitches()) return;

        const condition = this.dcaConfig.baseOrderCondition || 'IMMEDIATELY';

        if (condition === 'IMMEDIATELY') {
            await this.placeBaseOrder();
        } else {
            console.log(`[DCA] Waiting for entry condition: ${condition}`);
            this.isWaitingForEntry = true;
        }
    }

    private checkGlobalKillSwitches(): boolean {
        const perf = this.bot.performance;
        if (this.dcaConfig.targetTotalProfit && perf.totalPnL >= this.dcaConfig.targetTotalProfit) {
            console.log(`[DCA] Global Target Total Profit reached: ${perf.totalPnL}`);
            this.stop('CANCEL_ALL');
            return true;
        }
        if (this.dcaConfig.allowedTotalLoss && perf.totalPnL <= -this.dcaConfig.allowedTotalLoss) {
            console.log(`[DCA] Global Allowed Total Loss reached: ${perf.totalPnL}`);
            this.stop('MARKET_SELL');
            return true;
        }
        return false;
    }

    protected async placeBaseOrder() {
        if (this.isPaused) return;

        const ticker = await this.exchange.getTicker(this.bot.pair);
        const price = ticker.lastPrice;

        if (this.dcaConfig.maxPrice && price > this.dcaConfig.maxPrice) {
            this.isWaitingForEntry = true;
            return;
        }
        if (this.dcaConfig.minPrice && price < this.dcaConfig.minPrice) {
            this.isWaitingForEntry = true;
            return;
        }

        if (this.dcaConfig.pumpProtection && this.detectUnusualVelocity()) {
            this.isWaitingForEntry = true;
            return;
        }

        const side = this.dcaConfig.strategy === 'LONG' ? 'buy' : 'sell';
        const type = this.dcaConfig.baseOrderType?.toLowerCase() || 'market';

        try {
            if (this.bot.performance.initialPrice === 0) {
                this.bot.performance.initialPrice = price;
            }

            const order = await this.exchange.createOrder({
                userId: this.bot.userId,
                botId: this.bot.id,
                pair: this.bot.pair,
                side,
                type: type as any,
                amount: this.dcaConfig.baseOrderAmount,
                price: type === 'limit' ? price : undefined
            });

            this.activeOrders.set(order.id, order);
            this.isWaitingForEntry = false;

            if (this.dcaConfig.stopLossPercent) {
                const factor = this.dcaConfig.strategy === 'LONG' ? -1 : 1;
                this.currentSLPrice = price * (1 + (this.dcaConfig.stopLossPercent / 100) * factor);
            }

            if (this.dcaConfig.placeSafetyOrdersAtStart) {
                await this.syncSafetyOrders();
            }
        } catch (error) {
            console.error('[DCA] Failed to place Base Order:', error);
            await this.updateBotStatus('error');
        }
    }

    private detectUnusualVelocity(): boolean {
        if (this.lastFills.length < 3) return false;
        const now = Date.now();
        const recent = this.lastFills.filter(t => now - t < 10000);
        return recent.length >= 3;
    }

    protected async getCurrentPrice(): Promise<number> {
        const ticker = await this.exchange.getTicker(this.bot.pair);
        return ticker.lastPrice;
    }

    public async cancelAllActiveOrders() {
        for (const id of this.activeOrders.keys()) {
            await this.exchange.cancelOrder(id, this.bot.pair).catch(() => { });
        }
        this.activeOrders.clear();
        this.safetyOrderMap.clear();
    }

    async onPriceUpdate(price: number): Promise<void> {
        if (this.isPaused) return;
        this.lastPrice = price;

        if (this.isWaitingForEntry) {
            if (this.dcaConfig.baseOrderCondition === 'PRICE_CHANGE' && this.dcaConfig.triggerPrice) {
                const diff = Math.abs(price - this.dcaConfig.triggerPrice) / this.dcaConfig.triggerPrice;
                if (diff < 0.005) await this.placeBaseOrder();
            } else if (this.dcaConfig.baseOrderCondition === 'INDICATOR' && this.dcaConfig.entryIndicator) {
                const signal = await this.checkIndicatorCondition(this.dcaConfig.entryIndicator, true);
                if (signal) await this.placeBaseOrder();
            }
            return;
        }

        if (this.totalAmountFilled === 0) return;

        const currentPnL = this.calculatePnL(price);

        const perf = this.bot.performance;
        const factor = this.dcaConfig.strategy === 'LONG' ? 1 : -1;

        perf.unrealizedPnL = (price - this.avgEntryPrice) * this.totalAmountFilled * factor;
        perf.totalPnL = perf.botProfit + perf.unrealizedPnL;
        perf.totalPnLPercent = (perf.totalPnL / perf.initialInvestment) * 100;
        perf.annualizedReturn = this.calculateAnnualizedReturn();

        perf.avgEntryPrice = this.avgEntryPrice;
        perf.breakEvenPrice = this.avgEntryPrice;
        perf.filledSafetyOrders = this.safetyOrdersFilledCount;
        perf.totalSafetyOrders = this.dcaConfig.averagingOrdersQuantity;

        const currentEquity = perf.initialInvestment + perf.totalPnL;
        if (currentEquity > this.peakEquity) this.peakEquity = currentEquity;
        const currentDrawdown = ((this.peakEquity - currentEquity) / this.peakEquity) * 100;
        if (currentDrawdown > perf.drawdown) perf.drawdown = currentDrawdown;

        if (this.dcaConfig.trailingTP && this.dcaConfig.takeProfitPercent) {
            const tpThreshold = this.dcaConfig.takeProfitPercent;
            if (!this.isTrailingTP && currentPnL >= tpThreshold) {
                this.isTrailingTP = true;
                this.trailingTPPrice = price;
            }
            if (this.isTrailingTP) {
                if ((this.dcaConfig.strategy === 'LONG' && price > this.trailingTPPrice) ||
                    (this.dcaConfig.strategy === 'SHORT' && price < this.trailingTPPrice)) {
                    this.trailingTPPrice = price;
                }
                const reversal = Math.abs(price - this.trailingTPPrice) / this.trailingTPPrice * 100;
                if (reversal >= (this.dcaConfig.trailingTPStep || 0.5)) {
                    await this.executeExit('Trailing Take Profit');
                    return;
                }
            }
        } else if (this.dcaConfig.takeProfitPercent && currentPnL >= this.dcaConfig.takeProfitPercent) {
            let canExit = true;
            if (this.dcaConfig.takeProfitCondition) {
                canExit = await this.checkIndicatorCondition(this.dcaConfig.takeProfitCondition);
            }
            if (canExit) {
                await this.executeExit('Take Profit');
                return;
            }
        }

        if (this.dcaConfig.trailingSL && this.dcaConfig.trailingSLStep) {
            const slStepFactor = this.dcaConfig.strategy === 'LONG' ? (1 - this.dcaConfig.trailingSLStep / 100) : (1 + this.dcaConfig.trailingSLStep / 100);
            const potentialNewSL = price * slStepFactor;
            if (this.dcaConfig.strategy === 'LONG' && potentialNewSL > this.currentSLPrice) {
                this.currentSLPrice = potentialNewSL;
            } else if (this.dcaConfig.strategy === 'SHORT' && potentialNewSL < this.currentSLPrice) {
                this.currentSLPrice = potentialNewSL;
            }
        }

        if (this.currentSLPrice > 0) {
            const slTriggered = this.dcaConfig.strategy === 'LONG' ? price <= this.currentSLPrice : price >= this.currentSLPrice;
            if (slTriggered) {
                await this.executeExit('Stop Loss (Trailing)');
                return;
            }
        }
    }

    async manualAveragingBuy(amount: number): Promise<void> {
        const side = this.dcaConfig.strategy === 'LONG' ? 'buy' : 'sell';
        try {
            const order = await this.exchange.createOrder({
                userId: this.bot.userId,
                botId: this.bot.id,
                pair: this.bot.pair,
                side,
                type: 'market',
                amount
            });
            await this.onOrderFilled(order);
        } catch (error) {
            console.error('[DCA] Manual Averaging failed:', error);
        }
    }

    protected async checkIndicatorCondition(condition: any, isEntry: boolean = false): Promise<boolean> {
        try {
            const candles = await this.exchange.getCandles(this.bot.pair, condition.timeframe, 100);
            const closePrices = candles.map((c: any) => parseFloat(c[4]));
            const signal = indicatorService.generateSignal(condition.type, closePrices, condition.config);
            const expected = isEntry
                ? (this.dcaConfig.strategy === 'LONG' ? 'BUY' : 'SELL')
                : (this.dcaConfig.strategy === 'LONG' ? 'SELL' : 'BUY');
            return signal === expected;
        } catch (error) {
            return false;
        }
    }

    protected calculatePnL(currentPrice: number): number {
        if (this.avgEntryPrice === 0) return 0;
        const factor = this.dcaConfig.strategy === 'LONG' ? 1 : -1;
        return ((currentPrice - this.avgEntryPrice) / this.avgEntryPrice) * 100 * factor;
    }

    protected async syncSafetyOrders() {
        if (this.isPaused) return;
        const maxTotalCount = this.dcaConfig.averagingOrdersQuantity;
        const activeLimit = this.dcaConfig.activeOrdersLimitEnabled ? (this.dcaConfig.activeOrdersLimit || 1) : 1;
        let currentOnBook = this.safetyOrderMap.size;
        while (currentOnBook < activeLimit && this.nextSafetyOrderToIndex < maxTotalCount) {
            await this.placeNextSafetyOrder(this.nextSafetyOrderToIndex);
            currentOnBook++;
            this.nextSafetyOrderToIndex++;
        }
    }

    protected async placeNextSafetyOrder(index: number) {
        const baseStep = this.dcaConfig.averagingOrdersStep;
        const stepMult = this.dcaConfig.stepMultiplier || 1.0;
        const amountMult = this.dcaConfig.amountMultiplier || 1.0;
        let totalDeviation = 0;
        for (let i = 0; i <= index; i++) {
            totalDeviation += baseStep * Math.pow(stepMult, i);
        }
        const initialPrice = this.filledOrders[0]?.price || await this.getCurrentPrice();
        const side = this.dcaConfig.strategy === 'LONG' ? 'buy' : 'sell';
        const price = side === 'buy' ? initialPrice * (1 - totalDeviation / 100) : initialPrice * (1 + totalDeviation / 100);
        const currentAmount = this.dcaConfig.averagingOrdersAmount * Math.pow(amountMult, index);
        try {
            const order = await this.exchange.createOrder({
                userId: this.bot.userId,
                botId: this.bot.id,
                pair: this.bot.pair,
                side,
                type: 'limit',
                price,
                amount: currentAmount
            });
            this.activeOrders.set(order.id, order);
            this.safetyOrderMap.set(order.id, index);
        } catch (error) {
            console.error(`[DCA] SO ${index} failed:`, error);
        }
    }

    protected async executeExit(reason: string) {
        console.log(`[DCA] ${reason} triggered. Closing position.`);
        await this.cancelAllActiveOrders();
        const side = this.dcaConfig.strategy === 'LONG' ? 'sell' : 'buy';
        try {
            const order = await this.exchange.createOrder({
                userId: this.bot.userId,
                botId: this.bot.id,
                pair: this.bot.pair,
                side,
                type: 'market',
                amount: this.totalAmountFilled
            });
            const realizedQuote = order.amount * order.price;
            const factor = this.dcaConfig.strategy === 'LONG' ? 1 : -1;
            const tradePnL = (realizedQuote - this.totalQuoteAssetSpent) * factor;
            this.bot.performance.botProfit += tradePnL;
            this.bot.performance.realizedPnL += tradePnL;
            if (this.dcaConfig.reinvestProfit && tradePnL > 0) {
                const oldInvestment = (this.config as any).investment;
                const newInvestment = oldInvestment + tradePnL;
                const scaleFactor = newInvestment / oldInvestment;

                console.log(`[DCA] Reinvesting profit. Scaling investment from ${oldInvestment} to ${newInvestment} (Factor: ${scaleFactor.toFixed(4)})`);

                (this.config as any).investment = newInvestment;
                (this.config as any).baseOrderAmount *= scaleFactor;
                (this.config as any).averagingOrdersAmount *= scaleFactor;

                this.bot.config = this.config; // Sync local bot object

                // Persist the updated config (scaled order sizes) to DB
                await botRepository.update(this.bot.id, this.bot.userId, { config: this.config });
            }
            await this.recordTrade(order);
            // RESET
            this.totalAmountFilled = 0;
            this.avgEntryPrice = 0;
            this.totalQuoteAssetSpent = 0;
            this.filledOrders = [];
            this.safetyOrdersFilledCount = 0;
            this.nextSafetyOrderToIndex = 0;
            this.isTrailingTP = false;
            this.currentSLPrice = 0;
            if (this.dcaConfig.cooldownSeconds) {
                this.isWaitingForEntry = false;
                setTimeout(() => { this.start(); }, this.dcaConfig.cooldownSeconds * 1000);
            } else {
                await this.start();
            }
        } catch (error) {
            console.error('[DCA] Exit failed:', error);
        }
    }

    async onOrderFilled(order: TradeOrder): Promise<void> {
        this.activeOrders.delete(order.id);
        this.lastFills.push(Date.now());
        if (this.lastFills.length > 10) this.lastFills.shift();
        if (this.safetyOrderMap.has(order.id)) {
            this.safetyOrderMap.delete(order.id);
            this.safetyOrdersFilledCount++;
        }
        const perf = this.bot.performance;
        if (order.side === (this.dcaConfig.strategy === 'LONG' ? 'buy' : 'sell')) {
            this.totalQuoteAssetSpent += (order.amount * order.price);
            this.totalAmountFilled += order.amount;
            this.avgEntryPrice = this.totalQuoteAssetSpent / this.totalAmountFilled;
            perf.baseBalance += order.amount;
        } else {
            perf.baseBalance -= order.amount;
        }
        this.filledOrders.push(order);
        await this.recordTrade(order);
        if (this.isPaused) return;
        await this.syncSafetyOrders();
    }
}

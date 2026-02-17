# K) Backtesting Architecture

## Overview

The backtesting system enables users to evaluate any of the 8 TradingTower strategies against historical market data before committing real capital. The core design principle is **maximum reuse**: strategies run through the exact same `IStrategy` interface used in live trading, with a `SimulatedExchangeConnector` standing in for the real exchange. This means every bug fix, parameter tweak, and risk check that applies to live trading also applies to backtests, giving users an honest simulation of how a strategy would have performed.

---

## A) Architecture Overview

### How Backtesting Fits the Existing Framework

```
LIVE TRADING                              BACKTESTING
=============                             ===========

IStrategy (Grid, DCA, etc.)               IStrategy (same code, same instance)
    |                                         |
    v                                         v
IExchangeConnector (Alpaca, Coinbase...)  SimulatedExchangeConnector
    |                                         |
    v                                         v
Real Exchange REST/WS                     HistoricalDataService (OHLCV replay)
    |                                         |
    v                                         v
Real fills, real money                    Simulated fills, simulated balance
```

The strategy code has zero awareness of whether it is running live or in a backtest. The `SimulatedExchangeConnector` receives price events from the `BacktestEngine` (which replays historical candles), fills orders when price crosses order levels, and emits the same `OrderFill` events that a live connector would. The strategy's `onPriceUpdate`, `onOrderFill`, `checkpoint`, and `getMetrics` methods all work identically.

### Components

| Component | Package | Responsibility |
|-----------|---------|---------------|
| `BacktestEngine` | `@tradetower/bot-engine` | Orchestrates the backtest: loads data, replays candles, drives the strategy, collects results |
| `SimulatedExchangeConnector` | `@tradetower/exchange-connectors` | Extends `MockExchangeConnector` with realistic fill simulation, slippage, fees, and balance tracking |
| `HistoricalDataService` | `@tradetower/market-data` | Fetches, caches, and serves OHLCV candle data from exchange APIs and Azure Blob Storage |
| `BacktestResultsRepository` | `@tradetower/data-access` | Persists backtest configs, results, and equity curves to Cosmos DB + Blob Storage |
| Backtest API endpoints | `@tradetower/api` | REST endpoints for running, querying, and comparing backtests |
| Backtest UI | `@tradetower/web` | Configuration form, equity curve charts, trade table, metrics dashboard |

---

## B) BacktestEngine Design

### Configuration

```typescript
interface BacktestConfig {
  // Identity
  userId: string;
  backtestId: string;                    // Generated UUID

  // Strategy (reuses the same config as live bots)
  strategyType: StrategyType;            // GRID | DCA | DCA_FUTURES | BTD | COMBO | LOOP | FUTURES_GRID | TWAP
  strategyConfig: StrategyConfigUnion;   // Same discriminated union from BotDefinition

  // Market context
  pair: string;                          // e.g., "BTC/USD", "AAPL"
  exchange: ExchangeId;                  // ALPACA | COINBASE | IBKR | TASTYTRADE
  assetClass: AssetClass;               // CRYPTO_SPOT | US_EQUITY | FUTURES | etc.

  // Time range
  startDate: string;                     // ISO 8601
  endDate: string;                       // ISO 8601
  timeframe: CandleTimeframe;            // '1m' | '5m' | '15m' | '1h' | '4h' | '1d'

  // Capital
  initialBalance: number;
  currency: string;                      // 'USD', 'USDT', etc.

  // Simulation fidelity
  slippageModel: SlippageModel;
  feeModel: FeeModel;
  marketHoursEnabled: boolean;           // Stocks/ETFs: skip candles outside 04:00-20:00 ET. LIMIT-only in pre/post. Crypto: ignored (24/7).
}

type CandleTimeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';

type SlippageModel =
  | { type: 'NONE' }
  | { type: 'FIXED_BPS'; basisPoints: number }                    // e.g., 5 bps
  | { type: 'VOLUME_BASED'; impactFactor: number; maxBps: number }; // slippage proportional to order size vs candle volume

interface FeeModel {
  makerFeeBps: number;                   // e.g., 10 = 0.10%
  takerFeeBps: number;                   // e.g., 15 = 0.15%
}
```

### Result

```typescript
interface BacktestResult {
  // Identity
  backtestId: string;
  userId: string;
  config: BacktestConfig;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  progress: number;                      // 0-100

  // Performance metrics
  totalReturn: number;                   // Absolute PnL in quote currency
  totalReturnPercent: number;            // (finalEquity - initialBalance) / initialBalance * 100
  annualizedReturn: number;              // Annualized return percentage
  maxDrawdown: number;                   // Absolute max drawdown
  maxDrawdownPercent: number;            // Max drawdown as % of peak equity
  sharpeRatio: number;                   // (annualizedReturn - riskFreeRate) / annualizedStdDev
  sortinoRatio: number;                  // Same but only downside deviation
  calmarRatio: number;                   // annualizedReturn / maxDrawdownPercent
  winRate: number;                       // Winning trades / total trades
  profitFactor: number;                  // Gross profit / gross loss
  totalTrades: number;
  avgTradeProfit: number;                // Average profit per trade
  avgTradeDuration: number;              // Average time a position was held (ms)
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  totalFeesPaid: number;
  totalSlippage: number;

  // Time series data for charting
  equityCurve: EquityPoint[];
  drawdownCurve: DrawdownPoint[];
  trades: BacktestTrade[];

  // Benchmark comparison
  buyAndHoldReturn: number;              // Simple buy-and-hold over same period
  buyAndHoldReturnPercent: number;
  alphaVsBuyAndHold: number;             // Strategy return - buy and hold return

  // Strategy-specific stats
  strategyStats: StrategySpecificStats;

  // Execution metadata
  executionTimeMs: number;
  candlesProcessed: number;
  startedAt: string;
  completedAt: string;
}

interface EquityPoint {
  timestamp: number;
  equity: number;
  unrealizedPnl: number;
}

interface DrawdownPoint {
  timestamp: number;
  drawdown: number;                      // Always <= 0
  drawdownPercent: number;
}

interface BacktestTrade {
  tradeId: string;
  entryTimestamp: number;
  exitTimestamp: number;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  exitPrice: number;
  amount: number;
  profit: number;
  profitPercent: number;
  fees: number;
  slippage: number;
  purpose: string;                       // 'GRID_ORDER' | 'AVERAGING_ORDER' | 'TWAP_SLICE' | etc.
  gridLevel?: number;
  safetyOrderIndex?: number;
}

// Per-strategy breakdown
type StrategySpecificStats =
  | GridBacktestStats
  | DcaBacktestStats
  | TwapBacktestStats
  | GenericBacktestStats;

interface GridBacktestStats {
  strategyType: 'GRID';
  totalGridCycles: number;               // Buy-sell round trips
  avgGridProfit: number;
  trailingUpEvents: number;
  trailingDownEvents: number;
  pumpProtectionActivations: number;
  gridUtilization: number;               // % of grid levels that were ever filled
}

interface DcaBacktestStats {
  strategyType: 'DCA' | 'DCA_FUTURES';
  totalDcaCycles: number;
  avgEntryPrice: number;
  avgSafetyOrdersPerCycle: number;
  maxSafetyOrdersUsed: number;
  avgCycleDuration: number;
}

interface TwapBacktestStats {
  strategyType: 'TWAP';
  vwap: number;
  bestSlicePrice: number;
  worstSlicePrice: number;
  slicesExecuted: number;
  slicesPaused: number;                  // Due to price limit
  avgSlippageBps: number;
}

interface GenericBacktestStats {
  strategyType: 'BTD' | 'COMBO' | 'LOOP' | 'FUTURES_GRID';
  [key: string]: unknown;
}
```

### Engine Core Loop

```typescript
class BacktestEngine {
  private strategy: IStrategy;
  private connector: SimulatedExchangeConnector;
  private dataService: HistoricalDataService;
  private resultsRepo: BacktestResultsRepository;

  async run(config: BacktestConfig): Promise<BacktestResult> {
    const startTime = Date.now();

    // 1. Load historical data
    const candles = await this.dataService.getCandles({
      pair: config.pair,
      exchange: config.exchange,
      timeframe: config.timeframe,
      startDate: config.startDate,
      endDate: config.endDate,
    });

    // 2. Initialize simulated connector
    this.connector = new SimulatedExchangeConnector({
      initialBalance: config.initialBalance,
      currency: config.currency,
      feeModel: config.feeModel,
      slippageModel: config.slippageModel,
      assetClass: config.assetClass,
      marketHoursEnabled: config.marketHoursEnabled,
    });

    // 3. Instantiate strategy (same factory as live bots)
    this.strategy = StrategyFactory.create(config.strategyType);
    await this.strategy.initialize(config.strategyConfig);

    // Wire strategy to simulated connector
    this.connector.on('orderFill', (fill) => this.strategy.onOrderFill(fill));
    this.connector.on('orderCancelled', (cancel) => this.strategy.onOrderCancelled(cancel));

    // 4. Start strategy
    await this.strategy.start();

    // 5. Replay candles
    const equityCurve: EquityPoint[] = [];
    let candlesProcessed = 0;

    for (const candle of candles) {
      // Skip if market closed and marketHoursEnabled
      if (config.marketHoursEnabled && !this.isMarketOpen(candle.timestamp, config.assetClass)) {
        continue;
      }

      // Feed candle to connector (processes pending order fills)
      this.connector.processCandle(candle);

      // Feed price tick to strategy
      const tick: PriceTick = {
        pair: config.pair,
        price: candle.close,
        bid: candle.close * 0.9999,
        ask: candle.close * 1.0001,
        volume: candle.volume,
        timestamp: candle.timestamp,
      };
      await this.strategy.onPriceUpdate(tick);

      // Feed candle close to strategy (for indicator evaluation)
      if (this.strategy.onCandleClose) {
        await this.strategy.onCandleClose(candle);
      }

      // Record equity
      const balance = this.connector.getBalanceSync();
      const unrealizedPnl = this.connector.getUnrealizedPnl(candle.close);
      equityCurve.push({
        timestamp: candle.timestamp,
        equity: balance + unrealizedPnl,
        unrealizedPnl,
      });

      candlesProcessed++;

      // Report progress (every 1% of candles)
      if (candlesProcessed % Math.ceil(candles.length / 100) === 0) {
        await this.resultsRepo.updateProgress(
          config.backtestId,
          Math.round((candlesProcessed / candles.length) * 100)
        );
      }
    }

    // 6. Close out strategy (market close remaining positions)
    await this.strategy.stop({ closureStrategy: 'CLOSE_POSITIONS' });
    this.connector.processCandle(candles[candles.length - 1]); // Process final fills

    // 7. Calculate metrics
    const trades = this.connector.getTradeLog();
    const metrics = this.calculateMetrics(
      config, equityCurve, trades, candles, startTime
    );

    return metrics;
  }

  private calculateMetrics(
    config: BacktestConfig,
    equityCurve: EquityPoint[],
    trades: BacktestTrade[],
    candles: OHLCV[],
    startTime: number,
  ): BacktestResult {
    const finalEquity = equityCurve[equityCurve.length - 1]?.equity ?? config.initialBalance;
    const totalReturn = finalEquity - config.initialBalance;
    const totalReturnPercent = (totalReturn / config.initialBalance) * 100;

    // Max drawdown
    let peak = config.initialBalance;
    let maxDrawdown = 0;
    let maxDrawdownPercent = 0;
    const drawdownCurve: DrawdownPoint[] = [];
    for (const point of equityCurve) {
      if (point.equity > peak) peak = point.equity;
      const dd = point.equity - peak;
      const ddPercent = peak > 0 ? (dd / peak) * 100 : 0;
      if (dd < maxDrawdown) {
        maxDrawdown = dd;
        maxDrawdownPercent = ddPercent;
      }
      drawdownCurve.push({ timestamp: point.timestamp, drawdown: dd, drawdownPercent: ddPercent });
    }

    // Win rate & profit factor
    const winningTrades = trades.filter(t => t.profit > 0);
    const losingTrades = trades.filter(t => t.profit <= 0);
    const grossProfit = winningTrades.reduce((s, t) => s + t.profit, 0);
    const grossLoss = Math.abs(losingTrades.reduce((s, t) => s + t.profit, 0));
    const winRate = trades.length > 0 ? winningTrades.length / trades.length : 0;
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

    // Sharpe ratio (annualized, assuming 252 trading days)
    const dailyReturns = this.computeDailyReturns(equityCurve);
    const avgDailyReturn = dailyReturns.reduce((s, r) => s + r, 0) / (dailyReturns.length || 1);
    const stdDev = Math.sqrt(
      dailyReturns.reduce((s, r) => s + (r - avgDailyReturn) ** 2, 0) / (dailyReturns.length || 1)
    );
    const annualizedReturn = avgDailyReturn * 252;
    const annualizedStdDev = stdDev * Math.sqrt(252);
    const riskFreeRate = 0.05; // 5% annual
    const sharpeRatio = annualizedStdDev > 0
      ? (annualizedReturn - riskFreeRate) / annualizedStdDev
      : 0;

    // Buy-and-hold benchmark
    const startPrice = candles[0]?.open ?? 0;
    const endPrice = candles[candles.length - 1]?.close ?? 0;
    const buyAndHoldReturn = startPrice > 0
      ? ((endPrice - startPrice) / startPrice) * config.initialBalance
      : 0;
    const buyAndHoldReturnPercent = startPrice > 0
      ? ((endPrice - startPrice) / startPrice) * 100
      : 0;

    return {
      backtestId: config.backtestId,
      userId: config.userId,
      config,
      status: 'COMPLETED',
      progress: 100,
      totalReturn,
      totalReturnPercent,
      annualizedReturn: annualizedReturn * 100,
      maxDrawdown,
      maxDrawdownPercent,
      sharpeRatio,
      sortinoRatio: this.computeSortinoRatio(dailyReturns, riskFreeRate),
      calmarRatio: maxDrawdownPercent !== 0 ? (annualizedReturn * 100) / Math.abs(maxDrawdownPercent) : 0,
      winRate,
      profitFactor,
      totalTrades: trades.length,
      avgTradeProfit: trades.length > 0 ? totalReturn / trades.length : 0,
      avgTradeDuration: this.computeAvgDuration(trades),
      maxConsecutiveWins: this.computeMaxConsecutive(trades, true),
      maxConsecutiveLosses: this.computeMaxConsecutive(trades, false),
      totalFeesPaid: trades.reduce((s, t) => s + t.fees, 0),
      totalSlippage: trades.reduce((s, t) => s + t.slippage, 0),
      equityCurve,
      drawdownCurve,
      trades,
      buyAndHoldReturn,
      buyAndHoldReturnPercent,
      alphaVsBuyAndHold: totalReturnPercent - buyAndHoldReturnPercent,
      strategyStats: this.computeStrategyStats(config.strategyType, trades),
      executionTimeMs: Date.now() - startTime,
      candlesProcessed: candles.length,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
    };
  }
}
```

---

## C) Historical Data Service

### Data Sources by Exchange

| Exchange | Historical Data API | Max Range | Rate Limits | Granularity |
|----------|-------------------|-----------|-------------|-------------|
| **Alpaca** | `GET /v2/stocks/{symbol}/bars` + `GET /v1beta3/crypto/{loc}/bars` | Unlimited (IEX), 5yr (SIP) | 200 req/min | 1m, 5m, 15m, 1h, 1d |
| **Coinbase** | `GET /api/v3/brokerage/market/products/{product_id}/candles` | 300 candles per request | 10 req/s (public) | 1m, 5m, 15m, 1h, 6h, 1d |
| **IBKR** | TWS `reqHistoricalData` | 1yr (1m), unlimited (1d) | 6 req/10s (strict pacing) | 1s, 5s, 1m, 5m, 1h, 1d |
| **Tasty Trade** | DXLink historical candles | Varies by subscription | 120 req/min | 1m, 5m, 15m, 1h, 1d |

### Storage Architecture

```
Azure Blob Storage (Hot tier)
  └── historical-data/
      ├── alpaca/
      │   ├── US_EQUITY/
      │   │   ├── AAPL/
      │   │   │   ├── 1m/2024-01.parquet
      │   │   │   ├── 1m/2024-02.parquet
      │   │   │   ├── 5m/2024-01.parquet
      │   │   │   ├── 1h/2024.parquet
      │   │   │   └── 1d/all.parquet
      │   │   └── SPY/
      │   │       └── ...
      │   └── CRYPTO_SPOT/
      │       └── BTC-USD/
      │           └── ...
      ├── coinbase/
      │   └── CRYPTO_SPOT/
      │       └── ...
      ├── ibkr/
      │   └── ...
      └── tastytrade/
          └── ...
```

**File format**: Apache Parquet (columnar, compressed, fast range queries). Each file contains one month of data at the given timeframe. Parquet is chosen over CSV because it is 5-10x smaller, supports predicate pushdown for date ranges, and TypeScript has mature libraries (`parquetjs-lite`, `@duckdb/duckdb-wasm`).

**Fallback for MVP**: CSV files in Blob Storage with newline-delimited rows. Simpler to generate and debug, adequate for early usage. Migrate to Parquet once backtest volume justifies the optimization.

### Cosmos DB Metadata

A `HistoricalDataCatalog` container in Cosmos DB tracks what data is available:

```typescript
interface HistoricalDataCatalog {
  id: string;                            // "{exchange}:{assetClass}:{symbol}:{timeframe}"
  exchange: ExchangeId;
  assetClass: AssetClass;
  symbol: string;
  timeframe: CandleTimeframe;
  earliestDate: string;                  // ISO 8601
  latestDate: string;                    // ISO 8601
  totalCandles: number;
  blobPath: string;                      // Path in Blob Storage
  lastUpdatedAt: string;
  status: 'AVAILABLE' | 'FETCHING' | 'ERROR';
}
// Partition key: /exchange
```

### Data Pipeline

```
User requests backtest
  |
  v
HistoricalDataService.getCandles(pair, exchange, timeframe, startDate, endDate)
  |
  v
Check HistoricalDataCatalog (Cosmos DB)
  |
  +-- Data available in Blob Storage?
  |     |
  |     YES --> Stream from Blob Storage, return OHLCV[]
  |     |
  |     NO --> Fetch from exchange API
  |              |
  |              v
  |            Normalize to standard OHLCV format
  |              |
  |              v
  |            Write to Blob Storage (background, non-blocking)
  |              |
  |              v
  |            Update HistoricalDataCatalog
  |              |
  |              v
  |            Return OHLCV[]
  |
  v
BacktestEngine receives candle array
```

### Standard OHLCV Format

```typescript
interface OHLCV {
  timestamp: number;                     // Unix milliseconds (UTC)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;                        // In base currency
}
```

### Background Data Ingestion

A scheduled Azure Function runs nightly to backfill popular pairs:

1. Query most-used pairs from `BotDefinitions` (top 20 by count)
2. For each pair + each timeframe, fetch missing date ranges from exchange APIs
3. Write to Blob Storage, update catalog
4. Retention: keep 2 years of 1m data, 5 years of 1h and 1d data

This ensures that popular backtests hit cached data and do not block on exchange API calls.

---

## D) Simulation Engine

### SimulatedExchangeConnector

Extends `MockExchangeConnector` with realistic execution simulation.

```typescript
class SimulatedExchangeConnector extends MockExchangeConnector {
  private balance: Map<string, number>;          // currency -> available
  private positions: Map<string, SimPosition>;   // symbol -> position
  private openOrders: Map<string, SimOrder>;     // orderId -> order
  private tradeLog: BacktestTrade[];
  private feeModel: FeeModel;
  private slippageModel: SlippageModel;
  private currentCandle: OHLCV | null;

  constructor(config: SimConnectorConfig) {
    super();
    this.balance = new Map([[config.currency, config.initialBalance]]);
    this.positions = new Map();
    this.openOrders = new Map();
    this.tradeLog = [];
    this.feeModel = config.feeModel;
    this.slippageModel = config.slippageModel;
  }

  // -------------------------------------------------------
  // Called by BacktestEngine for each candle
  // -------------------------------------------------------
  processCandle(candle: OHLCV): void {
    this.currentCandle = candle;
    this.tryFillOrders(candle);
  }

  // -------------------------------------------------------
  // Order lifecycle (called by IStrategy)
  // -------------------------------------------------------
  async placeOrder(order: ExchangeOrderRequest): Promise<ExchangeOrderResponse> {
    // Validate balance
    const cost = this.estimateOrderCost(order);
    if (!this.hasSufficientBalance(order, cost)) {
      return { exchangeOrderId: order.clientOrderId, status: 'REJECTED' };
    }

    // Reserve funds
    this.reserveBalance(order, cost);

    const simOrder: SimOrder = {
      id: order.clientOrderId,
      side: order.side,
      type: order.orderType,
      price: order.price ?? 0,
      amount: order.amount,
      filledAmount: 0,
      status: 'OPEN',
      createdAt: this.currentCandle?.timestamp ?? Date.now(),
    };

    // Market orders fill immediately on current candle
    if (order.orderType === 'MARKET') {
      this.fillMarketOrder(simOrder);
      return { exchangeOrderId: simOrder.id, status: 'FILLED' };
    }

    this.openOrders.set(simOrder.id, simOrder);
    return { exchangeOrderId: simOrder.id, status: 'OPEN' };
  }

  async cancelOrder(orderId: string): Promise<void> {
    const order = this.openOrders.get(orderId);
    if (!order) return;
    this.releaseReservedBalance(order);
    this.openOrders.delete(orderId);
    this.emit('orderCancelled', { orderId, reason: 'USER_CANCELLED' });
  }

  async cancelAllOrders(symbol?: string): Promise<number> {
    let count = 0;
    for (const [id, order] of this.openOrders) {
      this.releaseReservedBalance(order);
      this.openOrders.delete(id);
      count++;
    }
    return count;
  }

  async getBalance(currency?: string): Promise<ExchangeBalance[]> {
    const result: ExchangeBalance[] = [];
    for (const [cur, amount] of this.balance) {
      if (!currency || cur === currency) {
        result.push({ currency: cur, available: amount, total: amount });
      }
    }
    return result;
  }

  async getPosition(symbol: string): Promise<ExchangePosition | null> {
    return this.positions.get(symbol) ?? null;
  }

  // -------------------------------------------------------
  // Fill logic
  // -------------------------------------------------------
  private tryFillOrders(candle: OHLCV): void {
    for (const [id, order] of this.openOrders) {
      if (this.shouldFill(order, candle)) {
        this.fillLimitOrder(order, candle);
        this.openOrders.delete(id);
      }
    }
  }

  private shouldFill(order: SimOrder, candle: OHLCV): boolean {
    if (order.type === 'LIMIT') {
      // BUY LIMIT: fills when candle low <= order price
      if (order.side === 'BUY' && candle.low <= order.price) return true;
      // SELL LIMIT: fills when candle high >= order price
      if (order.side === 'SELL' && candle.high >= order.price) return true;
    }

    if (order.type === 'STOP_LIMIT') {
      // BUY STOP: fills when candle high >= order price (breakout entry)
      if (order.side === 'BUY' && candle.high >= order.price) return true;
      // SELL STOP: fills when candle low <= order price (stop loss)
      if (order.side === 'SELL' && candle.low <= order.price) return true;
    }

    return false;
  }

  private fillLimitOrder(order: SimOrder, candle: OHLCV): void {
    // Fill price = order price (limit order guarantee) + slippage
    const basePrice = order.price;
    const fillPrice = this.applySlippage(basePrice, order.side, order.amount, candle.volume);
    this.executeFill(order, fillPrice, candle);
  }

  private fillMarketOrder(order: SimOrder): void {
    if (!this.currentCandle) return;
    // Market orders fill at candle close (conservative assumption)
    const basePrice = this.currentCandle.close;
    const fillPrice = this.applySlippage(
      basePrice, order.side, order.amount, this.currentCandle.volume
    );
    this.executeFill(order, fillPrice, this.currentCandle);
  }

  private executeFill(order: SimOrder, fillPrice: number, candle: OHLCV): void {
    // Partial fill simulation based on volume
    const maxFillableByVolume = candle.volume * 0.1;   // Assume max 10% of candle volume
    const fillAmount = Math.min(order.amount - order.filledAmount, maxFillableByVolume);

    if (fillAmount <= 0) return;

    const isPartial = fillAmount < (order.amount - order.filledAmount);
    const isMaker = order.type === 'LIMIT';
    const feeBps = isMaker ? this.feeModel.makerFeeBps : this.feeModel.takerFeeBps;
    const feeAmount = (fillPrice * fillAmount * feeBps) / 10_000;

    // Update balances
    this.updateBalancesOnFill(order.side, fillPrice, fillAmount, feeAmount);

    // Update position
    this.updatePosition(order.side, fillPrice, fillAmount);

    // Record trade
    order.filledAmount += fillAmount;

    // Emit fill event (same shape as live connector)
    const fill: OrderFill = {
      id: `fill-${order.id}-${Date.now()}`,
      documentType: 'ORDER_FILL',
      orderRequestId: order.id,
      botRunId: 'backtest',
      userId: 'backtest',
      exchangeOrderId: order.id,
      exchangeTradeId: `sim-${order.id}`,
      pair: '',
      side: order.side,
      fillPrice,
      fillAmount,
      fillValueQuote: fillPrice * fillAmount,
      feeAmount,
      feeCurrency: 'USD',
      isPartialFill: isPartial,
      cumulativeFilledAmount: order.filledAmount,
      remainingAmount: order.amount - order.filledAmount,
      realizedPnl: null,
      slippageBps: this.computeSlippageBps(order.price, fillPrice),
      filledAt: new Date(candle.timestamp).toISOString(),
    };

    this.emit('orderFill', fill);

    // If partial, leave order open for next candle
    if (isPartial) {
      order.status = 'PARTIALLY_FILLED';
    }
  }

  // -------------------------------------------------------
  // Slippage models
  // -------------------------------------------------------
  private applySlippage(
    basePrice: number, side: string, amount: number, candleVolume: number
  ): number {
    if (this.slippageModel.type === 'NONE') return basePrice;

    let slippageBps: number;

    if (this.slippageModel.type === 'FIXED_BPS') {
      slippageBps = this.slippageModel.basisPoints;
    } else {
      // VOLUME_BASED: slippage increases with order size relative to candle volume
      const volumeRatio = candleVolume > 0 ? amount / candleVolume : 1;
      slippageBps = Math.min(
        volumeRatio * this.slippageModel.impactFactor * 10_000,
        this.slippageModel.maxBps
      );
    }

    // Slippage always works against the trader
    const slippageFactor = slippageBps / 10_000;
    return side === 'BUY'
      ? basePrice * (1 + slippageFactor)
      : basePrice * (1 - slippageFactor);
  }

  // -------------------------------------------------------
  // Helpers
  // -------------------------------------------------------
  getBalanceSync(): number {
    return this.balance.get('USD') ?? 0;
  }

  getUnrealizedPnl(currentPrice: number): number {
    let pnl = 0;
    for (const [, pos] of this.positions) {
      if (pos.direction === 'LONG') {
        pnl += (currentPrice - pos.avgEntryPrice) * pos.amount;
      } else if (pos.direction === 'SHORT') {
        pnl += (pos.avgEntryPrice - currentPrice) * pos.amount;
      }
    }
    return pnl;
  }

  getTradeLog(): BacktestTrade[] {
    return [...this.tradeLog];
  }
}
```

### Key Simulation Rules

| Scenario | Handling |
|----------|----------|
| **BUY LIMIT fill** | Fills when candle `low <= orderPrice`. Fill price = `orderPrice + slippage`. |
| **SELL LIMIT fill** | Fills when candle `high >= orderPrice`. Fill price = `orderPrice - slippage`. |
| **Market order fill** | Fills immediately at candle `close + slippage`. |
| **Partial fill** | If order amount > 10% of candle volume, fills only 10% of volume per candle. Remainder carries over. |
| **Multiple fills in one candle** | Candle high/low may cross multiple order levels. Process from closest-to-price outward. |
| **Gap through price** | If a candle opens past an order (gap up/down), fill at the order price (not the gap price). Realistic for limit orders. |
| **Insufficient balance** | Order rejected with `REJECTED` status, same as live. |
| **Futures leverage** | Simulated margin = `orderValue / leverage`. Balance check uses margin, not full notional. |
| **Market hours (stocks/ETFs)** | When `marketHoursEnabled`: candles within **04:00-20:00 ET** are processed (pre-market + regular + post-market). Candles outside 04:00-20:00 ET are skipped. Pre/post-market candles only fill LIMIT orders (no market order fills — matches live behavior). Crypto: all candles processed (24/7). This matches the live trading policy in `05-strategy-engine.md`. |

---

## E) API Endpoints

### Backtest Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/backtests` | Submit a new backtest job (async). Returns `{ backtestId, status: 'PENDING' }` |
| `GET` | `/api/v1/backtests/:id` | Get full backtest result (if completed) or current status |
| `GET` | `/api/v1/backtests/:id/status` | Lightweight status check `{ status, progress }` |
| `GET` | `/api/v1/backtests` | List user's backtests (paginated, filterable by strategy, pair, date range) |
| `DELETE` | `/api/v1/backtests/:id` | Delete a backtest and its stored results |
| `POST` | `/api/v1/backtests/:id/cancel` | Cancel a running backtest |
| `GET` | `/api/v1/backtests/compare` | Compare multiple backtests `?ids=id1,id2,id3` |
| `GET` | `/api/v1/historical-data/availability` | Check available data ranges for a pair/exchange/timeframe |

### Request/Response Examples

**Submit backtest**:
```http
POST /api/v1/backtests
Content-Type: application/json
Authorization: Bearer <jwt>

{
  "strategyType": "GRID",
  "strategyConfig": {
    "strategyType": "GRID",
    "investment": 10000,
    "lowPrice": 90,
    "highPrice": 110,
    "gridStep": 2,
    "gridLevels": 10,
    "orderSizeCurrency": "QUOTE",
    "trailingUp": true,
    "trailingDown": false,
    "pumpProtection": true,
    "stopLossEnabled": false,
    "takeProfitEnabled": false
  },
  "pair": "BTC/USD",
  "exchange": "COINBASE",
  "assetClass": "CRYPTO_SPOT",
  "startDate": "2025-01-01T00:00:00Z",
  "endDate": "2025-06-01T00:00:00Z",
  "timeframe": "1h",
  "initialBalance": 10000,
  "currency": "USD",
  "slippageModel": { "type": "FIXED_BPS", "basisPoints": 5 },
  "feeModel": { "makerFeeBps": 10, "takerFeeBps": 15 },
  "marketHoursEnabled": false
}
```

**Response (202 Accepted)**:
```json
{
  "backtestId": "bt-abc123",
  "status": "PENDING",
  "estimatedDurationSeconds": 45
}
```

### Execution Model

Backtests run as background jobs on the Container Apps bot-engine instances. For MVP, a simple in-memory queue processes one backtest per container instance. The flow:

```
POST /api/v1/backtests
  --> Validate config (Zod schema, same as bot creation)
  --> Create BacktestResult document in Cosmos DB (status: PENDING)
  --> Publish to Service Bus topic: backtest-jobs
  --> Return 202 with backtestId

BacktestWorker (on bot-engine Container App):
  --> Subscribe to backtest-jobs
  --> Pick up job
  --> Update status to RUNNING
  --> Execute BacktestEngine.run(config)
  --> Store result in Cosmos DB (metrics) + Blob Storage (equity curve, trades)
  --> Update status to COMPLETED
```

### Resource Limits (Anti-Abuse)

| Limit | Value | Rationale |
|-------|-------|-----------|
| Max concurrent backtests per user | 3 | Prevent resource hogging |
| Max candle count per backtest | 500,000 | ~347 days of 1m data |
| Max backtest duration (wall clock) | 5 minutes | Timeout and mark FAILED |
| Max backtests per user per day | 50 | Free tier; configurable per subscription |
| Max stored backtests per user | 100 | Oldest auto-deleted |

---

## F) Data Storage

### Cosmos DB Container: Backtests

```typescript
interface BacktestDocument {
  id: string;                            // backtestId
  userId: string;                        // Partition key
  tenantId: string;
  config: BacktestConfig;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  progress: number;

  // Summary metrics (inline for fast listing queries)
  summary?: {
    totalReturnPercent: number;
    maxDrawdownPercent: number;
    sharpeRatio: number;
    winRate: number;
    totalTrades: number;
    buyAndHoldReturnPercent: number;
    executionTimeMs: number;
  };

  // Large payloads stored in Blob Storage (referenced by URL)
  equityCurveBlobUrl?: string;
  tradesBlobUrl?: string;
  fullResultBlobUrl?: string;

  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  errorMessage?: string;
  ttl?: number;                          // Auto-expire after 90 days
}
// Partition key: /userId
```

### Blob Storage Layout

```
backtest-results/
  └── {userId}/
      └── {backtestId}/
          ├── equity-curve.json          // EquityPoint[] (can be 500K+ points)
          ├── trades.json                // BacktestTrade[] (can be 10K+ trades)
          └── full-result.json           // Complete BacktestResult
```

Large time-series data (equity curve, individual trades) lives in Blob Storage because Cosmos DB has a 2MB document size limit and these arrays can grow very large. The Cosmos document stores summary metrics for fast listing and the blob URLs for detail retrieval.

---

## G) Frontend Components

### Backtest Configuration Form

The backtest configuration form **reuses** the existing bot creation wizard strategy forms (from task 8.2.2 in the implementation plan). The user selects a strategy type, and the same React form components render with the same Zod validation. The backtest form wraps the strategy config with additional fields:

```
+------------------------------------------------------------------+
| NEW BACKTEST                                                      |
|                                                                   |
| Strategy:  [Grid  v]   (dropdown - same as bot creation)          |
|                                                                   |
| +--------------------------------------------------------------+ |
| | STRATEGY CONFIG (reused from bot wizard)                      | |
| | Investment: [10,000]   Low Price: [90]   High Price: [110]    | |
| | Grid Step: [2%]        Grid Levels: [10]                      | |
| | Order Size: [QUOTE v]  Trailing Up: [x]                      | |
| | ...                                                           | |
| +--------------------------------------------------------------+ |
|                                                                   |
| BACKTEST SETTINGS                                                 |
| Exchange:    [Coinbase v]   Pair: [BTC/USD]                       |
| Start Date:  [2025-01-01]  End Date: [2025-06-01]                |
| Timeframe:   [1h v]        Initial Balance: [10,000 USD]         |
|                                                                   |
| SIMULATION FIDELITY                                               |
| Slippage:    [Fixed 5 bps v]                                     |
| Maker Fee:   [0.10%]       Taker Fee: [0.15%]                   |
| Market Hours: [x] Respect stock market hours                     |
|                                                                   |
| [Check Data Availability]  [Run Backtest]                        |
+------------------------------------------------------------------+
```

### Results Dashboard

```
+------------------------------------------------------------------+
| BACKTEST RESULTS: Grid / BTC/USD / Jan-Jun 2025                  |
|                                                                   |
| STATUS: Completed in 12.4s  |  4,344 candles processed           |
|                                                                   |
| +------------------+  +------------------+  +------------------+  |
| | Total Return     |  | Max Drawdown     |  | Sharpe Ratio     |  |
| | +18.4%           |  | -6.2%            |  | 1.87             |  |
| | ($1,840)         |  | ($620)           |  |                  |  |
| +------------------+  +------------------+  +------------------+  |
| +------------------+  +------------------+  +------------------+  |
| | Win Rate         |  | Profit Factor    |  | vs Buy & Hold    |  |
| | 62.3%            |  | 2.14             |  | +5.1%            |  |
| | (156/250 trades) |  |                  |  | (Strategy alpha) |  |
| +------------------+  +------------------+  +------------------+  |
|                                                                   |
| EQUITY CURVE                                                      |
| [Interactive line chart: equity over time vs buy-and-hold line]   |
|                                                                   |
| DRAWDOWN                                                          |
| [Area chart: drawdown % over time, red-shaded]                   |
|                                                                   |
| MONTHLY RETURNS HEATMAP                                           |
| [Grid: months vs returns, green/red shading]                     |
|                                                                   |
| TRADES TABLE                                                      |
| | # | Time | Side | Entry | Exit | Amount | P&L | Fees | Level | |
| | 1 | Jan 3 | BUY  | 95.2 | 97.1 | 100 | +$190 | $3 | L3   | |
| | 2 | Jan 3 | SELL | 97.1 | 95.8 | 100 | -$130 | $3 | L5   | |
| | ...                                                             |
| [Export CSV]   [Export JSON]                                      |
|                                                                   |
| STRATEGY-SPECIFIC METRICS (Grid)                                  |
| Grid Cycles: 125  |  Avg Grid Profit: $14.72                    |
| Trailing Up: 8x   |  Pump Protections: 2x                       |
| Grid Utilization: 87%                                            |
+------------------------------------------------------------------+
```

### Compare Multiple Backtests

Users can select 2-5 previous backtests and view a comparison table:

```
+--------------------------------------------------------------------+
| COMPARE BACKTESTS                                                   |
|                                                                     |
| Metric          | Grid/BTC   | DCA/BTC    | Grid/AAPL  | Loop/ETH  |
| Return %        | +18.4%     | +12.1%     | +8.7%      | +22.3%    |
| Max Drawdown    | -6.2%      | -3.1%      | -11.4%     | -9.8%     |
| Sharpe          | 1.87       | 2.41       | 0.92       | 1.54      |
| Win Rate        | 62.3%      | 78.1%      | 55.2%      | 68.4%     |
| Total Trades    | 250        | 45         | 180        | 312       |
| vs Buy&Hold     | +5.1%      | +2.8%      | -1.3%      | +8.9%     |
|                                                                     |
| [Overlay equity curves on single chart]                            |
+--------------------------------------------------------------------+
```

---

## H) TDD Approach

### Test Structure

All backtest tests live in `packages/bot-engine/tests/backtest/` and `packages/exchange-connectors/tests/simulated/`.

### 1. SimulatedExchangeConnector Tests (~35 tests)

```typescript
describe('SimulatedExchangeConnector', () => {
  describe('Order placement', () => {
    it('should accept a limit buy order and track it as open');
    it('should reject an order when balance is insufficient');
    it('should fill a market buy order immediately at candle close');
    it('should fill a market sell order immediately at candle close');
    it('should reserve funds on limit order placement');
    it('should release reserved funds on order cancellation');
  });

  describe('Limit order fill logic', () => {
    it('should fill BUY LIMIT when candle low <= order price');
    it('should NOT fill BUY LIMIT when candle low > order price');
    it('should fill SELL LIMIT when candle high >= order price');
    it('should NOT fill SELL LIMIT when candle high < order price');
    it('should fill STOP BUY when candle high >= stop price');
    it('should fill STOP SELL when candle low <= stop price');
    it('should fill at order price (not candle extreme) for limit orders');
    it('should process multiple orders in a single candle, closest-to-price first');
    it('should handle gap-through: fill at order price even if candle opens past it');
  });

  describe('Partial fills', () => {
    it('should partially fill when order amount > 10% of candle volume');
    it('should carry remaining amount to next candle');
    it('should emit isPartialFill=true on partial fills');
    it('should emit isPartialFill=false when fully filled');
  });

  describe('Slippage models', () => {
    it('should apply zero slippage with NONE model');
    it('should apply fixed basis points slippage (BUY: price increases)');
    it('should apply fixed basis points slippage (SELL: price decreases)');
    it('should scale slippage with volume ratio in VOLUME_BASED model');
    it('should cap slippage at maxBps in VOLUME_BASED model');
  });

  describe('Fee calculation', () => {
    it('should charge maker fee for limit order fills');
    it('should charge taker fee for market order fills');
    it('should deduct fees from balance on fill');
  });

  describe('Balance and position tracking', () => {
    it('should reduce quote balance and increase base position on BUY fill');
    it('should reduce base position and increase quote balance on SELL fill');
    it('should calculate unrealized PnL for open LONG position');
    it('should calculate unrealized PnL for open SHORT position');
    it('should return correct equity (balance + unrealized PnL)');
  });
});
```

### 2. BacktestEngine Tests (~30 tests)

```typescript
describe('BacktestEngine', () => {
  describe('Lifecycle', () => {
    it('should run a complete backtest with known price sequence and return results');
    it('should initialize strategy with provided config');
    it('should close positions at end of backtest');
    it('should report progress during execution');
    it('should handle empty candle arrays gracefully');
    it('should timeout after 5 minutes and mark as FAILED');
    it('should handle cancellation mid-run');
  });

  describe('Metrics calculation', () => {
    it('should calculate total return correctly for profitable run');
    it('should calculate total return correctly for losing run');
    it('should compute max drawdown from equity curve');
    it('should compute Sharpe ratio from daily returns');
    it('should compute win rate as winning trades / total trades');
    it('should compute profit factor as gross profit / gross loss');
    it('should handle zero trades (no division by zero)');
    it('should compute buy-and-hold benchmark from first open to last close');
    it('should compute alpha vs buy-and-hold');
  });

  describe('Strategy integration', () => {
    // Known price sequence tests with deterministic outcomes
    it('Grid: sideways market with 10 price oscillations should produce ~10 round-trip profits');
    it('DCA: downtrend followed by recovery should show averaging-down benefit');
    it('TWAP: flat market should fill all slices near target price');
    it('Grid: strong uptrend with trailing should shift grid upward');
    it('DCA Futures: should respect liquidation buffer during sharp drawdown');
    it('BTD: should accumulate on dip and profit on recovery');
    it('Loop: should fill gaps before expanding grid');
    it('Futures Grid: LONG mode should profit on uptrend, lose on downtrend');
  });

  describe('Market hours', () => {
    it('should skip candles outside 04:00-20:00 ET when marketHoursEnabled for stocks');
    it('should process all candles when marketHoursEnabled is false (crypto)');
    it('should process pre-market (04:00-09:30) and post-market (16:00-20:00) candles with LIMIT-only fills');
  });

  describe('Edge cases', () => {
    it('should handle a single candle gracefully');
    it('should handle identical open/high/low/close (flat candle)');
    it('should handle zero-volume candle');
    it('should handle candle timestamps out of order');
  });
});
```

### 3. HistoricalDataService Tests (~15 tests)

```typescript
describe('HistoricalDataService', () => {
  it('should return candles from Blob Storage when catalog has data');
  it('should fetch from exchange API when catalog has no data');
  it('should normalize exchange-specific candle formats to standard OHLCV');
  it('should cache fetched data to Blob Storage in background');
  it('should update catalog metadata after caching');
  it('should handle partial date range (some cached, some not)');
  it('should return empty array for date range with no data');
  it('should report availability accurately from catalog');
  it('should handle Alpaca stock bars format');
  it('should handle Coinbase candles format (reversed order)');
  it('should paginate through exchange APIs for large date ranges');
  it('should respect exchange rate limits during fetch');
  it('should return error when exchange API is unavailable');
  it('should validate date range (startDate < endDate)');
  it('should reject unsupported timeframes for specific exchanges');
});
```

### 4. Backtest API Endpoint Tests (~15 tests)

```typescript
describe('Backtest API', () => {
  describe('POST /api/v1/backtests', () => {
    it('should accept valid backtest config and return 202 with backtestId');
    it('should reject invalid strategy config (Zod validation)');
    it('should reject request when user exceeds concurrent backtest limit');
    it('should reject request when daily limit exceeded');
    it('should reject date range exceeding max candle count');
    it('should require authentication');
  });

  describe('GET /api/v1/backtests/:id', () => {
    it('should return full result for completed backtest');
    it('should return status for pending/running backtest');
    it('should return 404 for non-existent backtest');
    it('should not return another user\'s backtest');
  });

  describe('GET /api/v1/backtests', () => {
    it('should return paginated list of user\'s backtests');
    it('should filter by strategyType');
    it('should sort by createdAt descending');
  });

  describe('DELETE /api/v1/backtests/:id', () => {
    it('should delete backtest and clean up blob storage');
    it('should cancel running backtest before deleting');
  });
});
```

### Total Test Count

| Component | Tests |
|-----------|:---:|
| SimulatedExchangeConnector | ~35 |
| BacktestEngine | ~30 |
| HistoricalDataService | ~15 |
| Backtest API endpoints | ~15 |
| **Total** | **~95** |

### Deterministic Test Data

All backtest tests use the same builder pattern and price sequence generators defined in `09-tdd-strategy.md`:

```typescript
// Known price sequence for Grid strategy validation
const GRID_TEST_CANDLES = generateOscillatingCandles({
  center: 100,
  amplitude: 10,     // oscillates between 90 and 110
  period: 20,
  totalCandles: 200,
  timeframe: '1h',
  startTimestamp: BASE_TIMESTAMP,
});

// Known outcome: Grid with lowPrice=90, highPrice=110, gridStep=2, 10 levels
// In 200 candles of oscillation, expect ~20 buy fills and ~20 sell fills
// Each round trip profits gridStep% minus fees
// Expected total return: ~20 * (2% * $1000/level - 2*$1.50 fee) = ~$340

function generateOscillatingCandles(config: OscillatingConfig): OHLCV[] {
  const candles: OHLCV[] = [];
  for (let i = 0; i < config.totalCandles; i++) {
    const t = (i / config.period) * 2 * Math.PI;
    const price = config.center + config.amplitude * Math.sin(t);
    candles.push({
      timestamp: config.startTimestamp + i * timeframeToMs(config.timeframe),
      open: price - 0.5,
      high: price + 2,
      low: price - 2,
      close: price + 0.5,
      volume: 10_000,
    });
  }
  return candles;
}
```

---

## I) Implementation Plan Integration

Backtesting fits into the existing epic structure as a new feature within Epic 9 (post-MVP hardening) or as a standalone Epic 10. The following tasks use the same TDD format as all other tasks.

### EPIC 10: Backtesting (M8, Weeks 36-42)

| Task | Description | Dependencies | TDD Acceptance |
|------|-------------|-------------|----------------|
| 10.1.1 | `SimulatedExchangeConnector` [TDD: ~35 tests] | 3.1.1 (MockExchangeConnector) | Fill logic, slippage, fees, balance, partial fills |
| 10.1.2 | `BacktestEngine` core loop [TDD: ~30 tests] | 10.1.1, 4.1.1 (StrategyFactory) | Candle replay, metrics, known-outcome validation |
| 10.2.1 | `HistoricalDataService` [TDD: ~15 tests] | 3.2.x (exchange connectors for API format), Blob Storage | Fetch, normalize, cache, catalog |
| 10.2.2 | Background data ingestion Function | 10.2.1 | Nightly backfill of top 20 pairs |
| 10.3.1 | Cosmos DB container + Blob Storage layout | 6.1.1 (data-access) | BacktestDocument schema, blob lifecycle |
| 10.3.2 | Backtest API endpoints [TDD: ~15 tests] | 10.1.2, 10.3.1, 7.1.1 (API patterns) | Submit, status, results, list, delete, compare |
| 10.4.1 | Backtest configuration form (React) | 8.2.2 (bot wizard forms) | Reuses strategy config forms + backtest wrapper |
| 10.4.2 | Results dashboard (React) | 10.3.2 | Equity chart, drawdown, trades table, metrics cards |
| 10.4.3 | Compare backtests view (React) | 10.4.2 | Side-by-side table, overlaid equity curves |
| 10.5.1 | Integration test: full Grid backtest E2E | All 10.x | Submit via API, verify result metrics within tolerance |
| 10.5.2 | Integration test: all 8 strategies smoke test | All 10.x | Each strategy runs a 100-candle backtest without error |

**Estimated effort**: 4-5 weeks with 1-2 developers.

**Dependencies**: The backtesting system requires all 8 strategies (Epic 4, completing ~Week 38) and at least one exchange connector (Epic 3) to be complete, since it reuses `IStrategy` implementations and exchange API formats for historical data normalization. Scheduled Weeks 36-42 to overlap with final strategy completion.

---

## J) Cost Considerations

| Resource | Usage Pattern | Estimated Monthly Cost |
|----------|--------------|----------------------|
| Cosmos DB (Backtests container) | Shared throughput, 400 RU/s, TTL 90 days | Included in existing shared pool |
| Blob Storage (historical data) | ~50 GB hot tier (2 years of popular pairs) | ~$1.15/mo |
| Blob Storage (backtest results) | ~10 GB per 1K users, hot → cool tier after 30 days | ~$0.50/mo |
| Compute (backtest workers) | Runs on existing bot-engine Container Apps; bursty | Minimal incremental (Container Apps scales to zero) |
| Exchange API calls (data fetch) | ~100-500 API calls per new pair backfill | Free (within existing rate limits) |
| **Total incremental** | | **~$2-5/mo** |

The backtesting system is extremely cost-efficient because it reuses existing compute (Container Apps), existing storage (Cosmos DB, Blob Storage already provisioned in the architecture), and existing strategy code. The only net-new cost is Blob Storage for historical candle data and backtest result artifacts, which is trivial.

---

## K) Future Enhancements (Not in MVP)

| Enhancement | Description | Complexity |
|-------------|-------------|:---:|
| **Walk-forward optimization** | Auto-optimize strategy parameters across rolling windows | High |
| **Monte Carlo simulation** | Randomize trade ordering to estimate result distribution | Medium |
| **Multi-asset portfolio backtest** | Backtest multiple strategies across correlated assets simultaneously | High |
| **Real-time paper trading mode** | Live strategy execution with simulated fills (paper trading on real market data) | Medium |
| **Parameter heatmap** | Grid search over 2 strategy parameters, visualize return surface | Medium |
| **Custom benchmark** | Compare against any index or asset, not just buy-and-hold | Low |
| **WebSocket progress** | Stream backtest progress and partial equity curves via Web PubSub | Low |
| **GPU-accelerated backtests** | For ultra-high-frequency (1s) candles on long date ranges | High |

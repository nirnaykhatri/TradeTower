# Trading Bot Strategy Specifications

This document provides detailed specifications for all 8 bot strategies supported by the platform.

---

## 1. **Grid Trading Bot**

### Overview
Places buy and sell orders at predefined intervals within a price range to profit from market volatility.

### Configuration Fields

| Field | Type | Required | Description | Validation |
|-------|------|----------|-------------|------------|
| `exchange` | String | Yes | Selected exchange/broker | Must be connected |
| `pair` | String | Yes | Trading pair (e.g., BTC/USDT) | Valid pair on exchange |
| `investment` | Decimal | Yes | Total investment amount | > 0, <= available balance |
| `investmentPercentage` | Integer | No | % of available balance | 0-100 |
| `lowPrice` | Decimal | Yes | Lower price boundary | > 0, < highPrice |
| `highPrice` | Decimal | Yes | Upper price boundary | > lowPrice |
| `highPriceTrailing` | Boolean | No | Enable trailing for high price | Default: false |
| `gridStep` | Decimal | Yes | Step between grid levels (%) | 0.1-100 |
| `gridLevels` | Integer | Yes | Number of grid levels | 5-100 |
| `orderSizeCurrency` | Enum | Yes | Currency for order size | `BASE` or `QUOTE` |
| `trailingUp` | Boolean | No | Trailing up enabled | Default: true |
| `pumpProtection` | Boolean | No | Pump protection enabled | Default: true |
| `trailingDown` | Boolean | No | Trailing down enabled | Default: false |
| `stopLoss` | Decimal | No | Stop loss percentage | 0-100 |
| `stopLossEnabled` | Boolean | No | Enable stop loss | Default: false |
| `takeProfit` | Decimal | No | Take profit percentage | 0-1000 |
| `takeProfitEnabled` | Boolean | No | Enable take profit | Default: false |

### Quick Setup Presets
- **Short-term**: Tight grid (0.5% step), 20-30 levels
- **Mid-term**: Medium grid (1% step), 15-25 levels
- **Long-term**: Wide grid (2-3% step), 10-20 levels

### Execution Logic
1. Calculate grid levels between low and high price
2. Distribute investment across levels
3. Place initial buy orders at lower levels
4. When buy order fills → place sell order at next level up
5. When sell order fills → place buy order at next level down
6. Monitor trailing conditions and adjust dynamically

---

## 2. **DCA (Dollar Cost Averaging) Bot**

### Overview
Automatically buys assets at regular intervals or when price drops, then sells when target profit is reached.

### Configuration Fields

| Field | Type | Required | Description | Validation |
|-------|------|----------|-------------|------------|
| `exchange` | String | Yes | Selected exchange/broker | Must be connected |
| `pair` | String | Yes | Trading pair | Valid pair on exchange |
| `strategy` | Enum | Yes | `LONG` or `SHORT` | - |
| `investment` | Decimal | Yes | Total investment | > 0 |
| `baseOrderAmount` | Decimal | Yes | Initial order size (USDT/BTC) | > min order size |
| `baseOrderCondition` | Enum | Yes | When to place base order | `IMMEDIATELY`, `PRICE_CHANGE`, `MANUAL` |
| `baseOrderType` | Enum | Yes | Order type | `LIMIT`, `MARKET` |
| `averagingOrdersAmount` | Decimal | Yes | Size of averaging orders | > min order size |
| `averagingOrdersQuantity` | Integer | Yes | Number of averaging orders | 0-100 |
| `averagingOrdersStep` | Decimal | Yes | Price step between orders (%) | 0.1-50 |
| `activeOrdersLimit` | Integer | No | Max concurrent orders | 1-100 |
| `activeOrdersLimitEnabled` | Boolean | No | Enable active orders limit | Default: false |
| `amountMultiplier` | Decimal | No | Multiplier for order amount | 1.0-2.0 (off if 1.0) |
| `stepMultiplier` | Decimal | No | Multiplier for price step | 1.0-2.0 (off if 1.0) |
| `takeProfitPercent` | Decimal | No | Target profit % | 0.1-1000 |
| `stopLossPercent` | Decimal | No | Stop loss % | 0-100 |

### Quick Setup Presets
- **Short-term**: Tight steps (0.5%), 3-5 orders
- **Mid-term**: Medium steps (1%), 5-10 orders
- **Long-term**: Wide steps (2-3%), 10-20 orders

### Execution Logic
1. Place base order immediately or wait for trigger condition
2. Monitor price movement
3. When price drops by `averagingOrdersStep` → place averaging order
4. Track average entry price across all filled orders
5. When price reaches `takeProfitPercent` above avg → sell all
6. If `stopLoss` triggered → close position

---

## 3. **BTD (Buy The Dip) Bot**

### Overview
Combines Grid and DCA approaches. Buys during dips and sells at higher prices within a defined range.

### Configuration Fields

| Field | Type | Required | Description | Validation |
|-------|------|----------|-------------|------------|
| `exchange` | String | Yes | Selected exchange/broker | Must be connected |
| `pair` | String | Yes | Trading pair | Valid pair on exchange |
| `investment` | Decimal | Yes | Total investment (BTC or USDT) | > 0 |
| `lowPrice` | Decimal | Yes | Lower price boundary | > 0, < highPrice |
| `lowPriceTrailing` | Boolean | No | Enable trailing for low price | Default: true |
| `highPrice` | Decimal | Yes | Upper price boundary | > lowPrice |
| `gridStep` | Decimal | Yes | Step between levels (%) | 0.1-100 |
| `gridLevels` | Integer | Yes | Total grid levels | 5-100 |
| `levelsDown` | Integer | Yes | Levels below current price | 1-gridLevels |
| `levelsUp` | Integer | Yes | Levels above current price | 1-gridLevels |
| `levelsDistribution` | Integer | Yes | % of levels below price | 0-100 |
| `trailing` | Boolean | No | Enable trailing | Default: true |
| `stopLoss` | Decimal | No | Stop loss % | 0-100 |
| `stopLossEnabled` | Boolean | No | Enable stop loss | Default: false |
| `takeProfit` | Decimal | No | Take profit % | 0-1000 |
| `takeProfitEnabled` | Boolean | No | Enable take profit | Default: false |

### Execution Logic
1. Calculate asymmetric grid (more levels below current price for buying dips)
2. Place buy orders at lower levels
3. When dip is bought → place sell order at corresponding upper level
4. Continuously adjust grid with trailing if enabled
5. Monitor TP/SL conditions

---

## 4. **Combo Bot**

### Overview
Combination strategy that merges Grid and DCA logic with advanced position management.

### Configuration Fields
_Similar to BTD but with additional position management rules_

| Field | Type | Required | Description | Validation |
|-------|------|----------|-------------|------------|
| _(All BTD fields)_ | - | - | - | - |
| `positionSizeLimit` | Decimal | No | Max position size | > 0 |
| `reuseCompletedOrders` | Boolean | No | Recycle filled orders | Default: true |
| `dynamicRebalancing` | Boolean | No | Auto-adjust grid | Default: false |

### Execution Logic
Combines Grid + DCA + dynamic position management for complex strategies.

---

## 5. **Loop Bot**

### Overview
Continuously loops between buy and sell within a price range. Ideal for ranging markets.

### Configuration Fields

| Field | Type | Required | Description | Validation |
|-------|------|----------|-------------|------------|
| `exchange` | String | Yes | Selected exchange/broker | Must be connected |
| `pair` | String | Yes | Trading pair | Valid pair on exchange |
| `investment` | Decimal | Yes | Total investment | > 0 |
| `lowPrice` | Decimal | Yes | Lower price boundary | > 0, < highPrice |
| `highPrice` | Decimal | Yes | Upper price boundary | > lowPrice |
| `orderDistance` | Decimal | Yes | Distance between orders (%) | 0.1-50 |
| `orderCount` | Integer | Yes | Number of loop orders | 1-100 |
| `takeProfit` | Decimal | No | Per-order profit target (%) | 0.1-100 |
| `takeProfitEnabled` | Boolean | No | Enable TP per order | Default: false |

### Execution Logic
1. Divide investment across `orderCount` orders
2. Place buy orders evenly spaced by `orderDistance`
3. When buy fills → immediately place sell at +`takeProfit` %
4. When sell fills → place new buy order
5. Loop indefinitely until manual stop

---

## 6. **DCA Futures Bot** ⭐ NEW

### Overview
DCA strategy specifically for futures/derivatives markets with leverage support.

### Configuration Fields

| Field | Type | Required | Description | Validation |
|-------|------|----------|-------------|------------|
| `exchange` | String | Yes | Futures exchange (e.g., Coinbase Futures) | Must support futures |
| `pair` | String | Yes | Futures pair (e.g., BTCUSDC) | Valid futures pair |
| `strategy` | Enum | Yes | `LONG` or `SHORT` | - |
| `initialMargin` | Decimal | Yes | Initial margin (USDC) | > min margin |
| `leverage` | Decimal | Yes | Leverage multiplier | 1.0-125.0 (exchange dependent) |
| `marginType` | Enum | Yes | `CROSS` or `ISOLATED` | - |
| `baseOrderAmount` | Decimal | Yes | First position size | > 0 |
| `averagingOrdersAmount` | Decimal | Yes | Averaging order size | > 0 |
| `averagingOrdersQuantity` | Integer | Yes | Number of averaging orders | 0-50 |
| `averagingOrdersStep` | Decimal | Yes | Price step % | 0.1-50 |
| `takeProfitPercent` | Decimal | No | Target profit % | 0.1-1000 |
| `stopLossPercent` | Decimal | No | Stop loss % | 0-100 |
| `liquidationBuffer` | Decimal | No | Safety buffer from liquidation (%) | 5-50 |

### Execution Logic
1. Open leveraged position (long/short) with initial margin
2. Monitor unrealized PnL
3. If price moves against position by `averagingOrdersStep` → add to position (DCA)
4. Track average entry price with leverage
5. Close position when TP reached
6. Monitor liquidation price and enforce buffer
7. Auto-close if SL triggered

### Risk Warnings
- **High Risk**: Futures trading with leverage can result in liquidation
- Monitor margin ratio continuously
- Enforce strict risk management with `liquidationBuffer`

---

## 7. **Futures Grid Bot** ⭐ NEW

### Overview
Combines grid trading efficiency with futures leverage. Places buy and sell orders within a price range using futures contracts to profit from volatility in either direction (Long/Short/Neutral).

### Configuration Fields

| Field | Type | Required | Description | Validation |
|-------|------|----------|-------------|------------|
| `exchange` | String | Yes | Selected futures exchange | Must support futures grid |
| `pair` | String | Yes | Futures trading pair | Valid futures pair |
| `strategyType` | Enum | Yes | `LONG`, `SHORT`, or `NEUTRAL` | - |
| `marginType` | Enum | Yes | `ISOLATED` or `CROSS` | - |
| `leverage` | Decimal | Yes | Leverage multiplier | 1x - 100x |
| `investment` | Decimal | Yes | Total margin allocated | > 0 |
| `lowPrice` | Decimal | Yes | Lower price boundary | > 0, < highPrice |
| `highPrice` | Decimal | Yes | Upper price boundary | > lowPrice |
| `gridQuantity` | Integer | Yes | Number of grid levels | 2 - 200 |
| `gridMode` | Enum | Yes | `ARITHMETIC` or `GEOMETRIC` | - |
| `triggerPrice` | Decimal | No | Price to activate the bot | > 0 |
| `stopLoss` | Decimal | No | Price to trigger stop loss | - |
| `takeProfit` | Decimal | No | Price to trigger take profit | - |
| `closePositionOnStop` | Boolean | No | Close all positions on bot stop | Default: true |

### Execution Logic
1. **Initialize**: Calculate grid levels based on `gridMode` (fixed price diff for Arithmetic, fixed % diff for Geometric).
2. **Strategy Direction**:
   - **Long**: Profit as price rises within range. Buys low, sells high.
   - **Short**: Profit as price falls within range. Sells high, buys low.
   - **Neutral**: Profit from volatility. Starts with no initial position; buys when price hits lower levels and sells when price hits higher levels.
3. **Execution**: Place limit orders at calculated grid levels with selected leverage.
4. **Active Trading**: When a buy/sell order is filled, immediately place the corresponding sell/buy order at the adjacent grid level.
5. **Safety**: Monitor for `triggerPrice` to start and `stopLoss`/`takeProfit` to terminate.
6. **Liquidation Check**: Continuously monitor margin ratio to prevent liquidation.

---

## 8. **TWAP (Time-Weighted Average Price) Bot** ⭐ NEW

### Overview
Executes large orders by breaking them into smaller sub-orders (slices) and placing them at regular time intervals over a specified duration to minimize market impact and slippage.

### Configuration Fields

| Field | Type | Required | Description | Validation |
|-------|------|----------|-------------|------------|
| `exchange` | String | Yes | Selected exchange | Must support TWAP |
| `pair` | String | Yes | Trading pair | Valid pair on exchange |
| `direction` | Enum | Yes | `BUY` (Long) or `SELL` (Short) | - |
| `totalAmount` | Decimal | Yes | Total quantity to trade | > 0 |
| `duration` | Integer | Yes | Total execution time (minutes) | 5 - 1440 (24h) |
| `frequency` | Integer | Yes | Interval between sub-orders (seconds) | 5 - 60 |
| `marginType` | Enum | Yes | `ISOLATED` or `CROSS` | - |
| `leverage` | Decimal | Yes | Leverage multiplier | 1x - 100x |
| `reduceOnly` | Boolean | No | Only reduce or close positions | Default: false |
| `priceLimit` | Decimal | No | Max/min price for execution | > 0 |

### Execution Logic
1. **Calculate Slices**: The total amount is divided by the number of intervals (Duration / Frequency) to determine the size of each sub-order.
2. **Timing**: The bot sets a timer based on the `frequency`.
3. **Execution**: At each interval, the bot places a **Market Order** (IOC) for the slice amount.
4. **Monitoring**:
   - If a `priceLimit` is set, the bot pauses execution if the market price moves beyond the limit.
   - The bot continues until the `totalAmount` is fully executed or the `duration` expires.
5. **Completion**: Upon reaching the total amount or time, the bot stops and provides a report on the average execution price.

---

## Common Features Across All Strategies

### Bot Start Conditions (Signal Sources)
All bots support multi-source start conditions. Users can combine technical indicators and external signals:
- **Indicators**: MACD, RSI, Stochastic
- **Timeframes**: 1m, 5m, 15m, 30m, 1h, 4h, 1d
- **External**: TradingView Webhooks, Manual intervention

Bots will only execute the `baseOrder` when all active start conditions are met (logical AND) or as per user preference (logical OR - configurable).

### Backtesting
- Historical data simulation (30d, 90d, 180d)
- Performance metrics (PnL, win rate, max drawdown)
- Optimization suggestions

### Risk Management
- Stop Loss (position-level)
- Take Profit (position-level)
- Max position size limits
- Daily loss limits

### Real-Time Monitoring
- Live PnL updates
- Order fills notification
- Performance charts
- Alert triggers

---

## Database Schema Implications

Each bot configuration is stored in Cosmos DB `Bots` container with:

```typescript
interface BotConfig {
  id: string;
  userId: string; // Partition key
  strategyType: 'GRID' | 'DCA' | 'BTD' | 'COMBO' | 'LOOP' | 'DCA_FUTURES' | 'FUTURES_GRID' | 'TWAP';
  status: 'stopped' | 'running' | 'paused' | 'completed' | 'error';
  config: GridConfig | DCAConfig | BTDConfig | ComboConfig | LoopConfig | DCAFuturesConfig | FuturesGridConfig | TWAPConfig;
  createdAt: Date;
  updatedAt: Date;
  
  // Performance tracking
  totalPnL: number;
  totalTrades: number;
  winRate: number;
  lastExecutionAt?: Date;
}
```

Each strategy has a typed config object matching the field specifications above.

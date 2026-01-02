# Trading Bot Strategy Specifications

This document provides detailed specifications for all 8 bot strategies supported by the platform.

---

## 1. **Grid Trading Bot**

### Overview

The Grid Trading Bot is a powerful automation tool designed to execute trading strategies within a specified price range by placing buy and sell orders at predefined intervals. This strategy divides the price range into multiple levels, creating a "grid" that systematically captures profits from market volatility.

**Core Principle**: For every completed buy order, the bot places a sell order above the executed price, and vice versa. This dynamic order replacement ensures continuous market activity without manual intervention.

### How It Works

#### Order Placement & Execution
- **Dynamic Order Replacement**: Buy orders are automatically replaced with sell orders at a higher level, and vice versa
- **Automated Management**: All trades are managed seamlessly, allowing you to focus on strategy rather than execution
- **Continuous Activity**: The grid remains active as long as the bot is running, with orders constantly being filled and replaced

#### Profit Generation
The Grid Trading Bot thrives on market volatility:
- **Upward Movements**: The bot sells at higher prices when the market rises
- **Downward Movements**: The bot buys at lower prices when the market falls
- **Small, Recurring Profits**: Profit is generated through multiple small transactions rather than large directional moves

### Configuration Fields

| Field | Type | Required | Description | Validation |
|-------|------|----------|-------------|------------|
| `exchange` | String | Yes | Selected exchange/broker | Must be connected |
| `pair` | String | Yes | Trading pair (e.g., BTC/USDT) | Valid pair on exchange |
| `investment` | Decimal | Yes | Total investment amount | > 0, <= available balance |
| `investmentPercentage` | Integer | No | % of available balance to deploy | 0-100 |
| `lowPrice` | Decimal | Yes | Lower price boundary of grid | > 0, < highPrice |
| `highPrice` | Decimal | Yes | Upper price boundary of grid | > lowPrice |
| `gridStep` | Decimal | Yes | Price distance between levels (%) | 0.1-100 |
| `gridLevels` | Integer | Yes | Number of grid levels | 5-100 |
| `orderSizeCurrency` | Enum | Yes | Base currency for order sizing | `BASE` or `QUOTE` |
| `trailingUp` | Boolean | No | Trailing up feature enabled | Default: true |
| `trailingDown` | Boolean | No | Trailing down feature enabled | Default: false |
| `stopTrailingDownPrice` | Decimal | No | Stop price for trailing down | > lowPrice |
| `pumpProtection` | Boolean | No | Pump protection enabled | Default: true |
| `stopLoss` | Decimal | No | Stop loss percentage | 0-100 |
| `stopLossEnabled` | Boolean | No | Enable stop loss | Default: false |
| `takeProfit` | Decimal | No | Take profit percentage | 0-1000 |
| `takeProfitEnabled` | Boolean | No | Enable take profit | Default: false |

#### Price Range Setup
- Set `lowPrice` and `highPrice` to define your trading boundaries
- By default, buy orders are placed below the current price and sell orders above
- Adjust these dynamically to align with market conditions and your strategy

#### Order Size Selection

**Quote Currency (Default)**
- Distributes total investment equally across all grid levels
- As price falls, the bot can buy more base currency; as it rises, it buys less
- Ideal for sideways/ranging markets

**Base Currency**
- Maintains fixed quantity of base currency per trade
- Requires larger initial investment but offers higher profit potential during uptrends
- Ideal when anticipating strong uptrend movements

#### Grid Step & Grid Levels (Interconnected Parameters)
These parameters work together to define your grid structure:

- **Grid Step**: Controls the percentage distance between each level
  - Increase step → fewer levels, larger trades
  - Decrease step → more levels, smaller trades

- **Grid Levels**: Total number of orders in the grid
  - Higher levels = more frequent trades, smaller per-order amount
  - Lower levels = fewer trades, larger per-order amount

**Market-Dependent Selection**:
- **High Volatility**: Use wider grid (larger step), fewer levels
- **Flat/Ranging Market**: Use tighter grid (smaller step), more levels

### Key Features & Advanced Settings

#### Trailing Up
Automatically moves the grid upward when price exceeds the highest grid level:
- **Mechanism**: Cancels lowest buy orders and shifts the entire grid upward
- **Benefit**: Allows the bot to follow uptrends and continue profiting
- **Note**: If using base currency ordering, additional quote funds may be needed

#### Trailing Down
Extends the grid downward during price declines:
- **Mechanism**: Places market buy orders and new sell orders below the lower grid boundary
- **Effect**: Extends rather than moves the grid, increasing base currency holdings
- **Benefit**: Allows continued trading during downtrends
- **Caution**: Uses additional funds from available balance beyond initial investment
- **Stop Condition**: Respects `stopTrailingDownPrice` limit

#### Pump Protection
Prevents buying during sudden price spikes:
- **Activated with**: Trailing Up or Trailing Down features
- **Behavior**: Pauses new orders and enters "Pump" status when market surge is detected
- **Duration**: Automatically resumes once market stabilizes
- **Risk Management**: Protects initial investment from volatile upward movements

#### Take Profit & Stop Loss
Predefined exit conditions for position management:

**Take Profit (TP)**
- Bot closes all positions when this profit percentage is reached
- Locks in gains and moves bot to history

**Stop Loss (SL)**
- Bot closes all positions when loss reaches this percentage
- Limits downside exposure and risk

**Dynamic Stop Loss**
- When Trailing Up is enabled, stop loss follows the lowest price in the grid
- Provides adaptive risk management during uptrends

### Quick Setup Presets

| Preset | Duration | Grid Step | Grid Levels | Best For |
|--------|----------|-----------|-------------|----------|
| **Short-term** | Up to 3 days | 0.5% | 20-30 | High frequency trading, active monitoring |
| **Mid-term** | 7 days | 1.0% | 15-25 | Balanced approach, moderate activity |
| **Long-term** | 25+ days | 2-3% | 10-20 | Long-term positions, low-frequency trading |

### Execution Logic

#### Initialization Phase
1. Analyze current market price
2. Calculate grid levels between `lowPrice` and `highPrice` using `gridStep`
3. Distribute `investment` proportionally across grid levels
4. Determine order sizes based on `orderSizeCurrency` selection
5. Apply fee buffers for each level

#### Trading Phase
1. Place initial buy orders at lower grid levels
2. Place initial sell orders at upper grid levels
3. **Buy Order Fills**:
   - Record buy transaction with associated fees
   - Place corresponding sell order at next level up
   - Update average entry price and position metrics
4. **Sell Order Fills**:
   - Execute sell at higher price
   - Place corresponding buy order at next level down
   - Calculate realized profit and update statistics
5. **Monitor Conditions**:
   - Check if trailing conditions are triggered
   - Verify pump protection status
   - Monitor take profit and stop loss levels

#### Trailing & Adjustment Phase
- **Trailing Up**: If price > highest level, shift grid upward
- **Trailing Down**: If price < lowest level, extend grid downward
- **Pump Detection**: Pause orders if pump is detected
- **TP/SL Trigger**: Close all positions if conditions met

#### Order Management
- **Dynamic Replacement**: Every filled order automatically generates a new counter-order
- **Continuous Activity**: Grid remains active indefinitely until stopped or TP/SL triggered
- **Fund Availability**: Verify sufficient balance before placing new orders

### Bot Management Operations

#### Adding Funds (Increase Investment)
Enhance your bot's investment without restarting:
- **Process**: 
  1. Select the running bot
  2. Specify additional amount or percentage
  3. Bot cancels current orders, recalculates sizing, and replaces orders
  4. Statistics are preserved; only investment amount increases
- **Metrics Impact**: Percent-based metrics (profit %, daily average) recalculate using new investment
- **Grid Settings**: Step and levels remain unchanged; average order size increases

#### Modifying Grid Levels
Adapt grid structure to changing market conditions:
- **Adjustable Parameters**: High price, low price, grid step, grid levels
- **Active Bot**: Changes apply to future orders immediately
- **Fund Requirements**: Verify balance before adding new levels
- **Order Recreation**: Existing orders remain; new orders placed at updated levels

#### Stopping the Bot
Close your bot and manage remaining positions:
- **Closure Strategies**:
  - **CLOSE_POSITIONS**: Market order to close all; locks in current PnL
  - **CANCEL_ORDERS**: Cancel pending orders only; preserve position
  - **LIQUIDATE**: Force close immediately; emergency option
  - **Default**: Stop without action; manual handling required

### Risk Management & Considerations

#### Market-Driven Risks
- **Price Spikes/Drops**: Sudden movements outside grid range can impact results
- **Trend Reversals**: Strategy is less effective during strong sustained trends
- **Slippage**: Market orders during trailing down may execute at unfavorable prices

#### Mitigation Strategies
1. **Stop Loss**: Protects investment by closing trades at predefined loss level
2. **Trailing Features**: Dynamically adjusts grid to follow price movements
3. **Pump Protection**: Prevents buying during abnormal price spikes
4. **Take Profit**: Locks in gains at predefined profit threshold
5. **Balance Management**: Monitor available funds for margin/extension orders

#### Best Practices
- **Liquidity First**: Choose pairs with high volume and tight spreads
- **Conservative Sizing**: Start with smaller investments to understand behavior
- **Regular Monitoring**: Review performance metrics and adjust parameters as needed
- **Market Analysis**: Combine with technical analysis to identify optimal trading ranges
- **Risk/Reward**: Ensure potential profit justifies invested capital and risks

### Performance Monitoring

#### Key Metrics
- **Bot Profit**: Overall and daily profit tracking
- **Unrealized PnL**: Current value of open positions
- **Win Rate**: Percentage of profitable trades
- **Trading Time**: Duration bot has been active
- **Transaction Count**: Total number of completed trades
- **Currency Allocation**: Ratio of base to quote currency holdings

#### Order History
- **Completed Trades**: View details (price, amount, fee, profit)
- **Open Orders**: Monitor active orders and their status
- **Order Timeline**: Track execution sequence and timing

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
Combines DCA-based entry strategy with Grid-based profit-taking strategy. The bot uses Martingale/Safety Orders to average down on entry while distributing exit orders across multiple price levels to take profit.

### Configuration Fields

| Field | Type | Required | Description | Validation |
|-------|------|----------|-------------|------------|
| `exchange` | String | Yes | Selected futures exchange | Must support futures |
| `pair` | String | Yes | Futures trading pair | Valid futures pair |
| `strategy` | Enum | Yes | `LONG` or `SHORT` | - |
| `initialMargin` | Decimal | Yes | Initial margin (USDC) | > 0 |
| `leverage` | Decimal | Yes | Leverage multiplier | 1.0-125.0 |
| `marginType` | Enum | Yes | `CROSS` or `ISOLATED` | - |
| `lowPrice` | Decimal | Yes | Lower price boundary | > 0, < highPrice |
| `highPrice` | Decimal | Yes | Upper price boundary | > lowPrice |
| `baseOrderAmount` | Decimal | Yes | First entry order size | > 0 |
| `baseOrderCondition` | Enum | No | When to place base order | `IMMEDIATELY`, `PRICE_CHANGE`, `MANUAL` |
| `baseOrderType` | Enum | No | Order type for entry | `LIMIT`, `MARKET` |
| `averagingOrdersAmount` | Decimal | Yes | Size of DCA/safety orders | > 0 |
| `averagingOrdersQuantity` | Integer | Yes | Number of DCA safety orders | 0-50 |
| `averagingOrdersStep` | Decimal | Yes | Price step for DCA orders (%) | 0.1-50 |
| `gridStep` | Decimal | Yes | % step between grid levels | 0.1-100 |
| `gridLevels` | Integer | Yes | Number of profit-taking grid levels | 5-100 |
| `activeOrdersLimit` | Integer | No | Max concurrent orders | 1-100 |
| `activeOrdersLimitEnabled` | Boolean | No | Enable active orders limit | Default: false |
| `takeProfitType` | Enum | No | TP target type | `PERCENT` or `PRICE` |
| `takeProfitPercent` | Decimal | No | Target profit % (if PERCENT type) | 0.1-1000 |
| `takeProfitPrice` | Decimal | No | Target profit price (if PRICE type) | > 0 |
| `stopLossType` | Enum | No | SL target type | `PERCENT` or `PRICE` |
| `stopLossPercent` | Decimal | No | Stop loss % (if PERCENT type) | 0-100 |
| `stopLossPrice` | Decimal | No | Stop loss price (if PRICE type) | > 0 |
| `trailingStopLoss` | Boolean | No | Enable trailing stop loss | Default: true |
| `trailingStopPercent` | Decimal | No | % amount to trail | 0.1-50 |
| `liquidationBuffer` | Decimal | No | Safety buffer from liquidation (%) | 5-50 |

### Bitsgap COMBO Bot Reference
Per Bitsgap documentation, COMBO Bot works as follows:
- **DCA Phase (Entry)**: Places base order + safety orders to average down. Uses `averagingOrdersStep` for spacing.
- **Grid Phase (Exit)**: Places profit-taking grid orders above entry (LONG) or below entry (SHORT).
- **Price Range**: `lowPrice` and `highPrice` define the trading range where bot operates.
- **Trailing Stop Loss**: Enabled by default. Automatically follows favorable price movement.
- **Position Closure**: When TP or SL is triggered, bot closes entire position with market order.

### Quick Setup Presets
- **Short-term**: Step 0.5%, DCA levels 3-5, Grid levels 15-20
- **Mid-term**: Step 0.9%, DCA levels 5-10, Grid levels 15-30
- **Long-term**: Step 2-3%, DCA levels 10-15, Grid levels 20-40

### Execution Logic
1. **Initialize**: Place base order at current/defined price
2. **DCA Phase**: Place safety orders below base (LONG) or above base (SHORT) by `averagingOrdersStep`
3. **Entry Management**: Track average entry price as orders fill; optionally limit concurrent orders
4. **Grid Phase**: Place profit-taking orders above/below average entry by `gridStep`
5. **Price Monitoring**: 
   - Track highest price (LONG) or lowest price (SHORT) for trailing stop loss
   - Check TP/SL conditions on each price update
6. **Exit**: On TP/SL trigger, cancel all orders and close position with market order
7. **Repeat**: Loop continues until manual stop or position closure

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

## Bot Lifecycle & Management

### Modify Your Bot (Per Bitsgap Specification)

**When**: Bot is running or stopped

**API Endpoint**: `PATCH /api/v1/bots/:id`

**Request Body**:
```json
{
  "name": "Updated Bot Name",
  "config": {
    "takeProfit": 5.5,
    "stopLoss": 2.0,
    "gridStep": 1.2,
    "lowPrice": 65000,
    "highPrice": 75000
  }
}
```

**Supported Modifications**:
- ✅ Adjust Take Profit % / price
- ✅ Adjust Stop Loss % / price
- ✅ Modify grid parameters (step, levels, price range)
- ✅ Change margin/leverage settings
- ✅ Update bot name and trigger conditions
- ✅ Enable/disable trailing stop loss

**Constraints**:
- For running bots: Changes apply to future orders
- For stopped bots: Changes apply when restarted
- Cannot modify exchange or pair (use new bot instead)

### Close Your Bot

**When**: User wants to stop trading and clean up

**API Endpoint**: `POST /api/v1/bots/:id/toggle`

**Request Body** (Optional Closure Strategy):
```json
{
  "action": "stop",
  "closureStrategy": "CLOSE_POSITIONS"
}
```

**Closure Strategy Options**:

| Strategy | Description | Order Execution | Position | Use Case |
|----------|-------------|-----------------|----------|----------|
| `CLOSE_POSITIONS` | Market order to close all, lock PnL | Market close order | Closed | Normal shutdown, lock profits |
| `CANCEL_ORDERS` | Cancel all pending orders only | Cancel all orders | Keep position | Preserve position, modify later |
| `LIQUIDATE` | Force close + withdraw (emergency) | Market close order | Closed | Emergency stop, risk mitigation |
| `undefined` | Stop without action (default) | None | Keep position | Just stop bot, manual handling |

**Execution Flow**:
1. API validates closure strategy (if provided)
2. Bot status changed to `stopped`
3. If closure strategy provided: Execute on exchange
4. Engine syncs state with stopped status

**Response**:
```json
{
  "status": "success",
  "message": "Bot stopped successfully with CLOSE_POSITIONS closure",
  "data": {
    "bot": {
      "id": "bot-123",
      "status": "stopped",
      "closureStrategy": "CLOSE_POSITIONS",
      "performance": { ... }
    }
  }
}
```

### Restart Your Bot

**When**: User wants to resume or modify existing bot

**Process**:
1. **Stop Bot**: `POST /api/v1/bots/:id/toggle` with `action: 'stop'` (optional closure)
2. **Modify Settings**: `PATCH /api/v1/bots/:id` with new configuration
3. **Start Bot**: `POST /api/v1/bots/:id/toggle` with `action: 'start'`

**Example - Modify & Restart COMBO Bot**:
```
STOP /api/v1/bots/combo-123/toggle
{ "action": "stop", "closureStrategy": "CANCEL_ORDERS" }

PATCH /api/v1/bots/combo-123
{
  "config": {
    "gridStep": 1.5,
    "takeProfit": 6.0,
    "trailingStopPercent": 2.5
  }
}

START /api/v1/bots/combo-123/toggle
{ "action": "start" }
```

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

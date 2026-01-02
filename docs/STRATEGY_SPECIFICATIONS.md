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

The DCA (Dollar-Cost Averaging) Bot automates your trading by dividing investments into smaller periodic trades placed at predefined price intervals. This strategy helps achieve better average entry prices, reducing the impact of market volatility and enabling disciplined, emotion-free trading.

**Core Benefits**:
- **Reduced Impact of Volatility**: Spreading purchases over time minimizes the effect of short-term price swings
- **Disciplined Entry Strategy**: Automated orders execute at defined price levels without emotional bias
- **Flexible Risk Management**: Combine with stop loss, take profit, and profit reinvestment features
- **Cycle Independence**: Each bot cycle is independent; profits from previous cycles can be reinvested

**Ideal Use Cases**:
- Long-term accumulation strategies with regular entry points
- Risk reduction through averaged cost basis
- Intraday or extended position building
- Markets with expected price movement within defined ranges

### When to Use DCA

Use the DCA Bot when:
- You want to accumulate assets gradually at favorable prices
- You prefer disciplined, systematic trading over emotional decisions
- You're targeting long-term positions with technical signal confirmation
- You want to manage position risk through averaging and controlled position sizing

### Configuration Fields

| Field | Type | Required | Description | Validation | Notes |
|-------|------|----------|-------------|------------|-------|
| `exchange` | String | Yes | Selected exchange/broker | Must be connected | Exchange must support spot trading |
| `pair` | String | Yes | Trading pair | Valid pair on exchange | e.g., BTC/USDT, ETH/USDC |
| `strategy` | Enum | Yes | `LONG` or `SHORT` | - | LONG: profit from price increases; SHORT: profit from price decreases |
| `investment` | Decimal | Yes | Total investment amount | > 0 | Total capital allocated to this bot |
| `baseOrderAmount` | Decimal | Yes | Initial order size | > min exchange order size | First order placed per base condition |
| `baseOrderCondition` | Enum | Yes | When to place base order | `IMMEDIATELY`, `PRICE_CHANGE`, `MANUAL`, or indicator-based | Controls bot entry timing |
| `baseOrderType` | Enum | Yes | Order type for base | `LIMIT` or `MARKET` | LIMIT: wait for price; MARKET: immediate fill |
| `averagingOrdersAmount` | Decimal | Yes | Total for averaging orders | > min exchange order size | Funds allocated to DCA orders |
| `averagingOrdersQuantity` | Integer | Yes | Number of averaging orders | 0-100 | How many orders in the averaging grid |
| `averagingOrdersStep` | Decimal | Yes | Price step between orders (%) | 0.1-50 | Distance between consecutive orders |
| `amountMultiplier` | Decimal | No | Order size scaling | 1.0-2.0 | Off if 1.0; each order larger than previous |
| `stepMultiplier` | Decimal | No | Step distance scaling | 1.0-2.0 | Off if 1.0; increases spacing between orders |
| `activeOrdersLimitEnabled` | Boolean | No | Limit concurrent orders | Default: false | Reserve balance only for active orders |
| `activeOrdersLimit` | Integer | No | Max concurrent orders | 1-100 (if enabled) | Inactive orders shown gray; funds stay available |
| `takeProfitPercent` | Decimal | No | Target profit threshold (%) | 0.1-1000 | Close all when profit reaches this % |
| `stopLossPercent` | Decimal | No | Loss limit (%) | 0-100 | Close all when loss reaches this % |
| `reinvestProfitEnabled` | Boolean | No | Reinvest cycle profits | Default: false | Roll profits into next cycle |
| `reinvestProfitPercent` | Decimal | No | % of profit to reinvest | 0-100 (if enabled) | 0=none, 100=full reinvestment |
| `maxPrice` | Decimal | No | Upper price threshold | > current price | For LONG: delay start until price drops below |
| `minPrice` | Decimal | No | Lower price threshold | < current price | For SHORT: delay start until price rises above |
| `reserveFundsEnabled` | Boolean | No | Lock funds for max price | Default: true (when max/min set) | Places far-market limit order to reserve investment |

### Core Features & Advanced Settings

#### ⚡ Base Order Placement

**Immediate Start**
- Bot places base order instantly upon confirmation
- Full investment and averaging grid become active immediately
- Best for: Markets with clear entry signals or urgent strategies

**Price-Change Trigger**
- Bot waits for market price to move by a defined percentage before placing base order
- Allows fine-tuning of entry point relative to current price
- Best for: Technical analysis strategies or waiting for specific price conditions

**Manual Trigger**
- Base order placed manually by user after confirmation
- Provides maximum control over exact entry timing
- Best for: Event-driven strategies or when precise entry timing is critical

**Indicator-Based Trigger**
- Bot uses technical indicators (MACD, RSI, Stochastic) across selected timeframes (1m, 5m, 15m, 30m, 1h, 4h, 1d)
- Supports multiple indicators with AND/OR logic
- Best for: Signal-driven systematic trading strategies

#### 📊 Averaging Orders (DCA Grid)

The averaging grid places additional orders at progressively lower prices (LONG) or higher prices (SHORT):

**Grid Structure**:
- **Quantity**: Number of orders in the averaging grid (0-100)
- **Step %**: Percentage distance between consecutive orders (0.1-50%)
- **Amount**: Total funds allocated to all averaging orders

**Example (LONG Strategy)**:
```
Investment: 1000 USDT
Base Order: 300 USDT at current price
Averaging Orders: 700 USDT across 7 orders, 2% step
  → Order 1: 100 USDT at -2%
  → Order 2: 100 USDT at -4%
  → Order 3: 100 USDT at -6%
  ... and so on
```

**Amount Multiplier** (Optional):
- Scales each successive order amount: multiplier > 1.0 increases order size with depth
- Example: base 100 USDT × 1.5 multiplier → 100, 150, 225, 337.5, ...
- Creates larger positions as price moves favorably (martingale-style)

**Step Multiplier** (Optional):
- Scales spacing between orders: multiplier > 1.0 increases gaps with depth
- Spreads orders wider apart at lower prices, denser at higher prices
- Adapts grid to changing volatility with depth

#### 🎯 Active Orders Limit (AOL)

**When Enabled**: Reserve funds only for the first N orders; remaining orders stay inactive (shown gray) until filled

**Key Benefits**:
- **Balance Conservation**: Funds for inactive orders remain available for other bots/trades
- **Flexibility**: As active orders fill, next inactive order automatically becomes active
- **Control**: Prevents over-commitment of capital to a single bot
- **Efficiency**: Matches capital deployment to actual market opportunity

**Example**:
```
Investment: 5000 USDT (30% base, 70% averaging)
Base Order: 1500 USDT
Averaging: 3500 USDT across 10 orders
Active Orders Limit: 5 orders

Reserved: 1500 + (5 orders' amounts) ≈ 2500 USDT
Available: 2500 USDT (for remaining 5 inactive orders)
```

**Interaction with Stop Loss**:
- When SL is active and crosses through inactive (gray) orders, those orders are automatically canceled
- Active (green) orders remain until SL is triggered globally

#### 🔄 Manual Position Averaging (Add Funds)

**Purpose**: Increase investment in an active DCA cycle without restarting the bot

**What Happens When You Add Funds**:

*In the Current Cycle*:
- **Unfilled & Partially Filled Orders**: Recalculated upward based on the new total investment
- **Filled Orders**: Remain unchanged (preserve original execution)
- **Allocation**: Added amount distributed per original ratio (e.g., 30% base / 70% averaging)
- **Multiplier Logic**: Respects original amount/step multipliers for new orders
- **Stop Loss**: Recalculated if active (average price changes due to larger orders)
- **Take Profit**: Unchanged (position unchanged; TP % still targets original ratio)
- **Active Orders Limit**: On-hold orders also recalculated if AOL enabled

*In the Next Cycles*:
- **Base Order**: New funds used in base order only for the next cycle
- **Averaging Orders**: Funds split per original allocation and applied to averaging grid

**Example Add Funds Behavior**:
```
Original Config: 1000 USDT (400 base, 600 averaging across 6 orders)
Current State: Base filled (1), 2 averaging orders filled, 3 pending

Add Funds: +500 USDT
New Total: 1500 USDT

Current Cycle:
  - Filled orders: Unchanged (base 400, 2× averaging)
  - Pending orders: Recalculated for new total (600 → 900 USDT across 3)
  - If SL active: Recalculated for new average entry price
  
Next Cycle:
  - Base Order: 600 USDT (40% of 1500)
  - Averaging: 900 USDT (60% of 1500)
```

**How to Add Funds**:
1. From bot Performance menu: Click "Add Funds" button, enter amount, confirm
2. From Active Bots list: Click + button next to bot, enter amount, confirm

**Requirements**:
- Minimum: Exchange's minimum order size or $20 (whichever is higher)
- Status: Bot must be running (not Closing, Adding Funds, or in API Error)
- Balance: Sufficient available balance minus funds reserved for current/next cycle

**Impact on Statistics**:
- **Total Investment**: Increases immediately
- **Total PnL (absolute)**: Unchanged
- **Total PnL (%)**: Decreases (same PnL divided by larger investment)

#### ⏸️ Insufficient Funds Handling

**Automatic Detection**: When active orders cannot be placed due to insufficient available balance

**Automatic Recovery**:
- Bot pauses the failing averaging order and enters pause state
- Monitors exchange balance continuously
- Within ~5 minutes of funds becoming available, bot auto-resumes
- No user intervention required; check notification for required amount

**To Resolve Manually**:
1. Check bot notification for exact required amount
2. Deposit to exchange account or free up balance from other bots
3. Await automatic detection and resumption (≤5 min)

#### 💰 Profit Reinvestment

**Purpose**: Automatically reinvest profits from completed cycles into subsequent cycles for compounding growth

**Feature Configuration**:
- **Enabled**: Boolean toggle
- **Percentage**: 0-100% of realized profit to reinvest
  - 0% = No reinvestment (default)
  - 50% = Half profits reinvested, half withdrawn
  - 100% = All profits added to next cycle investment

**Distribution Logic**:
Reinvested profit follows the original allocation ratio:
```
Original Allocation: 30% base, 70% averaging
Cycle 1 Profit: 300 USDT
Reinvest at 100%:
  → 90 USDT (30%) goes to base order
  → 210 USDT (70%) distributed across averaging orders
```

**Impact on Statistics**:
- **Realized Profit**: Reinvested amount deducted (clarity on actual withdrawn profit)
- **Bot Value**: Increases with reinvested profit in next cycle
- **Next Cycle Investment**: Original investment + reinvested profit

**Benefits**:
- Compound growth over multiple cycles
- Systematic profit deployment without manual intervention
- Scales bot activity proportionally to success

#### 🔒 Max Price & Reserve Funds (Delayed Entry Strategy)

**Use Case**: Delay bot activation until market reaches desired entry price

**How It Works for LONG Bots**:

*Setup Phase*:
1. Set `maxPrice` below current market price
2. `reserveFundsEnabled` toggles ON automatically (can be manually disabled)
3. Bot checks if current price is above `maxPrice`

*If Price > Max Price*:
- Bot **places a far-market limit order** (e.g., 50% below current price) to lock investment
- Status displays: "Funds Reserved"
- Reserved amount shown in Asset Allocation
- No funds used for other bots/trades

*When Price ≤ Max Price*:
- Reservation limit order automatically canceled
- Bot transitions to "Active" status
- Places base order and builds averaging grid
- Normal DCA trading begins

**Why Reserve Funds**:
- ✅ Ensures funds available when price target reached
- ✅ Prevents accidental overspending across multiple bots
- ✅ Guarantees bot activation at desired price (with sufficient balance)
- ✅ Locks investment while waiting for market conditions

**For SHORT Bots** (Reversed Logic):
- Place reservation limit sell order far above current price
- Waits for price to rise above `minPrice`
- Cancels reservation and starts trading when condition met

**Interaction with Other Features**:
- **Active Orders Limit**: Reserved amount calculated only for active orders (not on-hold)
- **Profit Reinvestment**: Reinvested profit included in reservation amount
- **Indicator Signals**: Max price takes priority; bot waits for price condition even if indicator signals

**Limitations**:
- Spot trading only (not supported on futures)
- If balance insufficient for reservation, bot enters "Insufficient Funds" status
- Manual cancellation of reservation order causes bot to re-create it automatically

#### 📈 Take Profit & Stop Loss

**Take Profit (TP)**:
- Bot closes all positions when profit reaches target percentage
- Calculated from weighted average entry price
- Locks in gains; bot status changes to completed/history

**Stop Loss (SL)**:
- Bot closes all positions when loss reaches threshold percentage
- Calculated from weighted average entry price  
- Limits downside exposure; automatic position closure
- If Active Orders Limit enabled, on-hold orders below SL are canceled (shown gray)

**Trailing Stop Loss** (Optional):
- Automatically adjusts SL price as market moves favorably
- If price reverses beyond trailing percentage, SL triggers
- Provides adaptive protection while allowing profit growth

### Quick Setup Presets

| Preset | Duration | Averaging Step | Averaging Orders | Base Order | Ideal For |
|--------|----------|-----------------|------------------|-----------|----------|
| **Aggressive Short-term** | 1-3 days | 0.5% | 3-5 | Immediate/Market | Active monitoring, high volatility capture |
| **Balanced Mid-term** | 5-10 days | 1.0% | 5-10 | Immediate/Limit | Balanced risk/reward, standard use case |
| **Conservative Long-term** | 20+ days | 2-3% | 10-20 | Price-change/Limit | Low frequency, long accumulation |
| **Deep Averaging** | Unlimited | 0.2-0.5% | 20-30 | Limit | Extreme averaging, high control |

### Execution Logic

#### Initialization Phase
1. Validate configuration (minimum order sizes, balance sufficiency, price validations)
2. Determine base order placement trigger (immediate/condition/manual/indicator)
3. If max price + reserve funds enabled: Place far-market reservation limit order
4. Set bot status: "Funds Reserved" (if awaiting max price) or ready for base order

#### Active Trading Phase
1. **Base Order Execution**:
   - Place base order per condition (IMMEDIATELY/PRICE_CHANGE/MANUAL/INDICATOR)
   - Record fill with fees; update average entry price
   
2. **Averaging Grid Execution**:
   - Monitor price movement continuously
   - Place averaging order when price drops by `averagingOrdersStep` (LONG) or rises (SHORT)
   - Apply amount/step multipliers if configured
   - Respect active orders limit if enabled
   
3. **Order Fill Processing**:
   - Record each fill with timestamp, price, amount, fees
   - Recalculate weighted average entry price
   - Update stop loss if SL active (new average price)
   - Check for take profit condition
   
4. **Cycle Completion**:
   - When TP triggered or SL triggered: Close all positions with market order
   - If reinvestment enabled: Accumulate profit for next cycle
   - Move to history; await manual restart or cycle restart if enabled

#### Monitoring & Control Phase
- **Continuous Checks**: Price updates trigger TP/SL evaluation every tick
- **Automatic Retry**: If insufficient funds detected, pause and retry within ~5 minutes
- **Manual Averaging**: User can add funds during cycle; recalculates unfilled orders
- **Dynamic Modification**: User can adjust TP/SL during active cycle

### Bot Management Operations

#### Adding Funds (Increase Investment) - In Detail

When adding funds to an active DCA bot:

**Calculation of Distribution**:
```
Original Allocation: baseOrderAmount / (baseOrderAmount + averagingOrdersAmount)
Example: 400 / (400 + 600) = 40% base, 60% averaging

Added Funds: 500 USDT
→ Base allocation: 500 × 0.40 = 200 USDT
→ Averaging allocation: 500 × 0.60 = 300 USDT
```

**Unfilled Order Recalculation**:
- Each unfilled order's amount scaled proportionally
- New average order size = (Original average) × (New total / Original total)

**Stop Loss Recalculation** (If Active):
- New weighted average price = (Sum of all filled amounts × price + new orders impact) / (total quantity)
- SL adjusted to maintain % below new average price

**Logging & Transparency**:
- Each add funds operation logged with distribution breakdown
- User sees: amount added, distribution %, new order sizes, new average price

#### Modifying Bot Settings

**Adjustable During Active Cycle**:
- ✅ Take Profit % or price
- ✅ Stop Loss % or price
- ✅ Base order condition (if base order not filled)
- ✅ Reinvestment settings (applies to next cycle)
- ✅ Max/Min price (applies after current cycle)

**Not Adjustable** (Requires Restart):
- ❌ Exchange or pair
- ❌ Strategy direction (LONG/SHORT)
- ❌ Active Orders Limit (must be set during creation)
- ❌ Averaging orders quantity/step (applies to next cycle)

#### Stopping the Bot

**Closure Strategies**:

| Strategy | Execution | Position | Use Case |
|----------|-----------|----------|----------|
| `CLOSE_POSITIONS` | Market order closes all | Fully closed | Standard shutdown, lock profits |
| `CANCEL_ORDERS` | Cancels all pending | Position preserved | Stop bot, keep position for manual handling |
| `LIQUIDATE` | Force close all + withdraw | Closed | Emergency stop, immediate risk reduction |
| `NONE` (default) | No action | Preserved | Stop bot only, leave position open |

### Performance Monitoring

#### Key Metrics

- **Total Profit (Absolute)**: Total realized PnL in quote currency
- **Total Profit (%)**: Realized profit as percentage of original investment
- **Unrealized PnL**: Current value of open positions vs. entry
- **Average Entry Price**: Weighted average of all filled orders
- **Position Size**: Current quantity in base currency
- **Trading Time**: Duration since bot started
- **Transaction Count**: Total number of filled orders
- **Win Rate**: % of profitable closed positions
- **Daily Average**: Average profit per day running
- **Currency Allocation**: Base and quote currency holdings

#### Order History

- **Completed Orders**: Filled orders with price, amount, fee, profit
- **Open Orders**: Active pending orders and their status
- **Order Timeline**: Chronological execution sequence
- **Reservation Orders**: Far-market limit orders (if max price feature active)

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

### Execution Overview

**DCA Phase (Entry)**:
- Places base order + safety orders to average down at predefined intervals
- Uses `averagingOrdersStep` for price level spacing
- Respects active orders limit if enabled

**Grid Phase (Exit)**:
- Places profit-taking grid orders above entry price (LONG) or below entry price (SHORT)
- Automatically distributed across `gridLevels` with `gridStep` spacing
- Each exit order takes partial profit at its level

**Price Range Management**:
- `lowPrice` and `highPrice` define the bot's trading boundaries
- Bot positions itself within these levels using DCA entry and grid exit
- Dynamic adjustments possible through configuration updates

**Trailing Stop Loss**:
- Enabled by default; automatically follows favorable price movement
- Locks in gains while allowing further profit potential
- Provides adaptive risk management during favorable trends

**Position Closure**:
- When TP reached: Market order closes entire position
- When SL triggered: Market order closes entire position
- Status changes to completed/history

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

### Modify Your Bot

**When**: Bot is running or stopped

**Supported Modifications**:
- ✅ Adjust Take Profit % or price target
- ✅ Adjust Stop Loss % or price target
- ✅ Modify grid parameters (step, levels, price range)
- ✅ Change margin/leverage settings
- ✅ Update bot name and trigger conditions
- ✅ Enable/disable trailing stop loss

**Timing of Changes**:
- For **running bots**: Changes apply to future orders immediately
- For **stopped bots**: Changes apply when bot is restarted
- For **completed bots**: Create new bot with updated parameters

**Constraints**:
- Cannot modify exchange or pair (create new bot instead)
- Cannot modify active orders limit after bot starts
- Cannot change strategy direction (LONG/SHORT) after bot starts

**API Endpoint**:
```
PATCH /api/v1/bots/:id
```

**Request Body Example**:
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

### Close Your Bot

**Closure Strategies**:

| Strategy | Execution | Position | Use Case |
|----------|-----------|----------|----------|
| `CLOSE_POSITIONS` | Market order closes all | Fully closed | Normal shutdown, lock profits |
| `CANCEL_ORDERS` | Cancels all pending | Position preserved | Stop bot, keep position for manual handling |
| `LIQUIDATE` | Force close all + withdraw | Closed | Emergency stop, immediate risk reduction |
| `NONE` (default) | No action | Preserved | Stop bot only, leave position open |

**API Endpoint**:
```
POST /api/v1/bots/:id/toggle
```

**Request Body**:
```json
{
  "action": "stop",
  "closureStrategy": "CLOSE_POSITIONS"
}
```

**Execution Flow**:
1. Bot status changes to "stopped"
2. If closure strategy provided: Execute on exchange
3. State synchronized; bot moves to history

**Response Example**:
```json
{
  "status": "success",
  "message": "Bot closed with CLOSE_POSITIONS strategy",
  "data": {
    "bot": {
      "id": "bot-123",
      "status": "stopped",
      "closureStrategy": "CLOSE_POSITIONS",
      "finalPnL": 250.50,
      "performance": { ... }
    }
  }
}
```

### Restart Your Bot

**Multi-Step Process**:

1. **Stop Bot** with optional closure strategy
   ```
   POST /api/v1/bots/:id/toggle
   { "action": "stop", "closureStrategy": "CANCEL_ORDERS" }
   ```

2. **Modify Settings** with new configuration
   ```
   PATCH /api/v1/bots/:id
   {
     "config": {
       "gridStep": 1.5,
       "takeProfit": 6.0,
       "stopLoss": 2.5
     }
   }
   ```

3. **Start Bot** to resume trading
   ```
   POST /api/v1/bots/:id/toggle
   { "action": "start" }
   ```

**Example Workflow - COMBO Bot Optimization**:
```
Step 1: Stop and preserve position
STOP POST /bots/combo-123/toggle
{ "action": "stop", "closureStrategy": "CANCEL_ORDERS" }

Step 2: Update grid and trailing settings
PATCH /bots/combo-123
{
  "config": {
    "gridStep": 1.5,
    "trailingStopPercent": 2.5,
    "takeProfit": 6.0
  }
}

Step 3: Restart with new parameters
START POST /bots/combo-123/toggle
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

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

## 3. **DCA Futures Bot**

### Overview

The DCA Futures Bot extends dollar-cost averaging to leveraged futures markets, enabling traders to build positions efficiently with **amplified capital deployment**. This strategy combines systematic position averaging with margin trading capabilities, allowing traders to leverage their investment while maintaining disciplined risk management through automated stop losses, take profits, and liquidation protection.

**Core Principle**: Execute systematic buy/sell orders at multiple price levels using configurable leverage (1x-10x) in isolated or cross margin mode. Each filled order triggers additional "safety orders" at progressively wider price intervals, reducing average entry cost while building a leveraged position.

**Ideal For**:
- Directional market views (bullish LONG or bearish SHORT)
- Accumulation with leverage amplification
- Risk-managed position building with predefined exit conditions
- Traders requiring flexible margin modes for different risk profiles

### Key Differences from Spot DCA

| Aspect | Spot DCA | DCA Futures |
|--------|----------|-------------|
| **Leverage** | 1x only (none) | 1x-10x configurable |
| **Margin Mode** | N/A | Isolated or Cross |
| **Direction** | Buy only | LONG or SHORT |
| **Liquidation** | N/A | Active monitoring + buffer protection |
| **Position Type** | Asset accumulation | Leveraged directional bet |
| **Risk Profile** | Lower | Higher (amplified by leverage) |
| **Profit Potential** | Linear with price | Amplified (leverage multiplier) |

### Configuration Fields

| Field | Type | Required | Description | Validation | Notes |
|-------|------|----------|-------------|------------|-------|
| `exchange` | String | Yes | Connected futures exchange | Valid exchange connector | Binance, OKX, Bybit, etc. |
| `pair` | String | Yes | Trading pair | Valid futures pair | BTC/USDT, ETH/USDT, etc. |
| `strategy` | Enum | Yes | Position direction | LONG \| SHORT | Determines buy/sell bias |
| `leverage` | Decimal | Yes | Position leverage | 1.0 - max exchange limit | 1=1x, 10=10x, etc. |
| `marginType` | Enum | Yes | Margin mode | ISOLATED \| CROSS | Account-level setting sync |
| `baseOrderAmount` | Decimal | Yes | Initial order size | > exchange minimum | Quote currency amount |
| `safetyOrderAmount` | Decimal | Yes | First safety order size | > 0, typically > baseOrderAmount | Amount multiplier applied per level |
| `safetyOrderStepMultiplier` | Decimal | Yes | Price step multiplier | 1.0 - 5.0 (typical) | Increases price distance between levels |
| `safetyOrderAmountMultiplier` | Decimal | Yes | Martingale/Anti-martingale | 1.0 - 3.0 (typical) | Size scaling per level |
| `maxSafetyOrders` | Integer | Yes | Maximum safety orders | 1 - 50 | Position accumulation limit |
| `baseOrderCondition` | Enum | No | Entry trigger | IMMEDIATELY \| INDICATOR \| TRADINGVIEW | When to place base order |
| `stopLossPercent` | Decimal | No | SL percentage | 0.1 - 100 | Price drop (LONG) or rise (SHORT) |
| `stopLossType` | Enum | No | SL trigger type | PERCENT \| PRICE | Flexible exit pricing |
| `stopLossPrice` | Decimal | No | Fixed SL price | > 0 | Absolute liquidation level |
| `takeProfitPercent` | Decimal | No | TP percentage | 0.1 - 1000 | Profit target relative to entry |
| `takeProfitType` | Enum | No | TP trigger type | PERCENT \| PRICE | Flexible profit target |
| `takeProfitPrice` | Decimal | No | Fixed TP price | > 0 | Absolute profit target |
| `trailingStopLoss` | Boolean | No | Trailing SL enabled | Default: false | Adaptive stop loss |
| `trailingTakeProfit` | Boolean | No | Trailing TP enabled | Default: false | Adaptive profit taking |
| `liquidationBuffer` | Decimal | No | Liquidation safety buffer | 1 - 10 (%) | Distance from liquidation price |
| `minPrice` | Decimal | No | Minimum entry price | > 0 | Below this, skip orders |
| `maxPrice` | Decimal | No | Maximum entry price | > minPrice | Above this, skip orders |
| `reserveFundsEnabled` | Boolean | No | Reserve funds at max price | Default: true | Lock investment while waiting |
| `pumpProtectionEnabled` | Boolean | No | Detect rapid fills | Default: true | Pause on velocity spike |

### Execution Flow

#### Initialization Phase

1. **Verify Exchange Readiness**
   - Confirm futures account status (active, no liquidation)
   - Verify available balance ≥ (baseOrderAmount * leverage)
   - Check margin mode matches configuration (ISOLATED/CROSS)

2. **Set Leverage & Margin**
   ```
   [Strategy] → connector.setLeverage(leverage, marginType)
   - Updates exchange account leverage setting
   - Applied before any orders placed
   - Gracefully degrades if unsupported
   ```

3. **Initialize Position Tracker**
   - avgEntryPrice = 0 (no fills yet)
   - totalAmountFilled = 0
   - safetyOrdersFilledCount = 0
   - Tracks position accounting across fills

#### Base Order Placement

**Condition Logic**:

| Condition | Behavior | Use Case |
|-----------|----------|----------|
| **IMMEDIATELY** | Place base order at next price update | Urgent entry, no delay |
| **INDICATOR** | Evaluate on candle close at configured timeframe | Technical analysis confirmation |
| **TRADINGVIEW** | Wait for external signal via Service Bus | Third-party alert integration |

**Placement Strategy**:

For **LONG** position:
- Order Type: **BUY** limit order
- Price: Current price (market) or specific level
- Size: `baseOrderAmount / price` (base currency units)
- Rationale: Accumulate position during entry

For **SHORT** position:
- Order Type: **SELL** limit order
- Price: Current price (market) or specific level
- Size: `baseOrderAmount / price` (base currency units)
- Rationale: Establish short position

**Max Price Feature** (futures-specific):
- If `maxPrice` configured and current price > maxPrice:
  - Place **reservation order** far from market to lock investment
  - Automatically cancel when price drops to maxPrice
  - Resume normal entry logic once cancelled

#### Safety Order (Averaging) Mechanics

**Trigger**: Each time a previous order fills

**Calculation**:

```
Price Offset:
  priceStep = baseOrderPrice * (1 + safetyOrderStepMultiplier ^ safetyOrderIndex / 100)
  
For LONG:
  safety_price = avgEntryPrice - priceStep  (buy lower)
  
For SHORT:
  safety_price = avgEntryPrice + priceStep  (sell higher)

Order Size (with Martingale):
  safety_amount = safetyOrderAmount * (safetyOrderAmountMultiplier ^ safetyOrderIndex)

Placement Limit:
  maxSafetyOrders = configuration (e.g., 10 levels)
  Only place if nextSafetyOrderToIndex < maxSafetyOrders
```

**Example - LONG BTC/USDT with leverage**:

```
Configuration:
  baseOrderAmount: 1000 USDT
  leverage: 5x (5000 USDT effective)
  safetyOrderAmount: 1000 USDT
  stepMultiplier: 1.2x
  amountMultiplier: 1.1x
  
Scenario - Price declines:
  Order 0 (Base):   @ 40,000 USDT, buy 0.25 BTC (1000/40k)
  → Fill triggers Safety Order 0
  
  Order 1 (Safety): @ 39,200 USDT, buy 0.275 BTC (1100/39.2k)
  → Fill triggers Safety Order 1
  
  Order 2 (Safety): @ 38,400 USDT, buy 0.3 BTC (1210/38.4k)
  
  Result: Averaged down, accumulated 0.825 BTC
  avgEntryPrice = 3606 USDT per BTC (volume-weighted)
```

#### Stop Loss Management

**Static Stop Loss** (percent-based):

```
For LONG:
  SL_price = avgEntryPrice * (1 - stopLossPercent/100)
  Trigger when price drops below SL_price

For SHORT:
  SL_price = avgEntryPrice * (1 + stopLossPercent/100)
  Trigger when price rises above SL_price
```

**Trailing Stop Loss** (dynamic):

```
Logic:
  1. Initialize SL as static price
  2. When new high reached (LONG):
     → Move SL up by (new_high - peak_price) * trailingPercent
  3. When new low reached (SHORT):
     → Move SL down by (peak_price - new_low) * trailingPercent
  4. Exit only when SL breached (no lower = never)
```

**Fixed Price Stop Loss** (absolute):

```
stopLossType = PRICE:
  SL_price = stopLossPrice (absolute level, not relative)
  Useful for round numbers or key support/resistance
```

#### Take Profit Management

**Static Take Profit** (percent-based):

```
For LONG:
  TP_threshold = avgEntryPrice * (1 + takeProfitPercent/100)
  Exit entire position when price ≥ TP_threshold

For SHORT:
  TP_threshold = avgEntryPrice * (1 - takeProfitPercent/100)
  Exit entire position when price ≤ TP_threshold
```

**Trailing Take Profit** (peak-tracking):

```
Logic:
  1. When PnL ≥ takeProfitPercent threshold:
     → Activate trailing mode
     → Record peak price
  2. Monitor price reversals:
     For LONG:
       → Peak moves up: update peak
       → Peak reversal of X%: exit entire position
     For SHORT:
       → Peak moves down: update peak
       → Peak reversal of X%: exit entire position
```

#### Liquidation Protection (Futures-specific)

**Liquidation Price Calculation**:

```
Simplified Formula (conservative estimate):
  For LONG:
    Liq_price = avgEntryPrice * (1 - 0.9 / leverage)
  
  For SHORT:
    Liq_price = avgEntryPrice * (1 + 0.9 / leverage)

Example (LONG, 40k entry, 5x leverage):
  Liq_price = 40k * (1 - 0.9/5) = 40k * 0.82 = 32.8k
  Distance = 19.2% drop to liquidation
```

**Buffer Enforcement**:

```
liquidationBuffer = 3 (percent)
If (distance_to_liq ≤ liquidationBuffer):
  → Log warning
  → Immediately executeExit('Liquidation Protection')
  → Close position at market
```

**Monitoring Loop** (in `onPriceUpdate`):

```
Every tick:
  1. Calculate current liquidation price
  2. Calculate distance to liquidation
  3. If distance < buffer:
     → Emergency exit entire position
     → Log liquidation buffer breach
     → Transition to STOPPED state
```

#### Exit & Position Closure

**Exit Triggers**:

| Trigger | Action | State After |
|---------|--------|-------------|
| **Take Profit (SL%)** | Market sell entire position | COMPLETED |
| **Take Profit (Trailing)** | Market sell on reversal | COMPLETED |
| **Stop Loss (%)** | Market sell at SL price | STOPPED |
| **Stop Loss (Trailing)** | Market sell on SL breach | STOPPED |
| **Liquidation Buffer** | Emergency market sell | STOPPED |
| **User Stop** | Close per user's closureStrategy | STOPPED |

**Closure Strategy Options**:

```
CLOSE_POSITIONS (default):
  → Issue market sell order for entire position
  → Lock in realized PnL
  → Transition to bot COMPLETED state

CANCEL_ORDERS:
  → Cancel all active orders
  → Keep position open (for manual closing)
  → Transition to bot STOPPED state

LIQUIDATE (aggressive):
  → Force close immediately at market (worst case)
  → Used only if emergency required
```

### Performance Monitoring

#### Key Metrics

| Metric | Description | Calculation |
|--------|-------------|------------|
| **Unrealized PnL** | Open position value vs. entry | (currentPrice - avgEntryPrice) * totalAmountFilled * leverage_factor |
| **Unrealized %** | PnL as % of margin used | (unrealizedPnL / (baseOrderAmount * leverage)) * 100 |
| **Total PnL** | Realized + Unrealized | Sum of closed + open position gains |
| **Liquidation Price** | Price at which margin call triggers | Entry * (1 - 0.9/leverage) |
| **Margin Ratio** | Used margin vs. available | (positionSize * leverage) / totalBalance |
| **Break-Even** | Price where PnL = 0 | avgEntryPrice (position entry cost) |
| **Filled Safety Orders** | Count of executed averaging | safetyOrdersFilledCount |

#### Bot Performance Window

**Real-time Tracking**:
- Current unrealized PnL (quote currency)
- Current unrealized % (percentage gain/loss)
- Average entry price (volume-weighted)
- Total position size (base currency)
- Liquidation price & distance
- Filled safety orders / total available
- Daily average profit (if >1 day running)
- Trading duration (hours/days)

**Order Management**:
- Completed trades (with profit per trade)
- Open orders (active pending orders)
- Reservation orders (if max price feature active)

### Advanced Settings & Optimizations

#### Indicator-Based Entry (INDICATOR condition)

**Use Case**: Confirm entry signal from technical analysis before deploying capital

**Configuration**:
```typescript
baseOrderCondition: 'INDICATOR'
indicatorType: 'MACD' | 'RSI' | 'Stochastic'
timeframe: '1h' | '4h' | '1d'
signal: 'BUY' | 'SELL'
```

**Execution**:
1. Bot waits in WAITING state
2. On each candle close at specified timeframe:
   - Fetch OHLCV data
   - Calculate indicator
   - Check if signal matches configuration
3. Once matched: place base order immediately

#### TradingView Alert Integration (TRADINGVIEW condition)

**Use Case**: React to external trading signals via webhooks

**Configuration**:
```typescript
baseOrderCondition: 'TRADINGVIEW'
webhook_url: 'https://your-webhook-endpoint'
```

**Execution**:
1. Bot waits in WAITING state
2. TradingView alert → HTTP POST to webhook
3. Service Bus listener routes signal to correct bot
4. Bot validates signal source and places base order

#### Pump Protection

**Purpose**: Prevent buying during rapid price spikes

**Mechanism**:

```
Velocity Detection:
  Track timestamps of last N order fills
  If > PUMP_PROTECTION_THRESHOLD fills in < PUMP_PROTECTION_WINDOW_MS:
    → Pause new orders
    → Enter PUMP state
    → Resume automatically once window clears
```

**Configuration** (automatic, non-user):
```
PUMP_PROTECTION_THRESHOLD = 3 fills
PUMP_PROTECTION_WINDOW_MS = 60 seconds
```

### Risk Management Best Practices

#### Leverage Selection

| Leverage | Risk Level | Margin Requirement | Use Case |
|----------|-----------|-------------------|----------|
| **1x-2x** | Low | 50-100% | Conservative, stable assets |
| **3x-5x** | Medium | 20-33% | Moderate volatility, good risk/reward |
| **5x-10x** | High | 10-20% | Experienced traders, high conviction |

⚠️ **Warning**: Higher leverage = faster liquidation if trend reverses

#### Liquidation Buffer Setting

```
Recommended Levels:
  Conservative: 5-10%
  Moderate:    3-5%
  Aggressive:  1-3%
  
Trade-off:
  Higher buffer = wider margin for error but less leverage
  Lower buffer = use margin fully but closer to liquidation
```

#### Stop Loss Configuration

```
Rule of Thumb:
  stopLossPercent ≥ (100 / leverage)
  
Examples:
  5x leverage → SL ≥ 20% (safety margin above liquidation)
  3x leverage → SL ≥ 33%
  2x leverage → SL ≥ 50%
```

#### Position Sizing

```
Risk Per Trade:
  maxRiskPercent = stopLossPercent / leverage
  
Example (5x, 20% SL):
  maxRiskPercent = 20 / 5 = 4% per trade
  
Never Risk More Than 2-5% Per Position
```

### Troubleshooting

#### Liquidation Risk Warnings

| Warning | Cause | Resolution |
|---------|-------|-----------|
| "Distance to liquidation: 5%" | Too much leverage or adverse price | Reduce leverage or add funds |
| "Margin ratio: 95%" | Almost fully leveraged | Close some positions |
| "Stop loss too close to liquidation" | Config error | Increase stop loss percent |

#### Insufficient Margin

| Error | Cause | Resolution |
|-------|-------|-----------|
| "Cannot place safety order: insufficient balance" | Margin fully deployed | Add funds or reduce leverage |
| "Liquidation imminent" | Price approaching liq level | Close positions immediately |

---

## 4. **BTD (Buy The Dip) Bot**

### Overview

The Buy The Dip (BTD) Bot is a specialized grid-based strategy optimized for **base-currency accumulation during price declines**. Unlike traditional grid bots that buy and sell symmetrically, BTD uses an **asymmetric grid structure** with more buy orders below the current price and fewer sell orders above, allowing it to aggressively accumulate the base currency when prices fall while taking profits on rebounds.

**Core Principle**: The bot starts with initial sell orders above the current price (base-funded), positions itself to capture market dips through strategic buy orders, and automatically sells bounces back to accumulate base currency while generating quote currency profits. The strategy thrives on volatility by repeatedly buying dips and selling rebounds within a defined price range.

**Key Innovation**: 
- **Asymmetric Grid**: Configurable levels above/below anchor price for optimal dip-catching
- **Base-Currency Profit Tracking**: Accurate profit calculation in base currency (not quote), accounting for buy/sell pairs
- **Intelligent Trailing Down**: Extends grid downward during price declines to catch deeper dips
- **Flexible Grid Configuration**: Two intuitive modes - range-driven (low/high + step%) or count-driven (levelsDown/levelsUp + step%)

**Ideal Use Cases**:
- Accumulating base currency during downtrends and sideways markets
- Leveraging strong dip-recovery patterns with repeated bounces
- Lowering average acquisition cost through systematic buying at progressively lower prices
- Markets with predictable support/resistance levels within a range
- Long-term position building with automatic profit reinvestment

### When to Use the BTD Bot

Use the BTD Bot when:
- You want to accumulate base currency while prices are declining
- You expect price to range between defined support and resistance levels
- You're comfortable with dip buying and want to automate the process
- You prefer scalping small profits on dips and recoveries rather than large directional moves
- You want transparent profit tracking in the base currency you're accumulating

**Not Recommended For**:
- Strong sustained uptrends (prefer Grid bot for continuous sell opportunities)
- Downtrends below your stop loss (need protective stops to limit losses)
- Low liquidity pairs (wide spreads reduce profit margins)
- Pairs with high volatility outside your configured range

### Configuration Fields

| Field | Type | Required | Description | Validation | Notes |
|-------|------|----------|-------------|------------|-------|
| `exchange` | String | Yes | Selected exchange/broker | Must be connected | Spot trading only |
| `pair` | String | Yes | Trading pair | Valid pair on exchange | e.g., BTC/USDT, ETH/USDC |
| **GRID CONFIGURATION (Choose One Path)** |
| `lowPrice` | Decimal | Path 1 | Lower price boundary | > 0, < highPrice | Range-driven: set range directly |
| `highPrice` | Decimal | Path 1 | Upper price boundary | > lowPrice | Range-driven: set range directly |
| `gridStep` | Decimal | Path 1 or 2 | Price gap between levels (%) | 0.1-100 | Distance between consecutive grid levels |
| `levelsDown` | Integer | Path 2 | Buy order levels below anchor | 0-gridLevels | Count-driven: explicit down levels |
| `levelsUp` | Integer | Path 2 | Sell order levels above anchor | 0-gridLevels | Count-driven: explicit up levels |
| `levelsDistribution` | Integer | No | Fallback level distribution (%) | 0-100 | Used only if explicit levels not provided; default 50 |
| **INVESTMENT & SIZING** |
| `investment` | Decimal | Yes | Total base currency allocated | > 0 | Initial amount for grid positioning |
| `gridLevels` | Integer | Yes | Total grid levels | 5-100 | Total orders (buy + sell) in the grid |
| **TRAILING & RISK MANAGEMENT** |
| `trailing` | Boolean | No | Enable trailing mechanism | Default: true | Auto-adjust grid when price exits range |
| `stopLoss` | Decimal | No | Stop loss percentage | 0-100 | Loss threshold; closes all positions |
| `stopLossEnabled` | Boolean | No | Activate stop loss | Default: false | Must enable to use stop loss |
| `takeProfit` | Decimal | No | Take profit percentage | 0.1-1000 | Profit target; closes all positions |
| `takeProfitEnabled` | Boolean | No | Activate take profit | Default: false | Must enable to use take profit |

**Configuration Paths** (Mutually Exclusive):

*Path 1: Range-Driven (Explicit Price Boundaries)*
```
User provides: lowPrice, highPrice, gridStep%, gridLevels
System derives: Number and placement of levelsDown/levelsUp based on gridLevels
Grid anchors to: Midpoint between low and high price
Use when: You know exact price range and want grid distributed within it
```

*Path 2: Count-Driven (Explicit Levels)*
```
User provides: levelsDown, levelsUp, gridStep%, gridLevels
System derives: lowPrice and highPrice based on anchor and level spacing
Grid anchors to: Current market price
Use when: You know exactly how many buy/sell orders you want on each side
```

**Configuration Validation** (Automatic Checks):
- ✓ If levelsDown/levelsUp provided → gridStep% is required
- ✓ If using range mode → lowPrice and highPrice are required
- ✓ gridLevels must be ≥ 2 (minimum 1 buy + 1 sell)
- ✓ Cannot have both levelsDown and levelsUp = 0

### How It Works

#### Initialization Phase
1. **Grid Calculation**: Based on configuration path (range or count), derive all grid price levels
   - Range mode: Evenly distribute gridLevels between lowPrice and highPrice
   - Count mode: Space levels based on levelsDown/levelsUp and gridStep%
2. **Anchor Point**: Identify the anchor price (midpoint in range mode, current price in count mode)
3. **Level Distribution**: Position buy orders below anchor, sell orders above anchor
4. **Investment Allocation**: Divide total investment equally across gridLevels for initial sizing

#### Trading Phase

**Base-Funded Start** (Unique to BTD):
- Bot starts by placing initial **sell orders ABOVE current price** only
- Does NOT immediately place buy orders
- This allows the bot to accumulate sell orders (profit orders) at higher price levels
- Creates opportunity to fill these sells as price rebounds

**When Buy Order Fills**:
```typescript
// Buy executed at lower level
1. Remove buy order from active orders
2. Place corresponding sell order at next higher grid level
3. Store buy context (price, amount) for accurate profit tracking
4. Update position metrics
```

**When Sell Order Fills**:
```typescript
// Sell executed at higher level
1. Remove sell order from active orders
2. Calculate profit in BASE currency using stored buy context:
   - grossQuoteProfit = (sellPrice - buyPrice) × amount
   - feeCost ≈ (sellPrice + buyPrice) × amount × feeRate
   - netQuoteProfit = grossQuoteProfit - feeCost
   - baseProfit = netQuoteProfit / sellPrice  ← Convert to base currency
3. Update bot performance metrics with baseProfit
4. Delete buy context from tracking map
5. Place new buy order at next lower grid level
```

**Profit Calculation in Base Currency** (Advanced):
The BTD bot uniquely tracks profit in base currency rather than quote. This is critical for bots accumulating the base asset:
- Quote profit is converted back to base currency equivalent using the sell price
- Formula: `baseProfit = netQuoteProfit / sellPrice`
- Example: If profit is 100 USDT and sell price is 50,000, base profit = 0.002 BTC
- This accurately reflects the additional base currency accumulated through trading

#### Trailing Down Mechanism

Activates when **price falls below the lowest grid level** + gridStep:

```
Current Grid: Buy orders at [48K, 49K, 50K], Sell orders at [51K, 52K]
Price drops to 47K
↓
Trailing Down triggered:
1. Cancel highest sell order (52K)
2. Shift entire grid down by gridStepValueDown
3. Place new sell order at new highest level (51K)
4. New Grid: Buy orders at [47K, 48K, 49K], Sell orders at [50K, 51K]
```

**Benefits**:
- Allows bot to "follow" price downward, catching increasingly deeper dips
- Maintains constant grid level count by shifting rather than expanding
- Preserves capital efficiency by reallocating from high levels to low levels
- Automatic adaptation without manual intervention

**Metadata Cleanup** (P0 Fix):
- When cancelling orders during trailing, both activeOrders and orderMetadata Maps are cleaned
- Prevents memory leaks in long-running bots
- Ensures profit calculation remains accurate after trailing events

#### Trailing Up Mechanism

Activates when **price rises above the highest grid level** + gridStep:

```
Current Grid: Buy orders at [48K, 49K, 50K], Sell orders at [51K, 52K]
Price rises to 53K
↓
Trailing Up triggered:
1. Cancel lowest buy order (48K)
2. Shift entire grid up by gridStepValueUp
3. Push new sell order at highest level
4. New Grid: Buy orders at [49K, 50K, 51K], Sell orders at [52K, 53K]
```

**Benefits**:
- Follows uptrends to continue capturing rebounding profits
- Helps exit accumulated positions gradually if price rallies
- Reduces concentration of buy orders below price, improving capital efficiency

#### Configuration Adjustment During Runtime

**Adjustable** (No Restart Required):
- ✓ Stop loss / Take profit thresholds
- ✓ Trailing enable/disable
- ✓ Risk management parameters

**Not Adjustable** (Requires Restart):
- ❌ Exchange or pair
- ❌ Grid configuration (lowPrice, highPrice, gridStep, gridLevels)
- ❌ Investment amount (use "Increase Investment" feature instead)

### Bot Management Operations

#### Adding Funds (Increase Investment)

Enhance accumulation velocity without restarting:

```
Before: 10,000 USDT investment across 10 levels → 1,000 per level
Add Funds: +5,000 USDT
After: 15,000 USDT investment across 10 levels → 1,500 per level

Effects:
- All unfilled orders recalculated to larger sizes
- Grid structure and levels remain unchanged
- Statistics and performance preserved; only capacity increases
```

**Process**:
1. Select running bot → [Bot Actions] → [Add Funds]
2. Enter additional amount
3. Confirm execution
4. New orders placed at all levels with increased per-order amounts

#### Stopping the Bot

**Closure Strategies**:

| Strategy | Execution | Position | Use Case |
|----------|-----------|----------|----------|
| `CLOSE_POSITIONS` | Market order to close all | Fully closed | Standard shutdown; locks current profit |
| `CANCEL_ORDERS` | Cancel all pending | Position preserved | Stop trading only; manual position handling |
| `LIQUIDATE` | Force close all + withdraw | Closed | Emergency stop; immediate exit required |
| `NONE` (default) | No action | Preserved | Stop bot only; keep position open manually |

### Risk Management & Considerations

#### Market-Specific Risks

**Price Spike Risk**:
- Sudden price jump above high price level → sold out quickly, misses upside
- Mitigation: Set highPrice appropriately; monitor market conditions

**Flash Crash Risk**:
- Quick price drop below low price → triggers multiple trailing downs, rapid capital deployment
- Mitigation: Maintain reserve capital; use stop loss to limit downside

**Sustained Downtrend Risk**:
- Continuous price decline below stop loss threshold → entire position liquidated
- Mitigation: Align stop loss with support level; choose range appropriately

#### Mitigation Strategies

1. **Stop Loss (SL)**: Closes all positions if loss exceeds threshold; limits downside exposure
2. **Take Profit (TP)**: Locks gains at predefined profit target; guarantees exits
3. **Price Range Selection**: Choose low/high based on technical support/resistance levels
4. **Grid Step Sizing**: Wider steps in high volatility; tighter steps in sideways markets
5. **Capital Reserve**: Keep funds available for margin requirements if pair demands it
6. **Monitoring**: Regular review of bot performance and market conditions

#### Best Practices

- **Liquidity First**: Choose pairs with high volume and tight bid-ask spreads
- **Range Validation**: Ensure low/high prices align with chart support/resistance
- **Conservative Start**: Begin with smaller investments to validate strategy effectiveness
- **Regular Reviews**: Monitor daily profit and adjust levels if market conditions shift
- **Diversification**: Run multiple bots on different pairs to reduce concentration risk
- **Documentation**: Track bot parameters and market conditions for future reference

### Performance Monitoring

#### Key Metrics

| Metric | Definition | Unit | Interpretation |
|--------|-----------|------|-----------------|
| **Base Profit** | Total profit in base currency | Base asset | Net accumulation from trading |
| **Quote Profit** | Total profit in quote currency | Quote asset | Cash gains from sales |
| **Daily Average Profit** | Profit per day running | Base/Quote | Velocity of accumulation |
| **Realized PnL** | Profit from closed trades | Base/Quote | Confirmed gains |
| **Unrealized PnL** | Value of open positions | Base/Quote | Potential from current holdings |
| **Win Rate** | % of profitable trades | % | Strategy effectiveness |
| **Transaction Count** | Total filled orders | Count | Trading activity level |
| **Trading Time** | Duration bot has run | Time | Cumulative operation period |
| **Currency Allocation** | Base and quote holdings | Assets | Current position composition |

#### Order History

- **Completed Orders**: View all filled trades with execution price, amount, fees, and per-trade profit
- **Open Orders**: Monitor active pending orders and their status
- **Order Timeline**: Track chronological sequence of executions for analysis
- **Profit per Trade**: Detailed breakdown enabling strategy refinement

### Quick Setup Presets

| Preset | Duration | Grid Step | Grid Levels | levelsDown | levelsUp | Best For |
|--------|----------|-----------|-------------|-----------|----------|----------|
| **Conservative** | 7+ days | 2-3% | 10-20 | 8-15 | 2-5 | Stable accumulation; dip-buying focus |
| **Balanced** | 3-7 days | 1.0-1.5% | 15-25 | 10-15 | 5-10 | Mixed volatility; profit-taking |
| **Aggressive** | 1-3 days | 0.5-0.8% | 25-40 | 15-30 | 10-15 | High volatility; rapid cycling |

**Customization Tips**:
- **More levelsDown**: Better for aggressive dip-buying; increases base accumulation
- **More levelsUp**: Better for profit-taking; reduces base accumulation but locks gains
- **Wider gridStep**: Fewer orders; larger individual trades; slower but steadier
- **Narrower gridStep**: More orders; rapid cycling; higher transaction fees but finer control

### Execution Logic Summary

1. **Initialize**: Calculate asymmetric grid based on configuration path (range or count mode)
2. **Start Trading**: Place initial sell orders above current price (base-funded model)
3. **Monitor Price**: Track market price continuously
4. **Handle Fills**: 
   - Buy fill → place sell above → store buy context for profit tracking
   - Sell fill → calculate base profit → place new buy below → clear buy context
5. **Trailing Mechanism**: 
   - If price falls below grid → trail down (shift and extend grid downward)
   - If price rises above grid → trail up (shift grid upward)
6. **Risk Management**: 
   - Monitor stop loss and take profit conditions
   - Close all positions if conditions triggered
7. **Performance**: 
   - Track total base profit, win rate, and daily accumulation metrics
   - Display detailed order history and execution timeline

---

---

## 5. **Combo Bot**

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

## 6. **Loop Bot (Recurring Buy/Sell Grid)**

### Overview

The Loop Bot is an automated position trading strategy designed for the spot market that continuously cycles between buying and selling within a predefined price range. Unlike traditional grid strategies that replace orders symmetrically, the Loop Bot operates around a **fixed Entry Price** that serves as the anchor point for the entire grid structure throughout the bot's lifetime.

**Core Principle**: The Loop Bot creates a recurring trading cycle by placing buy orders below and sell orders above the fixed Entry Price. When a sell order fills above the Entry Price, the bot places a new buy order below the Entry Price using the full proceeds. When a buy order fills, it immediately creates a gap-filling sell order or expands the grid upward, ensuring continuous market participation without manual intervention.

**Key Innovation**: The strategy implements intelligent **gap-filling priority logic** that fills empty price levels before expanding the grid, maintaining a consistent total order count and optimal capital efficiency.

**Ideal Use Cases**:
- Range-bound markets with predictable oscillation patterns
- Long-term position trading with automatic profit compounding
- Volatile markets where prices fluctuate within defined boundaries
- Diversified strategies earning profits in both base and quote currencies

### When to Use the Loop Bot

Use the Loop Bot when:
- You expect price to oscillate within a predictable range over an extended period
- You want to accumulate base currency while generating quote currency profits
- You prefer a hands-off approach with automatic profit reinvestment
- You're comfortable with spot market position building without stop loss protection
- You want flexibility to exit in either base or quote currency based on market conditions

**Not Recommended For**:
- Strong trending markets (sustained uptrend or downtrend)
- Low liquidity pairs with wide spreads
- Short-term trading strategies requiring tight stop losses
- Strategies requiring precise entry/exit timing

### Configuration Fields

| Field | Type | Required | Description | Validation | Notes |
|-------|------|----------|-------------|------------|-------|
| `exchange` | String | Yes | Selected exchange/broker | Must be connected | Spot trading only |
| `pair` | String | Yes | Trading pair | Valid pair on exchange | e.g., BTC/USDT, ETH/USDC |
| `investment` | Decimal | Yes | Total investment amount | > 0, <= available balance | Total capital allocated to this bot |
| `lowPrice` | Decimal | Yes | Lower price boundary | > 0, < entryPrice | Minimum price for buy order placement |
| `highPrice` | Decimal | No | Upper price boundary | > entryPrice | Maximum price for sell order placement (optional) |
| `orderDistance` | Decimal | Yes | Distance between orders (%) | 0.1-50 | Percentage step between consecutive grid levels |
| `orderCount` | Integer | Yes | Number of grid orders | 10-40 | Total orders distributed above and below Entry Price |
| `reinvestProfit` | Boolean | No | Enable profit reinvestment | Default: false | Automatically reinvest profits into larger positions |
| `reinvestProfitPercent` | Decimal | No | % of profit to reinvest | 0-100 (if enabled) | 0=no reinvestment, 100=full compounding |
| `takeProfitType` | Enum | No | Take profit trigger type | `TOTAL_PNL_PERCENT`, `PRICE_TARGET` | How to measure TP condition |
| `takeProfitPercent` | Decimal | No | Target profit % (Total PnL) | 0.1-1000 | Close bot when total profit reaches this % |
| `takeProfitPrice` | Decimal | No | Target exit price | > 0 | Close bot when price reaches this level |
| `exitCurrency` | Enum | No | Exit position in currency | `BASE`, `QUOTE`, `BOTH` | Which currency to hold upon TP trigger |

### How It Works

#### Fixed Entry Price Anchor

The Entry Price is **set once at bot launch** based on the current market price and **never changes** during the bot's operation. This fixed anchor provides several critical benefits:

- **Consistent Reference Point**: All buy and sell orders are calculated relative to this price
- **Predictable Profit Calculation**: Each sell above Entry Price generates profit; each buy below builds position
- **Grid Stability**: The structure remains coherent regardless of market movement
- **Performance Tracking**: Easy to measure bot effectiveness relative to initial conditions

**Example**:
```
Launch Configuration:
- Pair: BTC/USDT
- Entry Price: 50,000 USDT (locked at launch)
- Investment: 10,000 USDT
- High Price: 52,500 USDT
- Low Price: 47,500 USDT
- Order Distance: 1%
- Order Count: 10 (5 up, 5 down initially)

Grid Structure at Launch:
Sell Orders (Above Entry):
  50,500 USDT (+1%)
  51,005 USDT (+2%)
  51,515 USDT (+3%)
  52,030 USDT (+4%)
  52,550 USDT (+5%) ← Near high price limit

Entry Price: 50,000 USDT ← Fixed anchor

Buy Orders (Below Entry):
  49,500 USDT (-1%)
  49,005 USDT (-2%)
  48,515 USDT (-3%)
  48,030 USDT (-4%)
  47,550 USDT (-5%) ← Near low price limit
```

#### Gap-Filling Priority Logic

The Loop Bot implements intelligent order placement that prioritizes filling gaps in the grid before expanding to new price levels:

**When a SELL Order Fills**:
1. **Check for Buy Gaps**: Scan all known price levels below Entry Price
2. **Fill Farthest Gap First**: Place buy order at lowest price gap (farthest from Entry Price)
3. **Expand Downward** (if no gaps): Create new buy level below existing orders
4. **Respect Boundaries**: Never place orders below `lowPrice` limit

**When a BUY Order Fills**:
1. **Check for Sell Gaps**: Scan all known price levels above Entry Price
2. **Fill Farthest Gap First**: Place sell order at highest price gap (farthest from Entry Price)
3. **Expand Upward** (if no gaps): Create new sell level above existing orders
4. **Respect Boundaries**: Never place orders above `highPrice` limit (if set)

**Why Gap-Filling Matters**:
- ✅ Maintains uniform grid density across the entire price range
- ✅ Maximizes capital efficiency by keeping all invested funds active
- ✅ Prevents grid fragmentation during volatile market conditions
- ✅ Ensures consistent profit capture at all price levels
- ✅ Total order count remains constant (no runaway grid expansion)

**Example - Gap Detection & Filling**:
```
Current State:
Sell Orders Active: 50,500 | 51,515 | 52,550
Missing (Gaps): 51,005 | 52,030
Buy Orders Active: 49,500 | 48,515 | 47,550
Missing (Gaps): 49,005 | 48,030

Scenario 1: Sell fills at 50,500
→ Bot detects sell gap at 51,005 (closer to Entry)
→ Bot detects sell gap at 52,030 (farther from Entry)
→ ACTION: Place buy order at 47,550 (existing lowest)
→ But wait! No buy gaps exist below entry
→ ACTION: Expand downward to 47,050 (-5.9%)

Scenario 2: Buy fills at 49,500
→ Bot detects sell gaps at 51,005 and 52,030
→ ACTION: Place sell order at 52,030 (farthest gap from Entry)
→ Gap-filled! Grid density restored
```

#### Profit Reinvestment & Compounding

The Loop Bot supports automatic profit reinvestment to compound returns over time:

**How Reinvestment Works**:
1. **Calculate Profit**: When a sell order fills, calculate profit = `(sellPrice - buyPrice) × amount`
2. **Apply Reinvestment %**: Multiply profit by `reinvestProfitPercent` (e.g., 100% = full reinvestment)
3. **Increase Position Size**: Add reinvested profit to the buy order cost
4. **Larger Orders**: Next buy order uses `newAmount = (originalCost + reinvestedProfit) / buyPrice`
5. **Compound Growth**: Each cycle increases position size proportionally

**Reinvestment Example**:
```
Initial Cycle:
- Buy: 0.2 BTC at 49,500 USDT = 9,900 USDT
- Sell: 0.2 BTC at 50,500 USDT = 10,100 USDT
- Profit: 200 USDT
- Reinvest %: 100%

Next Cycle:
- New Buy Amount: (9,900 + 200) / 49,500 = 0.204 BTC
- Position grows by 2% each successful cycle
- After 10 cycles: 0.2 × (1.02^10) ≈ 0.244 BTC (+22%)
```

**Configuration Options**:
- **0% Reinvestment**: Pure profit extraction; position size remains constant
- **50% Reinvestment**: Half profits withdrawn, half reinvested (balanced)
- **100% Reinvestment**: Full compounding; maximum growth potential

### Key Features & Operational Mechanics

#### 🎯 Fixed Entry Price Strategy

**Entry Price Determination**:
- **Automatic**: Set to current market price when bot is confirmed and started
- **Immutable**: Never recalculates regardless of market movement
- **Reference Point**: All grid calculations use this price as the anchor

**Impact on Grid Structure**:
- Buy orders placed at `entryPrice × (1 - orderDistance × i)` for i = 1 to orderCount/2
- Sell orders placed at `entryPrice × (1 + orderDistance × i)` for i = 1 to orderCount/2
- Grid remains centered on Entry Price even if market moves significantly

**When Entry Price May Not Be Current Price**:
- If you restart a Loop Bot from history, Entry Price may differ from current market price
- Bot adapts by placing orders relative to the original Entry Price
- May require manual adjustment if price has moved significantly since last run

#### 📊 Order Lifecycle & Execution Flow

**Initialization Phase**:
1. Record current market price as fixed Entry Price
2. Calculate `investmentPerSlice = investment / orderCount`
3. Place initial buy orders below Entry Price (up to orderCount/2)
4. Place initial sell orders above Entry Price (up to orderCount/2)
5. Track all price levels in `allKnownLevels` set (max 500 levels for safety)

**Active Trading Phase** - Buy Order Fills:
1. Remove filled buy order from `activeOrders` tracking
2. Increment `totalTrades` counter
3. Calculate next sell price using gap-filling logic
4. Place sell order with amount from filled buy
5. Map sell order ID → original buy price for profit calculation

**Active Trading Phase** - Sell Order Fills:
1. Remove filled sell order from `activeOrders` tracking
2. Retrieve original buy price from `orderMap`
3. Calculate profit: `(sellPrice - buyPrice) × amount`
4. Add profit to `botProfit` performance metric
5. If reinvestment enabled: Calculate new amount with reinvested profit
6. Calculate next buy price using gap-filling logic
7. Place buy order at determined price level
8. Delete order from `orderMap` (cleanup)

**Order Cancellation Handling**:
- Remove order from `activeOrders` map
- Remove order from `orderMap` if present
- Clear order ID from `gridLevels` tracking
- Log cancellation event for audit trail
- **Note**: Manual cancellations may create gaps; bot will fill them on next cycle

#### 🔄 Automatic Profit Compounding

**Profit Calculation Formula**:
```typescript
// For each sell order that fills:
const originalBuyPrice = orderMap.get(sellOrder.id);
const tradeRevenue = sellOrder.amount × sellOrder.price;
const tradeCost = sellOrder.amount × originalBuyPrice;
const tradeProfit = tradeRevenue - tradeCost;

// Apply reinvestment percentage:
const reinvestPercent = config.reinvestProfitPercent ?? 100;
const reinvestProfit = tradeProfit × (reinvestPercent / 100);

// Calculate new position size:
const newAmount = (tradeCost + reinvestProfit) / originalBuyPrice;

// Result: newAmount > original amount (compounding effect)
```

**Long-Term Impact**:
- **Geometric Growth**: Position size grows exponentially with successful cycles
- **Risk Consideration**: Larger positions mean larger exposure during downturns
- **Balance Management**: Ensure sufficient quote currency for expanded buy orders
- **Profit Extraction**: Consider setting `reinvestProfitPercent < 100%` to withdraw some profits

#### 🛡️ Safety Mechanisms & Limits

**MAX_KNOWN_LEVELS Constraint** (500 levels):
- Prevents unbounded memory growth in `allKnownLevels` set
- Limits grid expansion in extreme market volatility
- Warning logged when limit reached; grid stops expanding
- Existing orders continue functioning normally
- **Action Required**: Stop and restart bot with adjusted parameters if limit hit

**Price Boundary Enforcement**:
- **Low Price**: Buy orders never placed below this threshold
- **High Price**: Sell orders never placed above this threshold (if configured)
- Protects against runaway grid expansion in trending markets
- Provides predictable capital exposure limits

**Insufficient Funds Handling**:
- If balance insufficient for next order, order placement fails gracefully
- Bot continues monitoring active orders
- Logs error for user notification
- **Recovery**: Add funds to exchange; bot resumes on next fill event

### Take Profit & Exit Strategies

#### Take Profit Configuration Options

The Loop Bot supports flexible take profit configurations:

| Take Profit Type | Description | When to Use | Example |
|------------------|-------------|-------------|---------|
| **Total PnL Percent** | Close when total profit reaches % of investment | Long-term profit target | TP = 20% → Close when profit = 2,000 USDT on 10,000 USDT investment |
| **Price Target** | Close when market price reaches specific level | Directional price expectation | TP = 55,000 → Close when BTC reaches 55k regardless of profit |
| **Manual Exit** | No automatic TP; user stops manually | Indefinite operation | No TP set → Bot runs until manual stop |

**Exit Currency Selection**:

When Take Profit is triggered, you can choose how to finalize your positions:

- **Convert to Base Currency**: 
  - Sells all quote currency holdings at market price to buy base currency
  - **Use Case**: You expect base currency (e.g., BTC) to appreciate long-term
  - **Result**: Final position = maximum BTC holdings

- **Convert to Quote Currency**:
  - Sells all base currency holdings at market price to quote currency
  - **Use Case**: You want to lock profits in stable currency (e.g., USDT)
  - **Result**: Final position = initial investment + profits in USDT

- **Keep Base and Quote Currency** (Default):
  - Cancels all open orders without executing additional trades
  - Transfers both base and quote balances back to your account
  - **Use Case**: You want flexibility to manually manage final positions
  - **Result**: Mixed position reflecting current grid state

#### Bot Profit vs. Position PnL

The Loop Bot's profit accounting differs from other strategies due to automatic reinvestment:

**Bot Profit Metric**:
- **Definition**: Sum of all realized profits from completed sell orders
- **Calculation**: Σ (sellPrice - buyPrice) × amount for all fills
- **Display**: May show as 0 or low value due to automatic reinvestment
- **Reality**: Profits are reinvested into larger positions, not withdrawn

**Position Value Tracking**:
- **Base Currency Holdings**: Increases over time as buy orders fill
- **Quote Currency Holdings**: Fluctuates as orders cycle
- **Total Position Value**: `(baseAmount × currentPrice) + quoteAmount`
- **True Profit**: Compare current position value to original investment

**Why Bot Profit Appears Low**:
```
Example After 50 Trades:
- Bot Profit Display: 150 USDT
- Reason: Only tracking incremental profit per reinvestment cycle
- Reality: Original 0.2 BTC position now 0.35 BTC (+75% growth)
- True Profit: (0.35 × 50,000) - 10,000 = 7,500 USDT
```

**Tracking True Performance**:
1. Monitor base currency accumulation (quantity growth)
2. Calculate position value at current price
3. Compare to original investment amount
4. Consider reinvested profits as part of position value

### Quick Setup Presets

| Preset | Duration | Order Distance | Order Count | Investment Split | Best For |
|--------|----------|----------------|-------------|------------------|----------|
| **Short-term** | Up to 3 days | 0.5% | 20-30 | 50% buy / 50% sell | High frequency, tight ranges, active monitoring |
| **Mid-term** | 7 days | 1.0% | 15-25 | 60% buy / 40% sell | Balanced approach, moderate volatility |
| **Long-term** | 25+ days | 2-3% | 10-20 | 70% buy / 30% sell | Position accumulation, wide ranges, hands-off |

**Order Count Considerations**:
- **Minimum 10 orders**: Provides sufficient grid density for cycling
- **Maximum 40 orders**: Prevents over-fragmentation and excessive order management
- **Recommended 15-25 orders**: Optimal balance of coverage and simplicity

**Order Distance Guidelines**:
- **High Volatility** (>5% daily): Use 1.5-3.0% distance to reduce churn
- **Medium Volatility** (2-5% daily): Use 0.8-1.5% distance for balanced trading
- **Low Volatility** (<2% daily): Use 0.3-0.8% distance for frequent fills

### Bot Management Operations

#### Modifying Active Loop Bot

**Not Supported**:
- ❌ Cannot add funds to running Loop Bot (reinvestment handles growth)
- ❌ Cannot adjust Entry Price (fixed at launch)
- ❌ Cannot change order count dynamically
- ❌ Cannot modify order distance while running
- ❌ No Stop Loss feature available

**Supported Modifications**:
- ✅ Adjust Take Profit settings (Total % PnL or Price Target)
- ✅ Change exit currency preference
- ✅ Enable/disable profit reinvestment
- ✅ Modify reinvestment percentage

**How to Modify**:
1. Navigate to active bot in dashboard
2. Click "Bot Actions" → "Modify Bot"
3. Update only Take Profit or reinvestment settings
4. Confirm changes; applies to future fills immediately

#### Stopping the Loop Bot

When you stop a Loop Bot, you have three closure strategies:

| Strategy | Execution | Final Position | Use Case |
|----------|-----------|----------------|----------|
| **Convert to Base Currency** | Market sell all quote currency | Maximum base currency | Expect base currency appreciation |
| **Convert to Quote Currency** | Market sell all base currency | Maximum quote currency | Lock profits in stable currency |
| **Keep Base and Quote Currency** | Cancel all orders, no trades | Mixed position | Manual management preferred |

**Execution Steps**:
1. Bot status changes to "stopped"
2. All active orders canceled immediately
3. If conversion strategy selected:
   - Place market order to convert holdings
   - Wait for fill confirmation
   - Calculate final PnL
4. Transfer balances back to exchange account
5. Bot moves to history with final performance summary

#### Restarting from History

**Important Considerations**:
- **New Entry Price**: Restarting creates a new Entry Price at current market price
- **Position Reset**: Previous position state is not preserved
- **Configuration Reuse**: All other settings (orderDistance, orderCount, etc.) are copied
- **Investment**: Uses original investment amount unless manually adjusted

**When to Restart**:
- Market returns to original range after strong trend
- Want to reuse proven configuration with new Entry Price
- Need to adjust parameters after reviewing performance

**Restart Process**:
1. Navigate to History tab in bot dashboard
2. Select completed Loop Bot
3. Click "Bot Actions" → "Restart"
4. Review and adjust configuration if needed
5. Confirm to create new bot instance with current market price as Entry Price

### Risk Management & Considerations

#### Market-Driven Risks

**Strong Trending Markets**:
- **Risk**: If price trends strongly upward, bot depletes quote currency buying all the way up
- **Impact**: All capital converted to base currency; no quote left for further buys
- **Mitigation**: Set conservative `highPrice` boundary; monitor market conditions

**Strong Downtrend**:
- **Risk**: If price trends strongly downward, bot accumulates base currency continuously
- **Impact**: All capital converted to depreciating base currency
- **Mitigation**: Set conservative `lowPrice` boundary; consider manual stop if trend confirmed

**Low Liquidity**:
- **Risk**: Orders may not fill at desired prices due to wide spreads
- **Impact**: Grid becomes inefficient; profit margins eroded by slippage
- **Mitigation**: Choose high-volume pairs; use wider orderDistance in illiquid markets

**Extreme Volatility**:
- **Risk**: Rapid price swings may fill all orders on one side quickly
- **Impact**: Grid imbalance; large position exposure in one direction
- **Mitigation**: Use wider orderDistance; set conservative price boundaries

#### Loop Bot Specific Limitations

**No Stop Loss Protection**:
- Loop Bot does **not support stop loss** features
- If price moves beyond grid boundaries, position remains open
- **Consideration**: Only use with capital you can afford to hold long-term
- **Alternative**: Set Take Profit at price target to exit if conditions deteriorate

**Automatic Reinvestment Lock-In**:
- Reinvested profits increase position size; cannot be withdrawn until bot stops
- **Consideration**: Set reinvestProfitPercent < 100% to extract some profits during operation
- **Planning**: Decide on profit extraction strategy before starting bot

**Capital Efficiency vs. Coverage**:
- Wider orderDistance → fewer orders, larger position per order, less frequent fills
- Tighter orderDistance → more orders, smaller position per order, more frequent fills
- **Consideration**: Balance coverage with minimum order size requirements

#### Best Practices

1. **Start Conservative**:
   - Use smaller investment (20-30% of total capital) for first Loop Bot
   - Choose established, high-volume pairs (BTC/USDT, ETH/USDT)
   - Set wide price boundaries (±20-30% from Entry Price)

2. **Monitor Regularly**:
   - Check position balance (base vs. quote currency) weekly
   - Review fill frequency and profit per cycle
   - Adjust orderDistance if grid too tight or too sparse

3. **Choose Appropriate Ranges**:
   - Historical volatility analysis: Review 30-90 day price range
   - Set `lowPrice` and `highPrice` within 80% of historical range
   - Allow 20% buffer for unexpected movements

4. **Profit Extraction Strategy**:
   - **Aggressive Growth**: 100% reinvestment, no Take Profit
   - **Balanced**: 50% reinvestment + Take Profit at 20% total profit
   - **Conservative**: 0% reinvestment + Take Profit at 10-15% total profit

5. **Pair Selection**:
   - ✅ High volume (>$50M daily) and tight spreads (<0.1%)
   - ✅ Established cryptocurrencies with predictable ranges
   - ✅ Pairs with mean-reverting behavior (oscillation patterns)
   - ❌ Avoid: Low-liquidity altcoins, trending meme coins, highly volatile tokens

### Performance Monitoring

#### Key Metrics

**Position Metrics**:
- **Base Currency Holdings**: Current quantity of base asset (e.g., BTC)
- **Quote Currency Holdings**: Current quantity of quote asset (e.g., USDT)
- **Position Value**: `(baseHoldings × currentPrice) + quoteHoldings`
- **Investment Growth**: `((positionValue - originalInvestment) / originalInvestment) × 100%`

**Trading Activity**:
- **Total Trades**: Count of completed buy/sell cycles
- **Average Profit Per Cycle**: `totalProfit / (totalTrades / 2)` (each cycle = 1 buy + 1 sell)
- **Fill Frequency**: Average time between order fills
- **Trading Time**: Duration since bot started

**Grid Status**:
- **Active Buy Orders**: Number and total value of pending buys
- **Active Sell Orders**: Number and total value of pending sells
- **Known Levels**: Count of price levels tracked (max 500)
- **Grid Coverage**: Price range of active orders vs. configured boundaries

**Profit Tracking**:
- **Realized Profit**: Sum of completed sell order profits
- **Reinvested Amount**: Cumulative profit reinvested into position
- **Position Growth**: Change in base currency holdings since start
- **Unrealized PnL**: Current position value vs. weighted average cost basis

#### Order History & Analysis

**Completed Trades View**:
- **Time**: Timestamp of order fill
- **Side**: Buy or Sell
- **Price**: Execution price
- **Amount**: Quantity filled
- **Total**: Price × Amount
- **Fee**: Exchange trading fee
- **Profit**: For sells only: (sellPrice - buyPrice) × amount

**Active Orders View**:
- **Price Level**: Order price
- **Side**: Buy or Sell
- **Amount**: Order quantity
- **Status**: Open, Partially Filled, Pending
- **Distance from Entry**: % above or below Entry Price
- **Time Since Placed**: Age of order

**Performance Charts**:
- **Position Value Over Time**: Line chart of total position value
- **Base/Quote Allocation**: Pie chart of holdings distribution
- **Profit by Cycle**: Bar chart of profit per completed cycle
- **Order Fill Distribution**: Heatmap of fill prices relative to Entry Price

#### Success Indicators

**Healthy Loop Bot Signs**:
- ✅ Regular order fills on both buy and sell sides (balanced activity)
- ✅ Steady increase in base currency holdings (if reinvestment enabled)
- ✅ Position value growing faster than market price (outperformance)
- ✅ Grid coverage remains within configured boundaries (no runaway expansion)
- ✅ No warnings about MAX_KNOWN_LEVELS limit (grid size under control)

**Warning Signs**:
- ⚠️ All orders filling on one side only (trending market breaking grid)
- ⚠️ Position heavily imbalanced (90%+ in base or quote)
- ⚠️ Fill frequency decreasing over time (market moving away from grid)
- ⚠️ Approaching MAX_KNOWN_LEVELS limit (grid too fragmented)
- ⚠️ Insufficient funds errors (balance depleted; cannot place new orders)

---

## 7. **Futures Grid Bot** ⭐ NEW

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
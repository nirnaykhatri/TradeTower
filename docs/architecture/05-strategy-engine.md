# E) Bot Execution & Risk Engine Design

## Strategy Interface

```typescript
interface IStrategy extends EventEmitter {
  readonly strategyType: StrategyType;
  readonly currentState: BotState;
  readonly botId: string;

  // Lifecycle
  initialize(config: Record<string, unknown>): Promise<void>;
  start(): Promise<void>;
  pause(reason: string): Promise<void>;
  resume(): Promise<void>;
  stop(closureStrategy: ClosureStrategy): Promise<void>;

  // Market Data
  onPriceUpdate(tick: PriceTick): Promise<void>;
  onCandleClose?(candle: OHLCV): Promise<void>;

  // Order Events
  onOrderFill(fill: OrderFill): Promise<void>;
  onOrderCancelled(cancel: OrderCancelResult): Promise<void>;

  // Signals
  onSignal?(signal: SignalEvent): Promise<void>;

  // State Management
  checkpoint(): Promise<StrategyStateSnapshot>;
  restore(snapshot: StrategyStateSnapshot): Promise<void>;

  // Risk
  preTradeRiskCheck(order: OrderRequest): Promise<RiskCheckResult>;
  intraTradeRiskCheck(): Promise<RiskCheckResult>;
  getMetrics(): StrategyMetrics;
  getPosition(): PositionSnapshot | null;

  // Modification
  addFunds?(amount: number): Promise<void>;
  modifyConfig?(changes: Partial<Record<string, unknown>>): Promise<void>;
}
```

## Bot State Machine

```
                    ┌──────────────────┐
                    │   INITIALIZING   │
                    └────────┬─────────┘
                             │
            ┌────────────────┼────────────────┐
            │                │                │
            ▼                ▼                ▼
   ┌────────────────┐ ┌──────────┐   ┌──────────────┐
   │ FUNDS_RESERVED │ │ WAITING  │   │    ACTIVE     │◄──────┐
   └───────┬────────┘ └────┬─────┘   └──┬──┬──┬──┬──┘       │
           │               │             │  │  │  │           │
           └───────────────┘             │  │  │  └───►TRAILING───┘
                                         │  │  └──────►PUMP──►ACTIVE
                                         │  └─────────►PAUSED──►ACTIVE
                                         │
                                    ┌────▼────┐
                                    │ CLOSING │
                                    └──┬───┬──┘
                                       │   │
                                       ▼   ▼
                                 STOPPED   COMPLETED

                                    ERROR──►STOPPED (max retries)
                                         ──►ACTIVE (recovery)
```

### Key Transitions

| From | To | Trigger |
|------|-----|---------|
| INITIALIZING | FUNDS_RESERVED | Max price set, funds locked |
| INITIALIZING | WAITING | Non-immediate start condition |
| INITIALIZING | ACTIVE | Immediate start |
| FUNDS_RESERVED | ACTIVE/WAITING | Price condition met |
| WAITING | ACTIVE | Signal/indicator/manual trigger |
| ACTIVE | TRAILING | Price exits grid range |
| ACTIVE | PUMP | Fill velocity spike detected |
| ACTIVE | PAUSED | User pause / insufficient funds |
| ACTIVE | CLOSING | TP hit / SL hit / liquidation buffer / user stop |
| TRAILING | ACTIVE | Trailing deactivated |
| PUMP | ACTIVE | Market stabilized |
| PAUSED | ACTIVE | Resume / funds available |
| CLOSING | STOPPED | Orders cancelled |
| CLOSING | COMPLETED | TP-triggered closure |
| ERROR | ACTIVE | Error recovered |
| ERROR | STOPPED | Max retries exceeded |

## Per-Strategy Key Design

### 1. Grid Trading Bot
- **Grid calculation**: Levels from `lowPrice` to `highPrice` at `gridStep` intervals
- **Order sizing**: QUOTE mode = investment/levels; BASE mode = (investment/price)/levels
- **Core loop**: Buy fill → place sell one level up; Sell fill → place buy one level down
- **Trailing up**: Price > highest level → cancel lowest buy, shift grid up
- **Trailing down**: Price < lowest level → market buy, extend grid down
- **Pump protection**: >3 fills in <60s → pause new orders

### 2. DCA Bot
- **Averaging grid**: Orders at step% intervals with amount/step multipliers
- **Active orders limit**: Reserve funds only for first N orders
- **Profit reinvestment**: Cycle profits rolled into next cycle per allocation ratio
- **Max price + reserve funds**: Far-market limit order locks investment until price met
- **Indicator triggers**: MACD/RSI/Stochastic evaluated on candle close

### 3. DCA Futures Bot
- **Leverage**: 1x-10x with isolated/cross margin
- **Safety orders**: Martingale sizing with step multiplier
- **Liquidation buffer**: Emergency exit when distance to liquidation < buffer%
- **Trailing TP/SL**: Dynamic stop/target that follows favorable price movement
- **Formula**: Liq price (LONG) = entry * (1 - 0.9/leverage)

### 4. BTD (Buy The Dip) Bot
- **Asymmetric grid**: More buy levels below, fewer sell levels above
- **Base-funded start**: Initial sell orders only above current price
- **Profit in base currency**: `baseProfit = netQuoteProfit / sellPrice`
- **Two config paths**: Range-driven (low/high) vs count-driven (levelsDown/levelsUp)

### 5. Combo Bot
- **Two phases**: DCA entry (safety orders) → Grid exit (profit-taking levels)
- **Phase transition**: When averaging complete, distribute exit grid above entry price
- **Futures**: Leverage + margin + liquidation monitoring

### 6. Loop Bot
- **Fixed entry price**: Locked at creation, never changes
- **Gap-filling priority**: Fill empty levels before expanding grid
- **No stop loss**: By design
- **MAX_KNOWN_LEVELS**: 500 cap prevents unbounded memory growth
- **Exit currency**: BASE, QUOTE, or BOTH on TP/stop

### 7. Futures Grid Bot
- **Three modes**: LONG (profit on rise), SHORT (profit on fall), NEUTRAL (volatility)
- **Grid modes**: Arithmetic (fixed price diff) or Geometric (fixed % diff)
- **Trigger price**: Delays activation until specific price level
- **Up to 200 grid levels**

### 8. TWAP Bot
- **Slice calculation**: totalAmount / (duration * 60 / frequency)
- **Market IOC orders**: Each slice is immediate-or-cancel
- **Price limit pause**: Execution paused when price exceeds limit, resumes when returns
- **Reduce-only mode**: For closing existing positions only
- **Completion report**: VWAP, best/worst price, slippage estimate

## Behavioral Specifications (Critical Algorithms)

### DCA `addFunds` Recalculation Rules

When a user calls `addFunds(amount)` on a running DCA/DCA Futures bot:

1. **Unfilled/partially-filled orders**: Recalculate order amounts using new total investment. Preserve original allocation ratio (base order vs averaging orders proportion unchanged)
2. **Filled orders**: Unchanged — already executed at original amounts
3. **Stop Loss**: Recalculate from new weighted average entry price (`newSL = newAvgEntry * (1 - stopLossPercent/100)`)
4. **Take Profit**: Unchanged — TP target is a percentage, not absolute
5. **AOL on-hold orders**: Recalculate based on new per-order amount (`newOrderAmount = newTotalInvestment * allocationRatio / totalOrders`)
6. **State preservation**: Running statistics (PnL, win rate, fill count) are NOT reset

```
addFunds(amount):
  1. newTotalInvestment = currentInvestment + amount
  2. allocationRatio = baseOrderAmount / currentInvestment
  3. newBaseOrderAmount = newTotalInvestment * allocationRatio
  4. newAvgOrderAmount = (newTotalInvestment - newBaseOrderAmount) / averagingOrdersQuantity
  5. For each PENDING/OPEN order:
     - Recalculate requestedAmount based on new per-order amount
     - Cancel old exchange order, place new one (same price level)
  6. Recalculate SL from new weighted average entry
  7. Persist updated config + checkpoint state
```

### Trailing SL/TP Ratcheting Algorithms

**Trailing Stop-Loss (LONG position)**:
```
Initialize:
  peakPrice = entryPrice
  trailingSLPrice = entryPrice * (1 - trailingPercent / 100)

On each price update:
  if currentPrice > peakPrice:
    peakPrice = currentPrice
    trailingSLPrice = peakPrice * (1 - trailingPercent / 100)
  if currentPrice <= trailingSLPrice:
    trigger exit → CLOSING state
```

**Trailing Stop-Loss (SHORT position)**:
```
Initialize:
  troughPrice = entryPrice
  trailingSLPrice = entryPrice * (1 + trailingPercent / 100)

On each price update:
  if currentPrice < troughPrice:
    troughPrice = currentPrice
    trailingSLPrice = troughPrice * (1 + trailingPercent / 100)
  if currentPrice >= trailingSLPrice:
    trigger exit → CLOSING state
```

**Trailing Take-Profit (DCA Futures)**:
```
Activation:
  When unrealizedPnlPercent >= takeProfitPercent: activate trailing TP
  peakPnl = unrealizedPnlPercent

On each price update (while trailing TP active):
  if unrealizedPnlPercent > peakPnl:
    peakPnl = unrealizedPnlPercent
  if unrealizedPnlPercent < peakPnl * (1 - trailingPercent / 100):
    trigger exit → CLOSING state (COMPLETED)
```

### BTD Metadata Cleanup on Trailing (P0 — Memory Leak Prevention)

When the BTD bot cancels orders during a grid shift (trailing up or down), it MUST clean up both the `activeOrders` Map and the `orderMetadata` Map:

```
onTrailingShift(direction):
  1. Identify orders to cancel (lowest buy levels for trailing up, highest sell for trailing down)
  2. For each cancelled order:
     a. await connector.cancelOrder(orderId)
     b. activeOrders.delete(orderId)          // ← MUST do
     c. orderMetadata.delete(orderId)         // ← MUST do (P0 fix)
  3. Calculate new grid levels
  4. Place new orders at shifted levels
  5. Update activeOrders + orderMetadata for new orders
```

**Why P0**: Without `orderMetadata.delete()`, long-running bots (days/weeks) accumulate stale metadata entries for cancelled orders, causing unbounded memory growth. At ~500 bytes per entry and 100+ grid shifts/day, this reaches 50+ MB within a week.

### DCA Insufficient Funds Auto-Resume

When a DCA/DCA Futures bot encounters insufficient funds during order placement:

```
1. Transition: ACTIVE → PAUSED (trigger: 'insufficient_funds')
2. Start balance polling timer (60s interval, 5-minute total window)
3. On each poll:
   a. balance = await connector.getBalance(quoteCurrency)
   b. if balance.available >= requiredAmount:
      - Transition: PAUSED → ACTIVE (trigger: 'funds_available')
      - Resume order placement
      - STOP timer
   c. if elapsed >= 5 minutes:
      - Stay PAUSED
      - Emit Notification: INSUFFICIENT_FUNDS (severity: WARNING)
      - STOP timer
      - User must manually add funds + resume
4. Balance polling uses exponential backoff within the 5-min window:
   - Poll at: 0s, 15s, 30s, 60s, 120s, 300s (then stop)
```

## Strategy Spec Traceability Matrix

Every field in `strategies.md` must map to a typed schema field in `04-data-architecture.md` and a Zod validator test in `09-tdd-strategy.md`. This matrix ensures no spec drift.

| Strategy | Spec Field (strategies.md) | Schema (StrategyConfigUnion) | Validator Test |
|----------|---------------------------|------------------------------|----------------|
| Grid | `exchange`, `pair`, `investment`, `lowPrice`, `highPrice`, `gridStep`, `gridLevels`, `orderSizeCurrency`, `trailingUp`, `trailingDown`, `stopTrailingDownPrice`, `pumpProtection`, `stopLoss`, `stopLossEnabled`, `takeProfit`, `takeProfitEnabled` | `GridStrategyConfig` (16 fields) | 12 Zod tests |
| DCA | `exchange`, `pair`, `strategy`, `investment`, `baseOrderAmount`, `baseOrderCondition`, `baseOrderType`, `averagingOrdersAmount`, `averagingOrdersQuantity`, `averagingOrdersStep`, `amountMultiplier`, `stepMultiplier`, `activeOrdersLimitEnabled`, `activeOrdersLimit`, `takeProfitPercent`, `stopLossPercent`, `reinvestProfitEnabled`, `reinvestProfitPercent`, `maxPrice`, `minPrice`, `reserveFundsEnabled`, `indicatorConfig` | `DcaStrategyConfig` (22 fields) | 15 Zod tests |
| DCA Futures | All DCA fields + `leverage`, `marginType`, `safetyOrderAmount`, `safetyOrderStepMultiplier`, `safetyOrderAmountMultiplier`, `maxSafetyOrders`, `liquidationBuffer`, `trailingStopLoss`, `trailingTakeProfit`, `pumpProtectionEnabled` | `DcaFuturesStrategyConfig` (20 fields) | 18 Zod tests |
| BTD | `exchange`, `pair`, `investment`, `gridLevels`, `gridStep`, `lowPrice`/`highPrice` (path 1), `levelsDown`/`levelsUp` (path 2), `trailing`, `stopLoss`, `takeProfit` | `BtdStrategyConfig` (12 fields) | 12 Zod tests |
| Combo | DCA entry fields + Grid exit fields + `initialMargin`, `leverage`, `marginType`, `liquidationBuffer` | `ComboStrategyConfig` (18 fields) | 15 Zod tests |
| Loop | `exchange`, `pair`, `investment`, `lowPrice`, `highPrice`, `orderDistance`, `orderCount`, `reinvestProfit`, `reinvestProfitPercent`, `takeProfitType`, `takeProfitPercent`, `takeProfitPrice`, `exitCurrency` | `LoopStrategyConfig` (13 fields) | 10 Zod tests |
| Futures Grid | `exchange`, `pair`, `strategyDirection`, `marginType`, `leverage`, `investment`, `lowPrice`, `highPrice`, `gridQuantity`, `gridMode`, `triggerPrice`, `stopLoss`, `takeProfit`, `closePositionOnStop` | `FuturesGridStrategyConfig` (14 fields) | 15 Zod tests |
| TWAP | `exchange`, `pair`, `direction`, `totalAmount`, `duration`, `frequency`, `marginType`, `leverage`, `reduceOnly`, `priceLimit` | `TwapStrategyConfig` (10 fields) | 12 Zod tests |

**Enforcement**: Task 4.1.1 generates this matrix and verifies 1:1 field coverage. Any field in `strategies.md` not present in the typed schema is a build-blocking defect.

## Risk Engine

### Three Layers

**1. Pre-Trade Checks (every order — MANDATORY, cannot be bypassed)**
- Balance sufficiency (query exchange API, not cached value)
- Order rate limit (max orders/min, Cosmos DB counter per user)
- Max notional per order (`min(tenant_limit, exchange_limit)`)
- Max leverage (`min(tenant_limit, exchange_api_max)` — queried from exchange at connection setup)
- Minimum order interval (anti-spam)
- **Exchange constraint validation (NEW — hard gates):**
  - **Lot size**: Round order quantity to exchange `instrument.lotSize`. Reject if below `instrument.minOrderSize`
  - **Tick size**: Round order price to exchange `instrument.tickSize`
  - **Market hours** (stocks/ETFs only — crypto always passes):
    - Trading allowed during: **Pre-market (04:00-09:30 ET)** + **Regular (09:30-16:00 ET)** + **Post-market (16:00-20:00 ET)**
    - Orders blocked outside 04:00-20:00 ET. Bot auto-pauses at 20:00 ET, auto-resumes at 04:00 ET.
    - Pre/post-market orders must use LIMIT only (market orders rejected by exchanges in extended hours)
    - Order flag `extendedHours: true` set automatically when current session is PRE_MARKET or POST_MARKET
  - **PDT check**: For Alpaca/IBKR stock accounts, query `connector.getRegulatoryInfo()`. Block if `dayTradeCount >= 3` AND equity < $25K AND this order would constitute a day trade
  - **Fractional shares**: Block fractional quantities if `instrument.fractionalAllowed === false` (IBKR, Tasty Trade)
  - **Futures contract validity**: Reject orders on expired contracts. Warn if contract expires within 7 days.

**2. Intra-Trade Monitoring (continuous)**
- Max drawdown → kill switch
- Daily loss circuit breaker
- Total notional exposure
- Pair concentration
- Liquidation distance (futures)
- **Market hours monitoring** (stocks/ETFs):
  - **04:00 ET**: Auto-resume bots (pre-market opens)
  - **09:30 ET**: No action (continuous trading through regular session)
  - **16:00 ET**: No action (continuous trading through post-market)
  - **20:00 ET**: Auto-pause bots, cancel unfilled extended-hours orders
  - Weekends/holidays: Bots stay paused. Resume at next trading day 04:00 ET.
  - Crypto bots: No market hours enforcement (24/7)

**3. Kill Switch (emergency)**
- Cancel all open orders across all bots
- Close all positions at market
- Transition all bots to STOPPED
- Execute within 5 seconds
- Full audit trail

### Exchange-Side Defense-in-Depth (MANDATORY)

**Problem**: During platform outage (4-8hr RTO), open positions have NO stop-loss protection if stops are managed only in-memory by the Strategy Engine.

**Solution**: When a strategy sets a stop-loss, the Execution Service MUST also place a corresponding **exchange-native stop order** directly on the exchange. This ensures positions are protected even when TradeTower is completely offline.

| Exchange | Exchange-Side Stop Support |
|----------|--------------------------|
| Alpaca | Stop orders, stop-limit, trailing stop (all natively supported) |
| Coinbase | Stop-limit orders (GTC) |
| IBKR | OCO, bracket orders, trailing stop, 60+ algo types |
| Tasty Trade | OCO orders |

**Execution flow**:
1. Strategy calls `riskEngine.setStopLoss(price)` → Execution Service receives order
2. Execution Service places TWO orders: (a) internal tracking in Cosmos, (b) exchange-native stop order via `connector.placeOrder({ orderType: 'STOP', ... })`
3. If platform goes down: exchange-native stop protects the position
4. On platform recovery: reconcile exchange-side orders with strategy state via `connector.getOpenOrders()`
5. If exchange stop fired while platform was down: detect via fill reconciliation, update bot state to STOPPED

**IExchangeConnector addition**:
```typescript
placeProtectiveStop(symbol: string, side: OrderSide, triggerPrice: number, amount: number): Promise<ExchangeOrderResponse>;
cancelProtectiveStop(orderId: string): Promise<void>;
```

> This is a non-negotiable safety requirement. Every strategy with stop-loss enabled MUST have a corresponding exchange-side stop. TDD: ~10 tests for protective stop placement, cancellation, and post-outage reconciliation.

### Idempotent Order Placement

```
clientOrderId = "tt-{botId}-{purpose}-{sequence}"

Before placing:
  1. Check local idempotency log
  2. Check exchange for existing order with same clientOrderId
  3. If exists: return existing (no duplicate)
  4. If not: place order, record in log
```

### Edge Case Handling

| Scenario | Response |
|----------|----------|
| **Partial fill (ACTIVE)** | Track remaining; don't place counter-order until full or cancelled |
| **Partial fill (CLOSING)** | See CLOSING state handler below |
| **WebSocket reconnect** | Fetch all open orders via REST, reconcile with local state, re-subscribe |
| **Order amendment** | Cancel + replace with same clientOrderId; handle race with fill |
| **Exchange outage** | <5 min → PAUSED; >5 min → ERROR; >30 min → alert user; exponential backoff |

### CLOSING State: Partial Fill Handler

During CLOSING, the bot is actively cancelling open orders and closing positions via market orders. Partial fills during this process create a financial safety edge case — remaining quantity must not be left unhandled.

```
On entering CLOSING state:
  1. Cancel all open limit orders (grid orders, safety orders, etc.)
  2. Cancel all exchange-side protective stops
  3. For each open position:
     a. Place market order to close (SELL for LONG, BUY for SHORT)
     b. Start 30s position-close timeout

On partial fill during CLOSING:
  1. Update remaining quantity: remainingQty = requestedQty - filledQty
  2. If remainingQty > exchange.minOrderSize:
     - Immediately re-submit market order for remaining quantity
     - Reset 30s timeout
  3. If remainingQty <= exchange.minOrderSize:
     - Treat as fully closed (dust amount acceptable)
     - Log dust amount for audit

On 30s timeout (no fill response):
  1. Cancel the pending close order
  2. Re-attempt with market IOC (immediate-or-cancel)
  3. If IOC also fails within 10s:
     - Log CRITICAL: "Position close failed — manual intervention required"
     - Emit Notification: POSITION_CLOSE_FAILED (severity: CRITICAL)
     - Transition to ERROR (not STOPPED) — position still open

Transition to STOPPED/COMPLETED:
  - ONLY when ALL positions fully closed (or dust) AND ALL orders cancelled
  - COMPLETED if triggered by take-profit
  - STOPPED if triggered by stop-loss, user stop, or error recovery
```

**TDD tests** (5 tests — added to kill switch / stop test group):
1. `should re-submit market order for remaining quantity on partial fill during CLOSING`
2. `should treat dust amounts (< minOrderSize) as fully closed`
3. `should force-cancel and re-attempt with IOC after 30s timeout`
4. `should transition to ERROR if position close fails after timeout + IOC`
5. `should only transition to STOPPED when all positions fully closed`

## Execution Service

### Exchange Connector Interface

```typescript
interface IExchangeConnector {
  connect(credentials: EncryptedCredentials): Promise<void>;
  disconnect(): Promise<void>;
  healthCheck(): Promise<boolean>;

  // Orders
  placeOrder(order: ExchangeOrderRequest): Promise<ExchangeOrderResponse>;
  cancelOrder(orderId: string): Promise<void>;
  cancelAllOrders(symbol: string): Promise<number>;
  getOrderByClientId(clientOrderId: string): Promise<ExchangeOrderResponse | null>;

  // Position & Account
  getPosition(symbol: string): Promise<ExchangePosition | null>;
  getBalance(currency?: string): Promise<ExchangeBalance[]>;
  setLeverage(symbol: string, leverage: number, marginType: string): Promise<void>;

  // WebSocket
  subscribeOrderUpdates(symbol: string, callback: Function): void;
  subscribePriceTicker(symbol: string, callback: Function): void;
  unsubscribeAll(): void;
}
```

### Rate Limiting

| Exchange | Limit | Window | Notes |
|----------|-------|--------|-------|
| Coinbase | 30 req/s (private), 10/s (public) | 1s | JWT per-request overhead |
| Alpaca | 200 req | 60s | Most generous; shared across trading + data |
| IBKR | 10 req/s (CP), 5 orders/s, 50 TWS msg/s | 1s | Most restrictive; pacing violations = 10-min lockout |
| Tasty Trade | 120 req/min, 60 orders/min | 60s | DXLink streaming unlimited |

### WebSocket Reconnection
- Exponential backoff: 1s, 2s, 4s, 8s, 16s, 32s (cap)
- Jitter to prevent thundering herd
- Auto-resubscribe all channels on reconnect
- Ping/pong heartbeat (30s interval, 10s timeout)

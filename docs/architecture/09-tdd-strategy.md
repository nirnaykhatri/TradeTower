# I) Test-Driven Development Strategy

## TDD Methodology: London School (Mock-First)

Every feature in TradingTower follows strict Red-Green-Refactor:

1. **Red**: Write a failing test that describes the behavior you want
2. **Green**: Write the minimum code to make that test pass
3. **Refactor**: Clean up while all tests remain green

### London School Applied to TradingTower

- **Strategy implementations**: Mock `IExchangeConnector` + `IRiskEngine`. Test strategy logic in isolation.
- **Exchange connectors**: Mock HTTP (nock) + WebSocket (mock ws server). Test auth, parsing, rate limiting.
- **API endpoints**: Mock services. Test routing, validation, error handling via `supertest`.
- **Data repositories**: Mock Cosmos client. Test query construction, partition keys, ETag handling.
- **React components**: Mock API client. Test rendering, form validation, user interactions.

---

## Test Pyramid

```
          /\
         /  \         E2E Tests (10%)
        / E2E\        Full user flows, webhook-to-order
       /------\
      /        \      Integration Tests (20%)
     / Integr. \      Package-to-package, Cosmos emulator, contract tests
    /------------\
   /              \   Unit Tests (70%)
  /    Unit        \  All business logic, isolated with mocks
 /------------------\
```

### Coverage Targets

| Package | Lines | Branches | Functions |
|---------|:---:|:---:|:---:|
| `@tradetower/shared` | 95% | 90% | 95% |
| `@tradetower/bot-engine` | 90% | 85% | 90% |
| `@tradetower/exchange-connectors` | 90% | 85% | 90% |
| `@tradetower/api` | 85% | 80% | 85% |
| `@tradetower/signal-service` | 90% | 85% | 90% |
| `@tradetower/market-data` | 90% | 85% | 90% |
| `@tradetower/data-access` | 85% | 80% | 85% |
| `@tradetower/web` | 80% | 75% | 80% |
| **Global minimum** | **80%** | **75%** | **80%** |

---

## Testing Stack

| Tool | Purpose | Packages |
|------|---------|---------|
| Jest + ts-jest | Unit + integration runner | All |
| Playwright | E2E browser tests | web |
| supertest | HTTP endpoint testing | api, signal-service |
| nock | HTTP request interception | exchange-connectors |
| ws (mock) | WebSocket server mock | exchange-connectors, market-data |
| @testing-library/react | Component tests | web |
| Cosmos DB Emulator | Integration DB | data-access |
| testcontainers | Cosmos DB emulator, Service Bus emulator | Integration tests (no Redis at MVP) |
| @sinonjs/fake-timers | Time mocking | TWAP, rate limiter, pump detection |

---

## Mandatory Tenant Isolation Tests (CI-Blocking)

Every repository method must have a **tenant isolation integration test** that **fails the build** if tenantId enforcement is missing. These run against the Cosmos DB emulator.

```typescript
describe('TenantIsolation (CI-blocking)', () => {
  const userA = { userId: 'user-A', tenantId: 'tenant-A' };
  const userB = { userId: 'user-B', tenantId: 'tenant-B' };

  it('BotDefinitionRepository: User A cannot read User B bots', async () => {
    await botRepo.create(buildBotDefinition({ userId: userB.userId, tenantId: userB.tenantId }));
    const result = await botRepo.findByUser(userA.tenantId);
    expect(result).toHaveLength(0); // Must not return User B's bots
  });

  it('OrderRepository: User A cannot read User B orders', async () => {
    // ... same pattern for every repository
  });

  it('Repository rejects queries without tenantId', async () => {
    await expect(botRepo.findByUser(undefined as any)).rejects.toThrow('TENANT_ID_REQUIRED');
  });

  // Repeat for: ConnectionRepository, BotRunRepository, OrderRepository,
  // SignalRepository, MetricsRepository, AuditRepository, PositionRepository
});
```

**Enforcement**: These tests are in a dedicated `__integration__/tenant-isolation.test.ts` file. CI pipeline runs them as a mandatory gate — PR cannot merge if any tenant isolation test fails.

---

## Mock Contracts

### MockExchangeConnector

```typescript
export class MockExchangeConnector implements IExchangeConnector {
  connect = jest.fn().mockResolvedValue(undefined);
  disconnect = jest.fn().mockResolvedValue(undefined);
  healthCheck = jest.fn().mockResolvedValue(true);
  placeOrder = jest.fn().mockResolvedValue({ exchangeOrderId: 'mock-001', status: 'SUBMITTED' });
  cancelOrder = jest.fn().mockResolvedValue(undefined);
  cancelAllOrders = jest.fn().mockResolvedValue(0);
  getOrderByClientId = jest.fn().mockResolvedValue(null);
  getPosition = jest.fn().mockResolvedValue(null);
  getBalance = jest.fn().mockResolvedValue([{ currency: 'USD', available: 100_000, total: 100_000 }]);
  setLeverage = jest.fn().mockResolvedValue(undefined);
  isMarketOpen = jest.fn().mockResolvedValue(true);
  getMarketHours = jest.fn().mockResolvedValue({ isOpen: true, currentSession: 'REGULAR' });
  getRegulatoryInfo = jest.fn().mockResolvedValue({ pdtRestricted: false, dayTradeCount: 0 });
  subscribeOrderUpdates = jest.fn();
  subscribePriceTicker = jest.fn();
  unsubscribeAll = jest.fn();

  // Test helpers
  simulateOrderFill(fill: Partial<OrderFill>): void { /* emit to callback */ }
  simulatePriceTick(price: number): void { /* emit to callback */ }
}
```

### MockCosmosClient, MockServiceBus, MockPriceStream

Each follows the same pattern: all methods are `jest.fn()` with sensible defaults, plus test helper methods for simulating events.

---

## TDD Task Sequence (Per Strategy)

Every strategy follows this 8-step TDD sequence. **Tests are written BEFORE implementation code.**

### Step 1: Configuration Validation Tests (Zod Schema)

```typescript
describe('GridStrategyConfigSchema', () => {
  it('should accept valid configuration');
  it('should reject investment <= 0');
  it('should reject lowPrice >= highPrice');
  it('should reject gridStep outside 0.1-100 range');
  it('should reject gridLevels outside 5-100 range');
  it('should require stopTrailingDownPrice when trailingDown is true');
  it('should require stopLoss value when stopLossEnabled is true');
});
```

### Step 2: Initialization Tests

```typescript
describe('GridStrategy.initialize', () => {
  it('should calculate grid levels between lowPrice and highPrice');
  it('should distribute investment equally across levels in QUOTE mode');
  it('should calculate per-level base amount in BASE mode');
  it('should apply fee buffers to each level');
  it('should throw if investment cannot cover minimum order sizes');
});
```

### Step 3: onPriceUpdate Tests

```typescript
describe('GridStrategy.onPriceUpdate', () => {
  it('should not place orders when all grid orders are open');
  it('should trigger trailing up when price exceeds highest level');
  it('should trigger trailing down when price falls below lowest level');
  it('should enter PUMP state when fill velocity exceeds threshold');
  it('should trigger STOP_LOSS when price hits SL level');
  it('should trigger TAKE_PROFIT when profit% hits TP threshold');
  it('should pause for stocks when market is closed');  // NEW
});
```

### Step 4: onOrderFill Tests

```typescript
describe('GridStrategy.onOrderFill', () => {
  it('should place sell counter-order one level up on buy fill');
  it('should place buy counter-order one level down on sell fill');
  it('should calculate realized PnL on round trip completion');
  it('should handle partial fills correctly');
  it('should update weighted average entry price');
});
```

### Step 5: State Checkpoint/Restore Tests

```typescript
describe('GridStrategy checkpoint/restore', () => {
  it('should produce a JSON-serializable snapshot');
  it('should restore exact state from a snapshot');
  it('should survive process restart via checkpoint + restore');
});
```

### Step 6: addFunds / modifyConfig Tests

```typescript
describe('GridStrategy.addFunds', () => {
  it('should recalculate order sizes without losing statistics');
  it('should maintain grid step and levels');
});
```

### Step 7: Stop/Closure Tests

```typescript
describe('GridStrategy.stop', () => {
  it('should cancel all orders with CANCEL_ORDERS closure');
  it('should market close positions with CLOSE_POSITIONS closure');
  it('should force liquidate with LIQUIDATE closure');
});
```

### Step 8: Implement Code to Pass All Tests

---

## Per-Strategy Test Count Estimates

| Strategy | Config | Init | Price | Fill | State | Modify | Stop | Total |
|----------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Grid | 12 | 8 | 15 | 10 | 6 | 8 | 6 | ~65 |
| DCA | 15 | 10 | 12 | 12 | 6 | 10 | 6 | ~71 |
| DCA Futures | 18 | 12 | 15 | 12 | 8 | 10 | 8 | ~83 |
| BTD | 12 | 10 | 12 | 10 | 6 | 8 | 6 | ~64 |
| Combo | 15 | 12 | 15 | 12 | 8 | 10 | 8 | ~80 |
| Loop | 10 | 10 | 10 | 10 | 6 | 6 | 6 | ~58 |
| Futures Grid | 15 | 12 | 15 | 10 | 8 | 8 | 8 | ~76 |
| TWAP | 12 | 8 | 10 | 8 | 6 | 4 | 6 | ~54 |
| **Total** | | | | | | | | **~551** |

Plus: Risk engine (~70), exchange connectors (~120), API routes (~60), data-access (~40), signal service (~30), frontend (~80)

**Note**: This early estimate of ~951 is superseded by the authoritative count of **~1,120 tests** in the "Test Count: Single Source of Truth" table below.

---

## Per-Strategy Behavioral Acceptance Criteria

Each strategy task (4.2.1–4.2.8) is **complete** only when ALL the listed edge cases have explicit test coverage. These reference specific behavioral requirements from `strategies.md` to prevent interpretation variance.

### Grid (Task 4.2.1) — Completion Criteria
- [ ] Grid levels calculated correctly for both QUOTE and BASE `orderSizeCurrency` modes
- [ ] Trailing up: cancels lowest buy, shifts grid up, places new sell at top (ref: `strategies.md` trailing section)
- [ ] Trailing down: market buy at current price, extends grid down, places new buy level below
- [ ] `stopTrailingDownPrice`: trailing down halts when price reaches configured floor
- [ ] Pump protection: >3 fills in <60s → PUMP state, new orders paused, exits on stabilization
- [ ] Stop loss / take profit: transition to CLOSING at exact configured price/percent
- [ ] Market hours (stocks): auto-pause at 20:00 ET, auto-resume at 04:00 ET, LIMIT only in extended hours
- [ ] `investmentPercentage`: calculates absolute investment from available balance at startup

### DCA (Task 4.2.2) — Completion Criteria
- [ ] Averaging grid: orders placed at `averagingOrdersStep`% intervals with `amountMultiplier` and `stepMultiplier`
- [ ] Active orders limit (AOL): only first N orders placed, rest on-hold. On fill, next on-hold order placed.
- [ ] `addFunds`: recalculates unfilled orders preserving allocation ratio (ref: `05-strategy-engine.md` addFunds rules)
- [ ] `reinvestProfitEnabled`: cycle profits rolled into next cycle at `reinvestProfitPercent`%
- [ ] `maxPrice` + `reserveFundsEnabled`: far-market limit order locks investment until price met → FUNDS_RESERVED state
- [ ] Indicator triggers: MACD/RSI/Stochastic evaluated on candle close with AND/OR logic (ref: `04-data-architecture.md` IndicatorConfig)
- [ ] Trailing stop-loss: ratcheting algorithm tracks peak price (ref: `05-strategy-engine.md` trailing SL algorithm)
- [ ] Insufficient funds: PAUSED → 5-min balance polling → auto-resume or user notification
- [ ] `baseOrderCondition` = TRADINGVIEW: waits for TradingView webhook signal before placing base order

### DCA Futures (Task 4.2.3) — Completion Criteria
- [ ] All DCA criteria above PLUS:
- [ ] Leverage applied correctly (1x-10x), margin type (isolated/cross) enforced
- [ ] Liquidation buffer: emergency exit when distance to liquidation < `liquidationBuffer`%
- [ ] Trailing TP: activates when PnL ≥ `takeProfitPercent`, tracks peak PnL, exits on reversal (ref: `05-strategy-engine.md`)
- [ ] `stopLossType`/`takeProfitType` = PRICE: uses absolute price instead of percent
- [ ] Pump protection: pauses new safety orders during detected pump
- [ ] Formula test: `liqPrice (LONG) = entry * (1 - 0.9/leverage)` verified numerically

### BTD (Task 4.2.4) — Completion Criteria
- [ ] Asymmetric grid: more buy levels below current price, fewer sell levels above
- [ ] Two config paths: range-driven (lowPrice/highPrice) vs count-driven (levelsDown/levelsUp)
- [ ] `levelsDistribution`: controls buy/sell ratio (0=all buy, 100=all sell, default 50)
- [ ] Base-funded start: initial sell orders placed above current price, funded from base holdings
- [ ] Base currency profit calculation: `baseProfit = netQuoteProfit / sellPrice`
- [ ] Trailing: grid shifts with price movement. **Metadata cleanup on cancel** (ref: `05-strategy-engine.md` P0 fix)
- [ ] Stop loss / take profit: configured per direction

### Combo (Task 4.2.5) — Completion Criteria
- [ ] Two-phase operation: DCA entry phase → Grid exit phase
- [ ] Phase transition: when averaging complete (all safety orders filled or price reverses), distribute exit grid above weighted average entry
- [ ] `baseOrderCondition`, `baseOrderType`, `activeOrdersLimitEnabled`: DCA entry config applies
- [ ] `takeProfitType`/`stopLossType` = PRICE or PERCENT: both paths tested
- [ ] `trailingStopLoss` + `trailingStopPercent`: trailing SL during exit grid phase
- [ ] Leverage + margin + liquidation monitoring (futures)

### Loop (Task 4.2.6) — Completion Criteria
- [ ] Fixed entry price: locked at creation, NEVER changes during operation
- [ ] Gap-filling priority: fill empty levels before expanding grid
- [ ] No stop loss by design (Loop strategy spec explicitly excludes SL)
- [ ] `MAX_KNOWN_LEVELS` = 500 cap: prevents unbounded memory growth. Test at boundary.
- [ ] `exitCurrency`: BASE, QUOTE, or BOTH on TP/stop — conversion logic tested for each
- [ ] `reinvestProfit` + `reinvestProfitPercent`: profit compounding across cycles
- [ ] `takeProfitType` = TOTAL_PNL_PERCENT vs PRICE_TARGET: both paths tested

### Futures Grid (Task 4.2.7) — Completion Criteria
- [ ] Three modes: LONG (profit on rise), SHORT (profit on fall), NEUTRAL (volatility profit, no initial position)
- [ ] Grid modes: ARITHMETIC (fixed price diff between levels) vs GEOMETRIC (fixed % diff)
- [ ] `triggerPrice`: bot stays WAITING until price hits trigger, then activates
- [ ] Up to 200 grid levels: test at boundary (gridQuantity=200)
- [ ] `closePositionOnStop`: when true, close all positions on bot stop. When false, leave positions open.
- [ ] Leverage + margin type enforcement + liquidation check

### TWAP (Task 4.2.8) — Completion Criteria
- [ ] Slice calculation: `totalAmount / (duration * 60 / frequency)` verified numerically
- [ ] Market IOC orders: each slice placed as immediate-or-cancel
- [ ] `priceLimit`: execution paused when price exceeds limit, resumes when returns within limit
- [ ] `reduceOnly`: slices must have reduceOnly flag set, rejected if no open position
- [ ] Completion report: VWAP, best/worst slice price, total slippage estimate
- [ ] Market hours respect (stocks): only count market-open seconds for scheduling. Pause slices at 20:00 ET.
- [ ] Fake timer tests: `@sinonjs/fake-timers` for deterministic slice scheduling

---

## Exchange Connector TDD Sequence

For each of the 4 connectors (Coinbase, Alpaca, IBKR, Tasty Trade):

1. **Record real API responses** from sandbox/testnet as JSON fixtures
2. **Write tests against fixtures**: order placement, cancellation, fills, balance, positions
3. **Write WebSocket/streaming tests**: message parsing, event emission, heartbeat
4. **Write rate limiter tests**: within limit, queuing, window reset
5. **Write reconnection tests**: exponential backoff, jitter, resubscribe
6. **Write market hours tests**: isMarketOpen, extended hours, calendar (NEW)
7. **Write PDT tracking tests**: day trade counting, violation prevention (NEW)
8. **Implement connector** to pass all tests

---

## Risk Engine TDD Sequence (~70 tests)

1. **Pre-trade check tests** (~20): balance, notional, leverage, rate, PDT, lot size, tick size, market hours, fractional shares, futures expiry
2. **Intra-trade monitoring tests** (~20): drawdown, daily loss, circuit breaker, liquidation distance, pair concentration, total exposure
3. **Kill switch tests** (~10): cancel all, close all, state transition, audit trail, partial failure recovery
4. **Exchange-side protective stop tests** (~10): stop placement, cancellation, post-outage reconciliation, exchange stop fired while offline, stop update on SL change
5. **Edge case / fault injection tests** (~10):
   - Simultaneous limit breaches (2 risk rules triggered at once)
   - Race condition between pre-trade check and order placement
   - Cosmos 429 during kill switch execution
   - Key Vault unavailability during credential access
   - Partial network partition (can reach Cosmos but not exchange)
   - Exchange returning stale/delayed price data
   - Service Bus dead-letter overflow handling
6. **Implement risk engine** to pass all tests

---

## Test Data Management

### Builder Pattern (Deterministic, No Random)

```typescript
// Fixed base timestamp: 2024-01-15T10:00:00Z
const BASE_TIMESTAMP = 1705312800000;
let idCounter = 0;

export function buildGridConfig(overrides = {}): GridStrategyConfig {
  return {
    strategyType: 'GRID', investment: 1000, lowPrice: 90, highPrice: 110,
    gridStep: 2, gridLevels: 10, orderSizeCurrency: 'QUOTE',
    trailingUp: true, trailingDown: false, pumpProtection: true,
    stopLossEnabled: false, takeProfitEnabled: false, ...overrides,
  };
}

export function buildPriceTick(overrides = {}): PriceTick {
  return { pair: 'BTC/USD', price: 100, bid: 99.95, ask: 100.05,
           volume: 1000, timestamp: BASE_TIMESTAMP, ...overrides };
}

export function buildOrderFill(overrides = {}): OrderFill {
  return { id: `fill-${++idCounter}`, side: 'BUY', fillPrice: 100,
           fillAmount: 1, feeAmount: 0.1, feeCurrency: 'USD', ...overrides };
}
// Builders for all entities: User, Bot, Connection, Order, Signal, etc.
```

### Price Sequence Generators

```typescript
export const PRICE_SEQUENCES = {
  uptrend:    generateLinearSequence({ startPrice: 100, endPrice: 120, ticks: 20 }),
  downtrend:  generateLinearSequence({ startPrice: 100, endPrice: 80, ticks: 20 }),
  sideways:   generateOscillatingSequence({ center: 100, amplitude: 5, period: 10, ticks: 40 }),
  flashCrash: [100, 95, 85, 75, 70, 72, 80, 88, 92, 95].map((p, i) => buildPriceTick({ price: p })),
  pumpSpike:  [100, 125, 156, 195, 244].map((p, i) => buildPriceTick({ price: p })),
};
```

### Time Mocking (TWAP, Pump Detection)

```typescript
import { install as installFakeTimers } from '@sinonjs/fake-timers';

let clock: InstalledClock;
beforeEach(() => { clock = installFakeTimers({ now: new Date('2024-01-15T10:00:00Z') }); });
afterEach(() => { clock.uninstall(); });

// Advance time deterministically
await clock.tickAsync(30_000); // advance 30 seconds
```

---

## CI/CD Test Gates (Enforcing TDD)

### PR Gate (`pr-gate.yml`) — ALL MANDATORY

```yaml
jobs:
  lint-and-typecheck:     # npm run lint && npm run typecheck
  unit-tests:             # npm test -- --coverage --ci
  integration-tests:      # npm run test:integration (Cosmos emulator)
  coverage-gate:          # Jest enforces 80% lines / 75% branches
  tenant-isolation-gate:  # __integration__/tenant-isolation.test.ts must pass
  test-file-check:        # Custom: see "Test-First Enforcement" below
```

### Test-First Enforcement (CI Rule)

**Rule**: Any PR that modifies production code in `packages/*/src/**/*.ts` MUST also include or modify test files in the same package (`packages/*/src/**/*.test.ts` or `packages/*/src/__tests__/**`).

```yaml
# In pr-gate.yml
test-file-check:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
      with: { fetch-depth: 0 }
    - name: Check test files accompany production changes
      run: |
        CHANGED_SRC=$(git diff --name-only origin/main...HEAD -- 'packages/*/src/**/*.ts' \
          ':!packages/*/src/**/*.test.ts' ':!packages/*/src/__tests__/**' ':!packages/*/src/__fixtures__/**')
        if [ -n "$CHANGED_SRC" ]; then
          CHANGED_TESTS=$(git diff --name-only origin/main...HEAD -- 'packages/*/src/**/*.test.ts' 'packages/*/src/__tests__/**')
          if [ -z "$CHANGED_TESTS" ]; then
            echo "❌ FAIL: Production files changed but no test files modified"
            echo "Changed source files:"
            echo "$CHANGED_SRC"
            echo ""
            echo "TDD requires tests to accompany production changes."
            exit 1
          fi
        fi
        echo "✅ Test-first check passed"
```

### TDD Proof-of-Evidence (PR Template)

Every PR must include this checklist in the PR description. CI does not enforce commit ordering, but the template makes the developer attest to TDD discipline:

```markdown
## TDD Evidence
- [ ] Failing test(s) written BEFORE implementation code
- [ ] Test file(s) modified/created: `packages/{pkg}/src/__tests__/{file}.test.ts`
- [ ] All new tests fail when run against previous commit (Red phase confirmed)
- [ ] Implementation is minimal to pass tests (Green phase)
- [ ] Refactoring done with all tests passing
- [ ] Coverage meets package threshold (80%+ lines, 75%+ branches)
- [ ] Mutation score meets threshold (70% general / 80% critical) if applicable
- [ ] Tenant isolation tests pass (if touching data-access)
```

This template is enforced via `.github/PULL_REQUEST_TEMPLATE.md`. Reviewers verify TDD evidence before approving.

### Mutation Testing Gate (Critical Paths)

| Module | Stryker Frequency | Minimum Score | Scope |
|--------|:-:|:-:|-------|
| `bot-engine/src/risk/**` | Every PR touching risk | **80%** | Pre-trade checks, kill switch, circuit breaker |
| `bot-engine/src/execution/**` | Every PR touching execution | **80%** | Order placement, fill processing, idempotency |
| `api/src/middleware/auth*` | Every PR touching auth | **80%** | JWT validation, tenant context |
| All other modules | Weekly CI job | **70%** | General mutation coverage (raised from 60% — financial software warrants higher floor) |

### Fault Injection Tests (Financial Safety)

Exchange and infrastructure failures MUST be tested. These run as part of integration tests:

```typescript
describe('Fault Injection (CI-blocking)', () => {
  // Exchange failures
  it('should pause bot gracefully when exchange returns 500 mid-grid');
  it('should reconcile state when WS disconnects mid-order-fill');
  it('should not double-place orders when exchange timeout + eventual success');
  it('should trigger kill switch when exchange returns 401 (revoked API key)');

  // Infrastructure failures
  it('should retry and succeed when Cosmos returns 429 (throttled)');
  it('should complete kill switch even if individual cancel calls fail');
  it('should not lose state when Container App restarts mid-strategy-tick');
  it('should handle Service Bus message redelivery idempotently');

  // Market failures
  it('should respect circuit breaker when price gaps 10% in one tick');
  it('should handle stock market halt gracefully (order rejected by exchange)');
});
```

### Automated Fixture Regeneration

When weekly contract tests detect exchange API response changes:
1. Test fails and logs the schema diff
2. CI creates a GitHub issue with title: `[Contract Drift] {exchange} - {endpoint}`
3. Assignee records new fixture from sandbox and updates `__fixtures__/{exchange}/`
4. PR must include updated fixture + any connector code changes to handle new schema

### Additional Gates

| Gate | Frequency | Target |
|------|-----------|--------|
| **Contract tests** | Weekly | Validate exchange API fixtures against live sandbox |
| **Performance benchmarks** | Pre-release | See SLA targets table below |
| **E2E (Playwright)** | Pre-release | Bot creation, webhook-to-order, dashboard rendering |
| **Tenant isolation** | Every PR | Cross-tenant data leak tests on all repositories |

---

## Performance SLA Targets (Pre-Release Gate)

| Operation | p95 Target | Measurement |
|-----------|:----------:|-------------|
| `onPriceUpdate` (strategy tick) | <1ms | Jest benchmark, fake timers |
| `preTradeRiskCheck` | <5ms | Jest benchmark with mocked Cosmos |
| Order end-to-end (strategy decision → exchange API call) | <500ms | Integration test with mock exchange |
| WebSocket delivery (change feed → Web PubSub → client) | <200ms | Manual measurement, App Insights trace |
| Dashboard SSR (initial load) | <2s | Playwright `page.goto` + `DOMContentLoaded` |
| Bot wizard submit (config → API → response) | <1s | Playwright E2E |
| Kill switch execution (all orders cancelled) | <5s | Integration test with mock exchange |
| API endpoint response (p95) | <500ms | k6 load test, 50 concurrent users |

Benchmarks run as part of the pre-release gate (`npm run bench`). Failures do not block PRs but are tracked as Sev3 issues.

---

## Universal TDD Task Template (Mandatory for ALL Tasks)

Every task across ALL 11 epics must follow this template. No exceptions.

### Template: Application Code Tasks

```
Task X.Y.Z: [Name] (TDD)
  1. RED:      Write failing tests first (N tests defined)
  2. GREEN:    Write minimum code to make tests pass
  3. REFACTOR: Clean up with all tests still passing
  4. VERIFY:   Coverage >80% (>90% for strategies/risk). Mutation score >70% for critical paths.
  Acceptance: All N tests pass. CI gates pass. PR includes test + production files.
```

### Template: IaC / Bicep Tasks

```
Task 1.2.X: Bicep [Module] (TDD)
  1. DEFINE:   Write expected resource list in test assertions
  2. WRITE:    Create Bicep module with parameters + outputs
  3. VALIDATE: Run `az deployment group validate --what-if` for all env param files
  4. ASSERT:   Expected resources appear. No unexpected deletions. RBAC present.
  5. CI GATE:  PR validation runs what-if for dev + prod param files
  Acceptance: `--what-if` shows correct resources for all environments.
```

### Template: Exchange Connector Tasks

```
Task 3.2.X: [Exchange] Connector (TDD)
  1. GATE:     Verify testnet/paper access (go/no-go from doc 02)
  2. RECORD:   Capture real API responses as JSON fixtures
  3. RED:      Write tests against fixtures (auth, orders, fills, WS, rate limiter)
  4. GREEN:    Implement connector to pass all fixture-based tests
  5. REFACTOR: Clean up, extract shared logic to BaseConnector
  6. LIVE:     Run against testnet (not in CI — manual validation)
  Acceptance: All N fixture tests pass. Contract test validates weekly.
```

### Template: Frontend Tasks

```
Task 8.X.Y: [Component] (TDD)
  1. RED:      Write @testing-library/react tests for rendering + interactions
  2. GREEN:    Implement component to pass tests
  3. VISUAL:   Manual review (screenshots in PR)
  4. E2E:      Playwright test for the full user flow (pre-release gate)
  Acceptance: Component tests pass. E2E covers happy path.
```

### Test Count: Single Source of Truth

| Epic | Tests | Source |
|------|:-----:|--------|
| E1 Foundation (incl IaC validation) | ~50 | Bicep what-if + auth + tenant isolation |
| E2 Auth | ~20 | NextAuth, JWT middleware, user profile |
| E3 Connectors (Alpaca + Coinbase) | ~67 | 35 Alpaca + 32 Coinbase |
| E4 Strategies + Risk | ~621 | 8 strategies (551) + risk engine (70) |
| E5 Signal Ingestion | ~30 | Webhook, replay, routing, plugin |
| E6 Data Layer | ~40 | Repositories, change feed, tenant isolation |
| E7 API + Real-Time | ~40 | Endpoints, WebPubSub, CORS |
| E8 Frontend | ~80 | Components, forms, charts, animations, E2E, visual regression |
| E9 Hardening | ~20 | Security, GDPR, DR, STRIDE |
| E10 Backtesting | ~95 | SimulatedConnector, engine, API |
| E3b Connectors (Tasty + IBKR) | ~68 | 30 Tasty + 38 IBKR |
| **TOTAL** | **~1,120** | |

This is the authoritative test count. All docs reference this table.

**Changes from original 1,065**:
- Risk engine: 34 → 70 (+36) — exchange-side stop tests, edge case/fault injection tests
- Frontend: 50 → 80 (+30) — premium UI animations, E2E, visual regression tests

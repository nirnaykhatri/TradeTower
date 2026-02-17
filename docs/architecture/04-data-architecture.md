# D) Data Architecture (Cosmos DB)

## Container Summary

| Container | Partition Key | Throughput | TTL | Change Feed |
|---|---|---|---|---|
| Users | **`/tenantId`** | Shared DB (400 RU/s autoscale) | None (GDPR erasure) | Yes |
| Connections | **`/tenantId`** | Shared DB | None (GDPR erasure) | Yes |
| BotDefinitions | **`/tenantId`** | Shared DB | None | Yes |
| BotRuns | **`/tenantId/botDefinitionId`** (hierarchical) | Shared DB | **7 years** | Yes |
| StrategyConfigs | **`/tenantId/botDefinitionId`** (hierarchical) | Shared DB | **7 years** | Yes |
| SignalEvents | **`/tenantId/botRunId`** (hierarchical) | Shared DB | 90 days | Yes |
| Orders | **`/tenantId/botRunId`** (hierarchical) | **Dedicated autoscale 400-4000 RU/s** | **7 years** | Yes |
| Positions | **`/tenantId/botRunId`** (hierarchical) | Shared DB | **7 years** | Yes |
| BotStateTransitions | **`/tenantId/botRunId`** (hierarchical) | Shared DB | **7 years** (audit) | Yes |
| MetricsSnapshots | **`/tenantId/botRunId`** (hierarchical) | Shared DB | Tiered (1m=1d, 1h=30d, 1d=7yr) | Yes |
| AuditEvents | **`/tenantId`** | Shared DB | **7 years** | Yes |
| **Notifications** | **`/tenantId`** | Shared DB | 90 days | Yes |
| **Leases** | **`/id`** | Shared DB | None | No |
| **FailedMessages** | **`/tenantId`** | Shared DB | 30 days | No |

> **Tenant isolation via partition keys**: All sensitive containers (Connections, BotDefinitions, BotRuns, Orders, Positions, SignalEvents, AuditEvents) include `tenantId` in the partition key. Cross-tenant reads are structurally impossible at the Cosmos level — a query with tenant A's partition key can never return tenant B's data.

> **Cosmos DB Autoscale** for all environments. Shared database throughput (400 RU/s autoscale, ~$29/mo) covers 13 low-traffic containers. The Orders container gets dedicated autoscale (400-4000 RU/s) because it's the hottest write path. Total estimated: **~$58/mo** (shared $29 + Orders dedicated $29). All entities include `_schemaVersion: number`.
>
> **Consistency level: Session** (all envs). Provides read-your-writes guarantee at zero extra RU cost. A strategy placing an order will always see that order on subsequent reads within the same session. Default "Eventual" would cause stale reads where the UI or strategy might not see recently-placed orders. Session consistency uses a session token passed per request — the Cosmos SDK handles this automatically.
>
> **Throughput evolution**: Increase the autoscale max on hot containers (Orders, Positions) via Bicep param change — no migration needed. Autoscale handles burst automatically.

### Indexing Policy (Per Container)

**Principle**: Exclude large nested objects (config, state, payload, metadata) from indexing to reduce write RU cost by 10-30%. Include only fields used in `WHERE`, `ORDER BY`, and `JOIN` clauses.

| Container | Included Paths | Excluded Paths | Composite Indexes |
|-----------|---------------|----------------|-------------------|
| **Users** | `/tenantId/?`, `/email/?`, `/status/?`, `/createdAt/?` | `/preferences/*`, `/defaultRiskLimits/*` | None |
| **Connections** | `/tenantId/?`, `/exchangeId/?`, `/status/?` | `/lastHealthCheck/*` | None |
| **BotDefinitions** | `/tenantId/?`, `/strategyType/?`, `/status/?`, `/pair/?`, `/isEnabled/?` | `/strategyConfig/*`, `/riskConfig/*` | `[tenantId ASC, updatedAt DESC]` |
| **BotRuns** | `/tenantId/?`, `/botDefinitionId/?`, `/status/?`, `/startedAt/?`, `/strategyType/?` | `/runtimeState/*`, `/performanceSummary/*` | `[tenantId ASC, startedAt DESC]`, `[tenantId ASC, status ASC, startedAt DESC]` |
| **Orders** (hottest) | `/tenantId/?`, `/botRunId/?`, `/documentType/?`, `/status/?`, `/side/?`, `/createdAt/?`, `/filledAt/?` | `/exchangeResponse/*`, `/metadata/*` | `[tenantId ASC, botRunId ASC, createdAt DESC]`, `[tenantId ASC, botRunId ASC, status ASC]` |
| **Positions** | `/tenantId/?`, `/botRunId/?`, `/snapshotTimestamp/?`, `/isLatest/?` | `/gridState/*` | `[tenantId ASC, botRunId ASC, snapshotTimestamp DESC]` |
| **SignalEvents** | `/tenantId/?`, `/botRunId/?`, `/source/?`, `/status/?`, `/receivedAt/?` | `/payload/*`, `/rawBody/*` | None |
| **BotStateTransitions** | `/tenantId/?`, `/botRunId/?`, `/fromState/?`, `/toState/?`, `/transitionedAt/?` | `/context/*` | None |
| **MetricsSnapshots** | `/tenantId/?`, `/botRunId/?`, `/timestamp/?`, `/granularity/?` | `/metrics/*` | `[tenantId ASC, botRunId ASC, granularity ASC, timestamp DESC]` |
| **AuditEvents** | `/tenantId/?`, `/eventType/?`, `/severity/?`, `/timestamp/?` | `/details/*`, `/previousState/*`, `/newState/*` | `[tenantId ASC, timestamp DESC]` |
| **Notifications** | `/tenantId/?`, `/type/?`, `/read/?`, `/createdAt/?` | — | `[tenantId ASC, read ASC, createdAt DESC]` |

> **RU impact**: Excluding `/strategyConfig/*` and `/runtimeState/*` from BotDefinitions and BotRuns saves ~30% write RU on these frequently-updated documents. Composite indexes on Orders and BotRuns enable efficient paginated queries without post-query sorting.

### GDPR Right-to-Erasure
User deletion triggers an anonymization service that:
1. Replaces PII (name, email) with hashed identifiers across Users, Connections, AuditEvents
2. Revokes and deletes exchange API credentials from Key Vault
3. Preserves anonymized trade records for 7-year compliance retention
4. Logs the erasure action as an AuditEvent (immutable record of deletion)

## Entity Schemas

### Common Enumerations

```typescript
enum StrategyType {
  GRID = 'GRID', DCA = 'DCA', DCA_FUTURES = 'DCA_FUTURES',
  BTD = 'BTD', COMBO = 'COMBO', LOOP = 'LOOP',
  FUTURES_GRID = 'FUTURES_GRID', TWAP = 'TWAP',
}

// CANONICAL SOURCE — all docs must use these exact values
// Generate from: packages/shared/src/types/bot-state.ts
enum BotState {
  INITIALIZING   = 'INITIALIZING',   // Config validated, setting up
  FUNDS_RESERVED = 'FUNDS_RESERVED', // Max-price feature: funds locked, waiting for price
  WAITING        = 'WAITING',        // Waiting for indicator/webhook/manual trigger
  ACTIVE         = 'ACTIVE',         // Trading normally
  TRAILING       = 'TRAILING',       // Grid trailing up/down active
  PUMP           = 'PUMP',           // Pump protection paused
  PAUSED         = 'PAUSED',         // User pause or insufficient funds
  CLOSING        = 'CLOSING',        // Shutdown in progress (cancelling orders, closing positions)
  STOPPED        = 'STOPPED',        // Terminated (SL, user stop, error)
  COMPLETED      = 'COMPLETED',      // Finished successfully (TP hit, TWAP complete)
  ERROR          = 'ERROR',          // Unrecoverable error
}
// NOTE: "CLOSING" is the canonical name (not "STOPPING").
// CLOSING = actively cancelling orders / closing positions.
// STOPPED = terminal state after CLOSING completes.

enum OrderSide { BUY = 'BUY', SELL = 'SELL' }
enum OrderType { MARKET = 'MARKET', LIMIT = 'LIMIT', STOP_LIMIT = 'STOP_LIMIT' }
enum OrderStatus {
  PENDING = 'PENDING', SUBMITTED = 'SUBMITTED', OPEN = 'OPEN',
  PARTIALLY_FILLED = 'PARTIALLY_FILLED', FILLED = 'FILLED',
  CANCELLED = 'CANCELLED', REJECTED = 'REJECTED',
}
enum ClosureStrategy { CLOSE_POSITIONS, CANCEL_ORDERS, LIQUIDATE, NONE }
enum MarginType { ISOLATED = 'ISOLATED', CROSS = 'CROSS' }
enum PositionDirection { LONG = 'LONG', SHORT = 'SHORT', NEUTRAL = 'NEUTRAL' }
```

### User

```typescript
interface User {
  id: string;
  tenantId: string;
  userId: string;
  displayName: string;
  email: string;
  identityProvider: 'google' | 'microsoft';
  identityProviderSubjectId: string;
  status: 'active' | 'suspended' | 'deleted';
  preferences: {
    timezone: string;
    defaultCurrency: string;
    notificationsEnabled: boolean;
    theme: 'light' | 'dark' | 'system';
  };
  defaultRiskLimits: {
    maxOrdersPerMinute: number;
    maxTotalNotionalUsd: number;
    maxLeverage: number;
    dailyLossLimitUsd: number;
  };
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string;
}
```

### Connection

```typescript
interface Connection {
  id: string;
  userId: string;
  tenantId: string;
  label: string;
  exchangeId: string;
  exchangeName: string;
  status: 'ACTIVE' | 'INACTIVE' | 'ERROR' | 'VALIDATING';
  apiKeyVaultSecretUri: string;       // Key Vault reference
  apiSecretVaultSecretUri: string;    // Key Vault reference
  passphraseVaultSecretUri?: string;
  supportsSpot: boolean;
  supportsFutures: boolean;
  supportsWebSocket: boolean;
  supportedPairs: string[];
  permissions: {
    canTrade: boolean;
    canReadBalance: boolean;
    canWithdraw: boolean;
  };
  lastHealthCheck: {
    checkedAt: string;
    isHealthy: boolean;
    latencyMs: number;
    errorMessage?: string;
  };
  createdAt: string;
  updatedAt: string;
}
```

### BotDefinition

```typescript
interface BotDefinition {
  id: string;
  userId: string;
  tenantId: string;
  name: string;
  strategyType: StrategyType;
  connectionId: string;
  pair: string;
  exchangeId: string;
  status: BotState;
  activeBotRunId: string | null;
  strategyConfig: StrategyConfigUnion;  // discriminated union of all 8 configs
  riskConfig: {
    maxOrdersPerMinute: number;
    maxOrderNotionalUsd: number;
    maxConsecutiveFailures: number;
  };
  tags: string[];
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}
```

### Strategy Config Schemas (All 8)

```typescript
// ---- Indicator Configuration (used by DCA + DCA Futures) ----
interface IndicatorTrigger {
  type: 'MACD' | 'RSI' | 'STOCHASTIC';
  timeframe: '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d';
  signal: 'BUY' | 'SELL';
  params?: {
    // MACD: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 }
    // RSI: { period: 14, overbought: 70, oversold: 30 }
    // Stochastic: { kPeriod: 14, dPeriod: 3, slowing: 3 }
    [key: string]: number;
  };
}

interface IndicatorConfig {
  triggers: IndicatorTrigger[];  // 1-3 simultaneous indicators
  logic: 'AND' | 'OR';          // AND: all must signal. OR: any one triggers.
}

// ---- Discriminated union ----
type StrategyConfigUnion =
  | GridStrategyConfig
  | DcaStrategyConfig
  | DcaFuturesStrategyConfig
  | BtdStrategyConfig
  | ComboStrategyConfig
  | LoopStrategyConfig
  | FuturesGridStrategyConfig
  | TwapStrategyConfig;

interface GridStrategyConfig {
  strategyType: 'GRID';
  investment: number;
  investmentPercentage?: number;     // ADDED: % of available balance (0-100)
  lowPrice: number;
  highPrice: number;
  gridStep: number;                  // % 0.1-100
  gridLevels: number;                // 5-100
  orderSizeCurrency: 'BASE' | 'QUOTE';
  trailingUp: boolean;
  trailingDown: boolean;
  stopTrailingDownPrice?: number;
  pumpProtection: boolean;
  stopLoss?: number;
  stopLossEnabled: boolean;
  takeProfit?: number;
  takeProfitEnabled: boolean;
}

interface DcaStrategyConfig {
  strategyType: 'DCA';
  strategy: 'LONG' | 'SHORT';
  investment: number;
  baseOrderAmount: number;
  baseOrderCondition: 'IMMEDIATELY' | 'PRICE_CHANGE' | 'MANUAL' | 'INDICATOR' | 'TRADINGVIEW';
  baseOrderType: 'LIMIT' | 'MARKET';
  averagingOrdersAmount: number;
  averagingOrdersQuantity: number;
  averagingOrdersStep: number;
  amountMultiplier: number;
  stepMultiplier: number;
  activeOrdersLimitEnabled: boolean;
  activeOrdersLimit?: number;
  takeProfitPercent?: number;
  stopLossPercent?: number;
  trailingStopLoss?: boolean;        // ADDED: per strategies.md lines 514-518
  trailingStopPercent?: number;      // ADDED: trailing SL percentage
  reinvestProfitEnabled: boolean;
  reinvestProfitPercent?: number;
  maxPrice?: number;
  minPrice?: number;
  reserveFundsEnabled: boolean;
  indicatorConfig?: IndicatorConfig;  // Typed multi-indicator with AND/OR logic
  // NOTE: TRADINGVIEW in baseOrderCondition is intentional extension beyond strategies.md
}

interface DcaFuturesStrategyConfig {
  strategyType: 'DCA_FUTURES';
  strategy: 'LONG' | 'SHORT';
  leverage: number;
  marginType: MarginType;
  baseOrderAmount: number;
  safetyOrderAmount: number;
  safetyOrderStepMultiplier: number;
  safetyOrderAmountMultiplier: number;
  maxSafetyOrders: number;
  baseOrderCondition: 'IMMEDIATELY' | 'INDICATOR' | 'TRADINGVIEW';
  stopLossPercent?: number;
  stopLossType?: 'PERCENT' | 'PRICE';  // ADDED: per strategies.md line 684
  stopLossPrice?: number;               // ADDED: absolute SL price
  takeProfitPercent?: number;
  takeProfitType?: 'PERCENT' | 'PRICE'; // ADDED: per strategies.md line 687
  takeProfitPrice?: number;              // ADDED: absolute TP price
  trailingStopLoss: boolean;
  trailingTakeProfit: boolean;
  liquidationBuffer: number;
  minPrice?: number;                     // ADDED: per strategies.md line 692
  maxPrice?: number;                     // ADDED: per strategies.md line 693
  reserveFundsEnabled: boolean;          // ADDED: per strategies.md line 694
  pumpProtectionEnabled: boolean;
  indicatorConfig?: IndicatorConfig;  // Typed multi-indicator with AND/OR logic
}

interface BtdStrategyConfig {
  strategyType: 'BTD';
  investment: number;
  gridLevels: number;
  gridStep: number;
  lowPrice?: number;
  highPrice?: number;
  levelsDown?: number;
  levelsUp?: number;
  levelsDistribution?: number;       // ADDED: 0-100, default 50. Per strategies.md line 1137
  trailing: boolean;
  stopLoss?: number;
  stopLossEnabled: boolean;
  takeProfit?: number;
  takeProfitEnabled: boolean;
}

interface ComboStrategyConfig {
  strategyType: 'COMBO';
  strategy: 'LONG' | 'SHORT';
  initialMargin: number;
  leverage: number;
  marginType: MarginType;
  lowPrice: number;
  highPrice: number;
  // DCA entry phase
  baseOrderAmount: number;
  baseOrderCondition?: 'IMMEDIATELY' | 'PRICE_CHANGE' | 'MANUAL';  // ADDED
  baseOrderType?: 'LIMIT' | 'MARKET';                               // ADDED
  averagingOrdersAmount: number;
  averagingOrdersQuantity: number;
  averagingOrdersStep: number;
  activeOrdersLimitEnabled?: boolean;                                // ADDED
  activeOrdersLimit?: number;                                        // ADDED
  // Grid exit phase
  gridStep: number;
  gridLevels: number;
  // Exit conditions
  takeProfitType?: 'PERCENT' | 'PRICE';                             // ADDED
  takeProfitPercent?: number;                                        // ADDED
  takeProfitPrice?: number;                                          // ADDED
  stopLossType?: 'PERCENT' | 'PRICE';                               // ADDED
  stopLossPercent?: number;                                          // ADDED
  stopLossPrice?: number;                                            // ADDED
  trailingStopLoss: boolean;
  trailingStopPercent?: number;                                      // ADDED
  liquidationBuffer: number;
}

interface LoopStrategyConfig {
  strategyType: 'LOOP';
  investment: number;
  lowPrice: number;
  highPrice?: number;
  orderDistance: number;
  orderCount: number;        // 10-40
  reinvestProfit: boolean;
  reinvestProfitPercent?: number;
  takeProfitType?: 'TOTAL_PNL_PERCENT' | 'PRICE_TARGET';
  takeProfitPercent?: number;
  takeProfitPrice?: number;
  exitCurrency: 'BASE' | 'QUOTE' | 'BOTH';
}

interface FuturesGridStrategyConfig {
  strategyType: 'FUTURES_GRID';
  strategyDirection: 'LONG' | 'SHORT' | 'NEUTRAL';
  marginType: MarginType;
  leverage: number;
  investment: number;
  lowPrice: number;
  highPrice: number;
  gridQuantity: number;      // 2-200
  gridMode: 'ARITHMETIC' | 'GEOMETRIC';
  triggerPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  closePositionOnStop: boolean;
}

interface TwapStrategyConfig {
  strategyType: 'TWAP';
  direction: 'BUY' | 'SELL';
  totalAmount: number;
  duration: number;          // minutes, 5-1440
  frequency: number;         // seconds, 5-60
  marginType: MarginType;
  leverage: number;
  reduceOnly: boolean;
  priceLimit?: number;
}
```

### OrderRequest / OrderFill

```typescript
interface OrderRequest {
  id: string;
  documentType: 'ORDER_REQUEST';
  botRunId: string;          // partition key
  userId: string;
  exchangeOrderId: string | null;
  clientOrderId: string;     // idempotency key
  pair: string;
  side: OrderSide;
  orderType: OrderType;
  status: OrderStatus;
  purpose: 'BASE_ORDER' | 'AVERAGING_ORDER' | 'GRID_ORDER' | 'TAKE_PROFIT' |
           'STOP_LOSS' | 'RESERVATION' | 'TWAP_SLICE' | 'MANUAL_CLOSE';
  requestedPrice: number | null;
  requestedAmount: number;
  gridLevel?: number;
  safetyOrderIndex?: number;
  twapSliceIndex?: number;
  leverage?: number;
  reduceOnly: boolean;
  createdAt: string;
  submittedAt: string | null;
}

interface OrderFill {
  id: string;
  documentType: 'ORDER_FILL';
  orderRequestId: string;
  botRunId: string;          // partition key
  userId: string;
  exchangeOrderId: string;
  exchangeTradeId: string;
  pair: string;
  side: OrderSide;
  fillPrice: number;
  fillAmount: number;
  fillValueQuote: number;
  feeAmount: number;
  feeCurrency: string;
  isPartialFill: boolean;
  cumulativeFilledAmount: number;
  remainingAmount: number;
  realizedPnl: number | null;
  slippageBps: number | null;
  filledAt: string;
}
```

### BotStateTransition (Audit)

```typescript
interface BotStateTransition {
  id: string;
  botRunId: string;          // partition key
  userId: string;
  fromState: BotState;
  toState: BotState;
  trigger: string;           // 'user_start' | 'stop_loss_hit' | 'pump_detected' | etc.
  reason: string;
  transitionedAt: string;
  initiatedBy: 'system' | 'user' | 'risk_engine' | 'exchange';
  context: Record<string, unknown>;
}
```

### AuditEvent

```typescript
interface AuditEvent {
  id: string;
  tenantId: string;          // partition key
  userId: string;
  eventId: string;
  eventType: string;         // BOT_STARTED, ORDER_FILLED, RISK_KILL_SWITCH, etc.
  severity: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
  resourceType: string;
  resourceId: string;
  description: string;
  timestamp: string;
  source: 'api' | 'system' | 'exchange' | 'risk_engine';
  correlationId: string;
  details?: Record<string, unknown>;
}
```

### Notification

```typescript
interface Notification {
  id: string;
  tenantId: string;          // partition key
  userId: string;
  type: 'KILL_SWITCH' | 'BOT_ERROR' | 'EXCHANGE_DISCONNECT' | 'STOP_LOSS_TRIGGERED' |
        'TAKE_PROFIT_HIT' | 'IBKR_REAUTH_REQUIRED' | 'INSUFFICIENT_FUNDS' |
        'PDT_WARNING' | 'SESSION_EXPIRING' | 'SYSTEM_ALERT';
  severity: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
  title: string;
  message: string;
  botId?: string;
  botRunId?: string;
  read: boolean;
  readAt?: string;
  channel: 'IN_APP' | 'EMAIL' | 'BOTH';
  emailSent: boolean;
  createdAt: string;
  _schemaVersion: number;
}
```

## Query Patterns (Updated for Tenant-Prefixed Partition Keys)

> All queries MUST include `tenantId` as the partition key prefix. The `TenantContext` middleware injects this from the JWT. Queries without `tenantId` are rejected by the repository base class.

### Dashboard Queries

| Query | Container | Partition Key Used | Cross-Partition? | Cost |
|-------|-----------|-------------------|:---:|------|
| Active bots for user | BotDefinitions | **`/tenantId`** | No | ~2-5 RU |
| Active bot performance | BotRuns | **`/tenantId/botDefinitionId`** (hierarchical — query by tenantId prefix returns all runs for that tenant) | No | ~3-10 RU |
| User portfolio PnL | BotRuns | **`/tenantId`** (hierarchical prefix query) | No — single tenant partition | ~5-15 RU |
| Historical runs (filtered) | BotRuns | **`/tenantId`** prefix + `startedAt` composite index | No | ~10-30 RU/page |
| Orders for a bot run | Orders | **`/tenantId/botRunId`** (hierarchical — both levels) | No | ~5-15 RU/page |
| Latest position | Positions | **`/tenantId/botRunId`** + `isLatest=true` | No | ~1-3 RU |
| Audit trail | AuditEvents | **`/tenantId`** | No | ~5-15 RU/page |

**Key insight**: With hierarchical partition keys (`/tenantId/botRunId`), querying by just `/tenantId` returns all documents for that tenant (fan-out within the tenant's partitions only, not the full container). This eliminates the need for cross-partition queries on the dashboard.

### Cross-Partition Queries (Admin/Export Only)

| Pattern | When Used | Optimization |
|---------|-----------|-------------|
| All fills across tenants | Admin export only | Materialize via change feed to Blob Storage CSV |
| Global admin search | Platform operator dashboard | Azure Cognitive Search via change feed (future) |

> **No cross-partition queries in normal user flows.** Every user-facing query is scoped to a single tenant partition. This is enforced by the `TenantContext` middleware + repository base class.

## Change Feed Architecture

```
Cosmos DB Change Feed
  ├── BotRuns, Orders, Positions, StateTransitions
  │   └── RealtimeUiProcessor → Azure Web PubSub (live UI updates)
  ├── Orders (fills)
  │   └── MetricsAggregationProcessor → MetricsSnapshots (1m→1h→1d rollup)
  └── All containers
      └── AuditEventCaptureProcessor → AuditEvents container
```

**Processing guarantees**: At-least-once delivery with idempotent writes. Ordered within partition. Lease containers for checkpoint management.

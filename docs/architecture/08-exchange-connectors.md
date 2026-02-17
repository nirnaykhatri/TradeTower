# H) Multi-Asset Exchange Connector Analysis

## Overview

TradingTower supports **four exchanges/brokers** spanning crypto, stocks, futures, forex, and options:

| Exchange | Asset Classes | API Type | Auth | Paper Trading |
|----------|--------------|----------|------|:---:|
| **Coinbase** | Crypto spot + futures | REST + WebSocket | JWT (ES256 key pair) | Yes (sandbox) |
| **Alpaca** | US stocks, ETFs, crypto | REST + WebSocket | API Key + Secret (or OAuth) | Yes (full paper env) |
| **Interactive Brokers** | Stocks, futures, forex, options (global) | TWS API (socket) + Client Portal (REST) | TWS local + 2FA / OAuth | Yes (paper account) |
| **Tasty Trade** | Futures, options, stocks, crypto | REST + DXLink (proprietary WS) | Session token (username/password) | Yes (sandbox) |

### Key Differences from Crypto-Only

| Dimension | Crypto-Only | Multi-Asset (TradingTower) |
|-----------|------------|---------------------------|
| Market hours | 24/7 | Mixed: 24/7 crypto + **04:00-20:00 ET** stocks (pre + regular + post market) |
| Instruments | Pairs (BTC/USDT) | Pairs, tickers (AAPL), contracts (ES), options chains |
| Settlement | Instant | T+1 stocks, instant crypto, varied futures |
| Regulation | Minimal | PDT rules, Reg-T margin, FINRA requirements |
| Fractional | Always (8 decimals) | Varies: Alpaca yes, IBKR limited, Tasty no |
| Leverage | Exchange-defined (1-125x) | Reg-T margin (2:1 day / 4:1 intraday), portfolio margin |

---

## Per-Exchange API Details

### 1. Coinbase (Advanced Trade API)

- **REST**: `https://api.coinbase.com/api/v3/brokerage`
- **WebSocket**: `wss://advanced-trade-ws.coinbase.com`
- **Auth**: JWT (ES256 key pair from CDP). Self-signed JWT per request (2-min lifetime)
- **Instruments**: Crypto spot (BTC-USD, ETH-USD), crypto futures (BTC-PERP)
- **Order types**: Market, Limit, Limit IOC, Stop-Limit, Trigger Bracket, Trailing Stop
- **Rate limits**: 30 req/s (private), 10 req/s (public), 750 WS connections/key
- **Symbol format**: `BTC-USD` (dash-separated)
- **Gotchas**: No subaccounts via API, futures separate from spot account, heartbeat required on WS, JWT regeneration per request

### 2. Alpaca (Trading API v2)

- **REST**: `https://api.alpaca.markets` (live) / `https://paper-api.alpaca.markets` (paper)
- **Market Data**: `https://data.alpaca.markets` (separate service)
- **WebSocket**: Trading updates + market data (separate streams)
- **Auth**: `APCA-API-KEY-ID` + `APCA-API-SECRET-KEY` headers. OAuth also supported.
- **Instruments**: US stocks (NYSE, NASDAQ), ETFs, crypto
- **Order types**: Market, Limit, Stop, Stop-Limit, Trailing Stop. All support day/GTC/IOC/FOK/OPG/CLS
- **Rate limits**: 200 req/min (trading API), 200 req/min (free market data)
- **Commission**: Free for stocks, ETFs, crypto
- **PDT rules**: Enforces FINRA PDT — accounts <$25K limited to 3 day trades per 5 rolling days
- **Market hours**: Provides `/v2/clock` and `/v2/calendar` endpoints
- **Extended hours**: Pre-market 04:00-09:30, post-market 16:00-20:00 ET
- **Fractional shares**: Supported for market and day-limit orders
- **No futures**: Alpaca does not support futures trading
- **SDK**: Official `@alpacahq/alpaca-trade-api` (Node.js)

### 3. Interactive Brokers (IBKR)

- **Client Portal API**: REST + WS via local gateway or cloud
- **TWS API**: Proprietary TCP socket protocol (port 7496 live / 7497 paper)
- **Auth**: Daily re-authentication with 2FA (IB Key app). OAuth available for Technology Providers
- **Instruments**: Stocks (150+ markets), futures (CME, EUREX), forex (80+ pairs), options, bonds, funds
- **Order types**: 60+ types including VWAP, TWAP, Adaptive, Midpoint, Iceberg, Bracket, OCA, Conditional
- **Rate limits**: 10 req/s (Client Portal), 5 orders/s, 50 TWS msg/s, 6 historical req/10s (strict pacing)
- **conId**: Every instrument identified by unique integer conId. Must resolve symbol → conId
- **Market data**: Requires paid subscriptions. 100 concurrent data lines (tier-dependent)
- **Gotchas**: Most complex API. Daily re-auth breaks automation. Pacing violations = 10-min lockout. No native `client_order_id` (uses sequential integer orderId)
- **SDK**: Official `@interactivebrokers/tws-api`, community `@stoqey/ib`

### 4. Tasty Trade (Open API)

- **REST**: `https://api.tastyworks.com` (prod) / `https://api.cert.tastyworks.com` (sandbox)
- **Streaming**: DXLink protocol via `wss://tasty-openapi-ws.dxfeed.com/realtime`
- **Auth**: Session token from `POST /sessions` with username/password. Remember-token for silent refresh
- **Instruments**: Stocks, ETFs, futures (CME), options (equity + index + futures), crypto
- **Order types**: Market, Limit, Stop, Stop-Limit. Day/GTC/GTD/IOC/FOK. OCO, bracket
- **Rate limits**: 120 req/min (REST), 60 orders/min, 5 session attempts/min
- **Symbol formats**: Stocks=`AAPL`, Futures=`/ESH6`, Options=OCC format, Crypto=`BTC/USD`
- **DXLink**: Proprietary dxFeed protocol. Binary+JSON mixed, channel multiplexing. Significant implementation effort
- **Gotchas**: No official Node.js SDK. DXLink is complex. No native `client_order_id`. IRA accounts cannot short/margin. No bracket in single request

---

## Updated IExchangeConnector Interface

```typescript
interface IExchangeConnector extends EventEmitter {
  readonly exchangeId: ExchangeId;
  readonly supportedAssetClasses: ReadonlyArray<AssetClass>;
  readonly isConnected: boolean;

  // Connection lifecycle
  connect(credentials: EncryptedCredentials): Promise<void>;
  disconnect(): Promise<void>;
  healthCheck(): Promise<HealthCheckResult>;

  // Authentication
  isSessionValid(): Promise<boolean>;
  refreshSession(): Promise<boolean>;
  getAuthRequirements(): AuthRequirements;

  // Market hours & calendar (NEW)
  isMarketOpen(assetClass: AssetClass): Promise<boolean>;
  getMarketHours(assetClass: AssetClass): Promise<MarketHoursInfo>;
  getTradingCalendar(start: string, end: string, assetClass: AssetClass): Promise<TradingCalendarDay[]>;

  // Instrument discovery (NEW)
  searchInstruments(query: string, assetClass?: AssetClass): Promise<Instrument[]>;
  getInstrument(symbol: string, assetClass: AssetClass): Promise<Instrument | null>;
  getSupportedOrderTypes(assetClass: AssetClass): ExtendedOrderType[];

  // Orders
  placeOrder(order: ExchangeOrderRequest): Promise<ExchangeOrderResponse>;
  cancelOrder(orderId: string): Promise<void>;
  cancelAllOrders(symbol?: string): Promise<number>;
  getOrderByClientId(clientOrderId: string): Promise<ExchangeOrderResponse | null>;
  getOpenOrders(symbol?: string): Promise<ExchangeOrderResponse[]>;
  previewOrder(order: ExchangeOrderRequest): Promise<OrderPreview>;

  // Positions & Account
  getPosition(symbol: string): Promise<ExchangePosition | null>;
  getAllPositions(): Promise<ExchangePosition[]>;
  getBalance(currency?: string): Promise<ExchangeBalance[]>;
  getAccountInfo(): Promise<AccountInfo>;
  getRegulatoryInfo(): Promise<RegulatoryInfo>;  // NEW: PDT, margin type
  setLeverage(symbol: string, leverage: number, marginType: string): Promise<void>;

  // Exchange-Side Stop Protection (MANDATORY — see 05-strategy-engine.md)
  placeProtectiveStop(symbol: string, side: OrderSide, triggerPrice: number, amount: number): Promise<ExchangeOrderResponse>;
  cancelProtectiveStop(orderId: string): Promise<void>;

  // Streaming
  subscribeOrderUpdates(symbol: string, callback: OrderUpdateCallback): void;
  subscribePriceTicker(symbol: string, callback: PriceTickCallback): void;
  unsubscribeAll(): void;
}
```

### New Types for Multi-Asset

```typescript
enum AssetClass {
  CRYPTO_SPOT = 'CRYPTO_SPOT',
  CRYPTO_FUTURES = 'CRYPTO_FUTURES',
  US_EQUITY = 'US_EQUITY',
  ETF = 'ETF',
  FUTURES = 'FUTURES',
  OPTIONS = 'OPTIONS',
  FOREX = 'FOREX',
}

interface MarketHoursInfo {
  isOpen: boolean;
  currentSession: 'PRE_MARKET' | 'REGULAR' | 'POST_MARKET' | 'CLOSED' | 'TWENTY_FOUR_SEVEN';
  nextOpen: Date | null;
  nextClose: Date | null;
  timezone: string;
  extendedHoursAvailable: boolean;
}

interface RegulatoryInfo {
  pdtRestricted: boolean;
  dayTradeCount: number;
  dayTradeBuyingPower: number;
  isPatternDayTrader: boolean;
  marginType: 'CASH' | 'REG_T' | 'PORTFOLIO' | 'CRYPTO' | null;
  maxLeverage: number;
}

interface OrderPreview {
  estimatedCost: number;
  estimatedCommission: number;
  marginImpact: number;
  dayTradeCountImpact: number;
  wouldViolatePDT: boolean;
  warnings: string[];
  isAllowed: boolean;
}
```

---

## Strategy Compatibility Matrix

| Strategy | Coinbase | Alpaca | IBKR | Tasty Trade | Notes |
|----------|:---:|:---:|:---:|:---:|-------|
| Grid Trading | Yes | Yes | Yes | Yes | Trades pre+regular+post market. Auto-pause 20:00-04:00 ET |
| DCA | Yes | Yes | Yes | Yes | Natural fit for stock accumulation |
| DCA Futures | Yes | No | Yes | Yes | No futures at Alpaca |
| BTD | Yes | Yes | Yes | Yes | Excellent for stock dip-buying |
| Combo | Yes | No | Yes | Yes | Requires futures for full features |
| Loop | Yes | Yes | Yes | Yes | Extended hours consideration |
| Futures Grid | Yes | No | Yes | Yes | Contract specs vary by exchange |
| TWAP | Yes | Yes | Yes | Yes | Must respect market hours |

### Key Strategy Adaptations for Stocks

- **Market hours**: Bots trade during pre-market (04:00-09:30 ET) + regular (09:30-16:00 ET) + post-market (16:00-20:00 ET). Auto-pause at 20:00 ET, auto-resume at 04:00 ET. LIMIT orders only in pre/post-market.
- **Price precision**: Stocks trade in $0.01 increments (not 8 decimal places)
- **Fractional shares**: Alpaca supports, IBKR limited, Tasty no
- **PDT tracking**: Pre-trade check must prevent pattern day trading violations
- **Settlement**: T+1 for stocks (proceeds available for trading, not withdrawal)
- **TWAP duration**: Only count market-open minutes for stock TWAP execution
- **Futures contract roll**: Alert user N days before expiry; option to auto-roll

---

## Rate Limits Summary

| Exchange | REST General | REST Orders | WS Connections | Notes |
|----------|:-:|:-:|:-:|-------|
| Coinbase | 30/s private, 10/s public | Included in private | 750/key | JWT per-request overhead |
| Alpaca | 200/min | 200/min (shared) | 1/stream type | Most generous for trading |
| IBKR | 10/s (CP) | 5 orders/s | 1 (CP) or unbounded (TWS) | Most restrictive; pacing violations |
| Tasty Trade | 120/min | 60/min | 1 (DXLink) | DXLink streaming unlimited |

---

## Connector Build Priority

| Priority | Exchange | Rationale | Effort |
|:---:|----------|-----------|:---:|
| 1 | **Alpaca** | Simplest API, best SDK, covers stocks + crypto, commission-free, excellent paper trading | 2-3 weeks |
| 2 | **Coinbase** | JWT auth well-documented, crypto-focused, good sandbox | 2 weeks |
| 3 | **Tasty Trade** | REST straightforward; DXLink streaming is the challenge | 3-4 weeks |
| 4 | **IBKR** | Most complex: dual API, daily re-auth, conId resolution, TWS dependency | 4-6 weeks |

---

## Circuit Breaker Pattern (Per-Exchange)

The `BaseConnector` implements a per-exchange circuit breaker to prevent cascading failures when an exchange API is degraded. Without it, all bots pile up retries during exchange outages, burning CPU and Cosmos rate limits from state updates.

### State Machine

```
     ┌──────────┐   5 consecutive failures   ┌──────────┐
     │  CLOSED  │ ──────────────────────────► │   OPEN   │
     │ (normal) │                              │(fail-fast│
     └──────────┘ ◄──────────────────────────  │  60s)    │
         ▲         probe succeeds              └────┬─────┘
         │                                          │ 60s timer
         │         ┌───────────┐                    │
         └─────────┤ HALF-OPEN │ ◄──────────────────┘
           success │ (1 probe) │
                   └───────────┘
                        │ probe fails
                        └──────────► OPEN (reset 60s timer)
```

### Configuration

```typescript
interface CircuitBreakerConfig {
  failureThreshold: number;     // 5 — consecutive failures to trip
  resetTimeout: number;         // 60_000ms — time in OPEN before probing
  halfOpenMaxProbes: number;    // 1 — probes before closing
  monitoredErrors: string[];    // ['5xx', 'TIMEOUT', 'ECONNREFUSED'] — not 4xx
}
```

### Behavior

| State | Behavior | Bot Impact |
|-------|----------|------------|
| **CLOSED** | All requests pass through normally. Failure counter increments on monitored errors (5xx, timeout, connection refused). Resets on success. | Normal trading |
| **OPEN** | All requests immediately fail with `CircuitBreakerOpenError`. No exchange API calls made. | All bots for this exchange auto-PAUSED. User notified: `EXCHANGE_DISCONNECT`. |
| **HALF-OPEN** | One probe request allowed (health check). If succeeds → CLOSED. If fails → OPEN (reset timer). | Bots remain PAUSED. Probe is automatic. |

### Key Design Decisions

- **4xx errors do NOT trip the breaker** — those are client errors (bad request, insufficient funds), not exchange outages
- **Per-exchange, not per-endpoint** — if the exchange is down, all endpoints are likely affected
- **Bot auto-pause on OPEN** — prevents order placement during outage (which would fail and burn retries)
- **Bot auto-resume on CLOSED** — when circuit closes, all PAUSED bots (paused by breaker) automatically resume
- **Metrics**: App Insights custom events for `circuit_breaker_tripped{exchange}`, `circuit_breaker_closed{exchange}`

### TDD Tests (~8 tests)

```typescript
describe('CircuitBreaker', () => {
  it('should remain CLOSED on fewer than 5 consecutive failures');
  it('should trip to OPEN after 5 consecutive 5xx errors');
  it('should NOT trip on 4xx errors (client errors)');
  it('should fail-fast with CircuitBreakerOpenError when OPEN');
  it('should transition to HALF-OPEN after 60s timeout');
  it('should close circuit on successful probe in HALF-OPEN');
  it('should re-open circuit on failed probe in HALF-OPEN');
  it('should auto-pause all bots for exchange when circuit opens');
});
```

---

## Risk Assessment

| Risk | Exchange | Severity | Mitigation |
|------|:---:|:---:|-----------|
| Daily re-auth breaks automation | IBKR | Critical | Apply for OAuth program; session monitoring + user notification; graceful bot pause |
| DXLink protocol complexity | Tasty Trade | High | Spike PoC first; consider dxFeed commercial SDK |
| PDT violations lock accounts | Alpaca, IBKR | High | PDT tracking service; pre-trade check blocks at limit; surface count in UI |
| Market hours mismatch | All stocks | Medium | Trading window 04:00-20:00 ET. Auto-pause/resume. LIMIT only in extended hours. Clear UI session indicator |
| conId resolution fragile | IBKR | Medium | Build + cache conId mapping; handle futures roll dates |
| Fractional share differences | Alpaca vs IBKR | Low | Round to exchange lot size in BaseConnector; reject sub-minimum configs |

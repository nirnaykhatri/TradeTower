# F) Signal Ingestion Design

## Webhook Intake

### Architecture

```
TradingView Webhook → Container Apps Ingress (or Front Door if enabled)
  → Azure Function (HTTP Trigger) → Validate → Authenticate → Rate Limit
  → Service Bus (signal-events) → Bot Orchestration → Strategy Engine → Order Execution
```

### Validation Pipeline

1. **Schema validation**: Required fields (`ticker`, `action`, `price`, `timestamp`)
2. **Authentication**: URL-embedded token verification (not in body per TradingView best practice)
3. **Timestamp freshness**: Reject signals older than 60 seconds
4. **Replay protection**: **Cosmos DB** — store `hash(payload)` document with `_ttl=300` (5 minutes). Works across all Function instances (unlike in-memory which is per-instance). ~1 RU per write.
5. **Rate limiting** (2-tier):
   - **Tier 1 (fast, in-memory)**: Token bucket in Function instance memory. Catches most bursts with zero latency. Per-instance only — not distributed.
   - **Tier 2 (distributed, Cosmos DB)**: Per-user counter documents with `_ttl=60` (1-minute window). 100 req/min per user. ~1 RU per read+write. Cross-instance accurate.
   - Flow: Tier 1 rejects obvious bursts instantly → Tier 2 provides authoritative cross-instance enforcement for close-to-limit cases.
6. **IP allowlisting**: Optional per user

> **Why not Redis?** Redis is eliminated at MVP. Azure Functions are stateless — in-memory state doesn't persist across instances. Cosmos DB Serverless handles replay protection and rate limiting at <1 RU per check, working correctly across all Function instances.

### Response Codes

| Code | Meaning |
|------|---------|
| 200 | Signal accepted and enqueued |
| 400 | Invalid payload (schema validation failed) |
| 401 | Authentication failed |
| 409 | Duplicate signal (replay protection) |
| 429 | Rate limited (Retry-After header included) |

## AI/ML Signal Plugin Interface

```typescript
interface ISignalPlugin {
  readonly name: string;
  readonly version: string;
  initialize(config: PluginConfig): Promise<void>;
  generateSignal(marketData: MarketContext): Promise<Signal | null>;
  getHealth(): PluginHealth;
  shutdown(): Promise<void>;
}

interface MarketContext {
  pair: string;
  currentPrice: number;
  ohlcv: OHLCV[];
  indicators?: Record<string, number>;
  volume24h: number;
  timestamp: number;
}

interface Signal {
  action: 'BUY' | 'SELL' | 'CLOSE';
  confidence: number;    // 0-1
  pair: string;
  price?: number;
  metadata: Record<string, unknown>;
}
```

**Plugin lifecycle**: Dynamic loading → Version tracking → Failure isolation → Rollback capability

## Event Pipeline: Signal → Decision → Order

```
1. Signal received (webhook / AI / internal)
2. Signal validated and persisted to SignalEvents container
3. Published to Service Bus topic: signal-events
4. Bot Orchestration matches signal to running bot(s) by pair + exchange
5. Strategy.onSignal() evaluates per strategy rules
6. Strategy returns StrategyAction[] (PLACE_ORDER, etc.)
7. Bot Engine executes actions through Execution Service
8. Orders persisted to Orders container
9. Change feed broadcasts updates to UI via Web PubSub
```

# G) Real-Time UI & APIs

## API Surface

### Bot Management
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/bots` | Create bot |
| GET | `/api/v1/bots` | List user's bots |
| GET | `/api/v1/bots/:id` | Get bot detail |
| PATCH | `/api/v1/bots/:id` | Modify bot config |
| POST | `/api/v1/bots/:id/toggle` | Start/stop bot |
| POST | `/api/v1/bots/:id/add-funds` | Add funds to running bot |
| POST | `/api/v1/bots/kill-switch` | Emergency stop all |
| GET | `/api/v1/bots/:id/performance` | Performance metrics |
| GET | `/api/v1/bots/:id/orders` | Order history (paginated) |

### Exchange Connections
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/exchanges` | Add connection |
| GET | `/api/v1/exchanges` | List connections |
| GET | `/api/v1/exchanges/:id` | Connection detail + health |
| DELETE | `/api/v1/exchanges/:id` | Remove connection |
| POST | `/api/v1/exchanges/:id/test` | Test connection |

### Signals & Metrics
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/signals` | Recent signals |
| GET | `/api/v1/bots/:id/metrics` | Time-series metrics |
| GET | `/api/v1/bots/:id/metrics/summary` | Aggregated summary |

### Authorization
- All endpoints require JWT Bearer token
- Express JWT middleware validates token issuer and expiry
- `tenantId` injected from token claims (never from request body)
- Per-user rate limiting via **Cosmos DB counter documents** (TTL=60s, ~1 RU per check). Works across all Container App replicas. In-memory token bucket is per-instance only and would allow bypass.

## Real-Time Streaming

### Web PubSub Groups
- `user:{userId}:bots` → Bot state changes, performance updates
- `user:{userId}:orders` → Order fills, status changes
- `market:{exchange}:{symbol}` → Live price tickers

### Negotiate Endpoint Tenant Scoping (Security)

The server-side negotiate endpoint (`/api/v1/realtime/negotiate`) MUST restrict group subscriptions per authenticated user:

```typescript
// Next.js API route: /api/v1/realtime/negotiate
const token = await webPubSubService.getClientAccessToken({
  userId: session.userId,
  groups: [
    `user:${session.userId}:bots`,
    `user:${session.userId}:orders`,
  ],
  // Market data groups are shared — no tenant restriction
  // Client can subscribe to market:{exchange}:{symbol} freely
});
```

- The `groups` claim in the access token restricts which groups the client can join
- Client A cannot subscribe to `user:${clientB.userId}:bots` because the token won't authorize it
- **TDD test**: "Client A's negotiate token should not allow subscribing to Client B's bot updates"

### Event Types
| Event | Source | Payload |
|-------|--------|---------|
| `botStateChanged` | Change feed on BotRuns | status, performance summary |
| `orderFilled` | Change feed on Orders | side, price, amount, PnL |
| `priceUpdate` | Market Data service | bid, ask, mid, volume |
| `metricsUpdate` | Metrics processor | PnL, drawdown, win rate |
| `connectionStatus` | Connection monitor | exchange, status, latency |
| `alertTriggered` | Risk engine | type, severity, message |

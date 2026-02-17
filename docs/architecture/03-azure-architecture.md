# C) End-to-End Azure Architecture

## 1) Logical Architecture

```
          +---------------------------------------------------------------+
          |                  Azure Front Door ($35/mo)                    |
          |         WAF (OWASP 3.2) + CDN + TLS 1.3 + DDoS L7           |
          |         Custom Domain: tradingtower.com                       |
          +-------------------------------+-------------------------------+
                                          |
                     +--------------------+--------------------+
                     |                                         |
          +----------v----------+              +---------------v-----------+
          |  Next.js Frontend   |              |  Express API              |
          |  (Container App     |              |  + JWT Middleware          |
          |   Consumption ⚡)   |              |  + TenantContext           |
          |  SSR + NextAuth.js  |              |  (Container App ⚡)       |
          |  Web app reg (conf.)|              |  minReplicas: 0 dev/1 prod|
          +----------+----------+              +---------------+-----------+
                     |                                         |
                     | negotiate               +---------------+----------+
                     v                         v               v          v
          +----------+----------+   +----------+---+ +--------+----+ +---+--------+
          | Azure Web PubSub    |   | Signal       | | Bot         | | Strategy  |
          | (Free tier ⚡)      |   | Ingestion    | | Orchestr.   | | Engine    |
          | 20 conn, 20K msg/d  |   | (Function ⚡)| | (Cont.App ⚡)| | (C.App ⚡)|
          +---------------------+   +------+-------+ +------+------+ +-----+-----+
                                           |                |              |
                                           +--------------+-+--------------+
                                                          |
                                               +----------v----------+
                                               | Execution + Market  |
                                               | Data Service        |
                                               | (Container App ⚡)  |
                                               | minReplicas: 1 prod |
                                               +----------+----------+
                                                          |
                      +-----------------------------------+---------------------+
                      |                    |               |                    |
           +----------v------+  +----------v-------+ +----v----------+        |
           | Cosmos DB       |  | Key Vault        | | Service Bus   |        |
           | Autoscale       |  | per-op ⚡        | | Standard $10  |        |
           | (14 containers) |  | (Secrets)        | | (Commands +   |        |
           | Shared 400 RU/s |  |                  | |  Market Data) |        |
           | + Orders ded.   |  |                  | |               |        |
           | ~$58/mo fixed   |  |                  | |               |        |
           +-----------------+  +------------------+ +---------------+        |
                      |                                                       |
           +----------v-----------+                                           |
           | App Insights + Logs  |      +-------+-------+-------+-------+   |
           | (pay-per-GB ⚡)      |      | Alpaca|Coinbse| Tasty | IBKR  |◄--+
           +----------------------+      |   ⚡  |   ⚡   |  ⚡   |  ⚡   |
                                         +-------+-------+-------+-------+
                                                Exchange APIs

   ⚡ = Consumption/pay-per-use (scales to zero when idle)
```

**Cost-optimized design (personal project):**
- **Compute**: All Container Apps on Consumption plan. Execution + Market Data use `minReplicas: 1` in prod (~$30/mo each) to maintain persistent exchange WebSocket connections. Everything else scales to zero.
- **Azure Front Door** ($35/mo) — always-on. WAF, CDN, TLS 1.3, custom domain, DDoS protection.
- **Web PubSub Free tier** everywhere — 20 connections, 20K msg/day.
- **Cosmos DB Autoscale** ($58/mo fixed) — shared DB 400 RU/s ($29) + Orders dedicated 400 RU/s ($29). Increase max via Bicep param.
- **No Redis** — replay protection and rate limiting use Cosmos DB (TTL documents). In-memory lru-cache for price data.
- **No Event Hubs** — Service Bus handles market data at MVP scale (<100 bots).
- **No NAT Gateway** — deferred until IBKR (if IP whitelisting needed).
- **Fixed-cost baseline** ($155/mo): Front Door $35 + Cosmos Autoscale $58 + Service Bus $10 + Container Registry $5 + Private Endpoints $44 + DNS Zones $3.50. Variable: Container App compute + Functions + telemetry scale with usage.

### Component Responsibilities

| Component | Responsibility |
|-----------|---------------|
| **Next.js Frontend (Container App)** | SSR dashboard, server-side auth (NextAuth.js), Web PubSub negotiate, bot config |
| **JWT Middleware (Express)** | JWT validation, rate limiting, request routing (replaces APIM — $175/mo saved) |
| **Auth Service** | Google + Microsoft OIDC sign-in via Entra External ID, NextAuth.js server-side |
| **Bot Orchestration** | Bot lifecycle (create/start/stop/modify), state machine management, scheduling |
| **Strategy Engine** | Strategy execution logic for all 8 types, parameter validation, grid/DCA calculations |
| **Execution Service** | Order routing to exchanges, fill tracking, idempotent order placement, retry logic |
| **Market Data Ingestion** | WebSocket connections to exchanges, OHLCV aggregation, orderbook snapshots |
| **Signal Ingestion** | TradingView webhook intake, AI/ML signal processing, internal trigger evaluation |
| **Real-Time Service** | WebSocket fan-out of bot state, order updates, market data to UI clients |
| **Cosmos DB** | All persistent state: users, bots, orders, fills, positions, audit logs |
| **Key Vault** | Exchange API keys (encrypted), platform secrets, TLS certificates |
| **Service Bus** | Decoupled async messaging for commands (bot-commands, order-commands, signal-events) |
| ~~Event Hubs~~ | DEFERRED (`enableEventHubs`). Service Bus handles market data at MVP. Add when >1K ticks/sec |
| **Application Insights** | Distributed tracing, metrics, alerts, performance monitoring |

### Canonical Service Inventory (Single Source of Truth)

> **"Next.js + 4 microservices"** = exactly 5 Container Apps + 1 Azure Functions app. This table is the canonical mapping from logical components to deployment units. If any doc contradicts this table, this table wins.

| # | Deployment Unit (Container App) | npm Package | Logical Components Hosted | Owner | Always-On Prod? |
|---|-------------------------------|-------------|--------------------------|-------|:---:|
| 1 | `ca-web` | `@tradetower/web` | Next.js Frontend, NextAuth.js, Web PubSub negotiate, API proxy (Server Actions) | Frontend | Yes (`minReplicas:1`) |
| 2 | `ca-api` | `@tradetower/api` | Express REST API, JWT middleware, Bot Management API, Exchange Connection API, Signal/Metrics API | API | No (scales to zero) |
| 3 | `ca-bot-engine` | `@tradetower/bot-engine` | Bot Orchestration, Strategy Engine, State Machine, Risk Engine | Bot Engine | No (scales to zero) |
| 4 | `ca-execution` | `@tradetower/exchange-connectors` + `@tradetower/market-data` | Execution Service, Market Data Ingestion, Exchange WebSocket connections | Execution | Yes (`minReplicas:1`) |
| 5 | `ca-realtime` | — (thin wrapper) | Change Feed processors (RealtimeUI, MetricsAggregation, AuditCapture), Web PubSub fan-out | Real-Time | Yes (`minReplicas:1`) |

| # | Deployment Unit (Functions) | npm Package | Logical Components Hosted | Owner | Always-On? |
|---|----------------------------|-------------|--------------------------|-------|:---:|
| 6 | `func-signals` | `@tradetower/signal-service` | Signal Ingestion (HTTP trigger), DLQ processor (timer trigger) | Signals | No (Flex Consumption) |

**Key clarifications**:
- **Bot Orchestration + Strategy Engine** are a single Container App (`ca-bot-engine`), not separate services. They share the same process for low-latency strategy evaluation after state machine transitions.
- **Execution Service + Market Data** are combined in `ca-execution` because both maintain persistent exchange WebSocket connections. Separating them would double the connection count and always-on cost.
- **JWT Middleware** is NOT a separate service — it's middleware within `ca-api` (Express).
- **Auth Service** is NOT a separate service — it's NextAuth.js within `ca-web` + Entra External ID (external).
- **Real-Time Service** runs change feed processors and fans out to Web PubSub. It's a separate Container App because change feed processors need continuous execution independent of API request load.

**Container App count**: 5 (exactly: `ca-web` + `ca-api` + `ca-bot-engine` + `ca-execution` + `ca-realtime`)
**Always-on in prod**: 3 (`ca-web`, `ca-execution`, `ca-realtime`) at `minReplicas:1` = ~$75/mo

## 2) Physical Azure Services Mapping

### Compute

| Component | Azure Service | Justification |
|-----------|--------------|---------------|
| Bot Orchestration | Container Apps (Consumption) | Per-user scaling, Dapr sidecar, KEDA autoscaling |
| Strategy Engine | Container Apps (Consumption) | CPU-bound calculations, scales independently |
| Execution Service | Container Apps (**Consumption, `minReplicas: 1` prod**) | Low-latency order routing, persistent WS. Always-on in prod to avoid cold-start order delays |
| Market Data Ingestion | Container Apps (**Consumption, `minReplicas: 1` prod**) | Long-lived WS connections. Always-on in prod to avoid market data gaps |
| Signal Ingestion | Azure Functions (Flex Consumption) | HTTP-triggered, event-driven, pay-per-execution |
| **Next.js Frontend** | **Container Apps (Consumption)** | SSR, WebSocket, scales to zero. `output: 'standalone'` |

### Authentication

**Recommended: Microsoft Entra External ID**

| Config | Value |
|--------|-------|
| Tenant type | External |
| Identity providers | Google OIDC + Microsoft Account + Microsoft Entra ID |
| User flows | Sign-up/sign-in with email verification, self-service password reset |
| Token config | Custom claims for `tenantId`, `subscription_tier` |
| API protection | Express JWT middleware validates tokens (no APIM). NextAuth.js handles server-side session |

### Messaging

| Component | Dev SKU | Prod SKU | Configuration |
|-----------|---------|----------|---------------|
| Commands + Market Data | Service Bus **Standard ($10/mo)** | **Standard ($10/mo)** | Topics: `bot-commands`, `order-commands`, `signal-events`, `market-data`. Upgrade to Premium ($677) only at >50 concurrent bots (scale trigger) |
| ~~Market data~~ | ~~Event Hubs~~ DEFERRED | — | Service Bus topic `market-data` handles MVP scale. Enable Event Hubs (`enableEventHubs`) when >1K ticks/sec |
| Change feed | Cosmos DB Change Feed | Same | Order fills, state transitions → audit + real-time UI |

#### Service Bus Tenant Isolation (Mandatory)

All Service Bus topic subscriptions MUST include a `tenantId` correlation filter. Each subscriber receives only messages for its tenant. This extends the 3-layer tenant isolation (Cosmos partition keys + middleware + CI tests) to the messaging layer.

```
Topic: bot-commands
  Subscription: bot-orchestration
  Correlation Filter: tenantId = '{message.tenantId}'

Topic: order-commands
  Subscription: execution-service
  Correlation Filter: tenantId = '{message.tenantId}'

Topic: signal-events
  Subscription: strategy-engine
  Correlation Filter: tenantId = '{message.tenantId}'

Topic: market-data
  Subscription: market-data-fanout
  No tenant filter (market data is shared across all tenants)
```

**Message ordering within a single bot**: Use `sessionId = botId` on the subscription. Service Bus Standard supports sessions on **subscriptions** (not just queues). This ensures all commands for a single bot are processed in order by a single consumer instance, preventing state corruption from concurrent processing.

#### Dead-Letter Queue (DLQ) Processing Strategy

Messages failing `maxDeliveryCount` (10 attempts) are automatically moved to the DLQ. Without a consumer, dead-lettered `order-commands` messages = orders never placed despite strategy requesting them.

**DLQ Processor** (Azure Function, timer-triggered every 5 minutes):
```
For each topic subscription DLQ:
  1. Peek up to 50 messages
  2. For each message:
     a. Log: reason, original enqueueTime, topic, subscription, deliveryCount
     b. Increment App Insights custom metric: dlq_message_count{topic, subscription}
     c. Attempt 1 retry (re-enqueue to original topic with dlq_retry=true header)
     d. If retry fails: persist to FailedMessages Cosmos container (PK: /tenantId, TTL: 30 days)
     e. Complete (remove from DLQ)
  3. If DLQ depth > 10 messages on any subscription: trigger Sev2 alert
```

**FailedMessages container** (Cosmos DB, shared throughput):
```typescript
interface FailedMessage {
  id: string;
  tenantId: string;        // partition key
  topic: string;
  subscription: string;
  originalEnqueueTime: string;
  deadLetterReason: string;
  deadLetterErrorDescription: string;
  messageBody: Record<string, unknown>;
  retryAttempted: boolean;
  retryResult: 'SUCCESS' | 'FAILED';
  processedAt: string;
  _ttl: number;            // 30 days
}
```

> **Why not just alert?** A DLQ'd `order-commands` message is a financial safety issue — the strategy engine decided to place an order, but it was never executed. The retry + persist strategy ensures traceability and enables manual remediation.

### Real-Time

**Azure Web PubSub — Free tier for all environments (personal project)**
- Free: 20 concurrent connections, 20,000 messages/day
- Groups: `user:{userId}:bots`, `user:{userId}:orders`, `market:{exchange}:{symbol}`
- Upgrade to Standard ($49/mo) when >20 concurrent users

**Traffic model** (will Free tier suffice?):
| Source | Messages/day estimate (1 user, 5 bots, 2 pairs) |
|--------|:---:|
| Price ticks (5s interval, 2 pairs, 16h/day) | ~23,000 |
| Order fills (~20/day) | ~20 |
| Bot state changes (~50/day) | ~50 |
| **Total** | **~23,070** |

> **Verdict**: Free tier (20K msg/day) will be exceeded with 2+ active pairs at 5s tick intervals. **Mitigation**: Throttle price ticks to 15s intervals in Web PubSub (reduces to ~7,700 msg/day). Raw 5s ticks are still available to the Strategy Engine via direct Service Bus subscription. **Auto-upgrade trigger**: if >3 consecutive days hit 90% of 20K limit, alert to upgrade to Standard.

**UX Impact Acceptance (15s Throttle)**:

| Environment | UI Price Update Interval | Strategy Engine Interval | Accepted UX Trade-off | SLA |
|-------------|:---:|:---:|------------------------|----|
| **Dev** | 15s | 5s (direct Service Bus) | Prices update every 15s in browser. Acceptable for development — no financial decisions made from UI. | None |
| **Prod (Free tier)** | 15s | 5s (direct Service Bus) | Dashboard price tickers lag by up to 15s vs exchange. Bot detail page shows "last updated Xs ago" indicator. **Explicitly accepted**: UI is for monitoring, not for placing manual trades. All trading decisions are made by the Strategy Engine at full 5s resolution. | UI latency ≤ 15s for price, ≤ 2s for order fills and bot state |
| **Prod (Standard, >3 users)** | 5s | 5s | Full-resolution UI. Upgrade triggered by auto-alert. | UI latency ≤ 5s for price, ≤ 2s for fills |

**What the user sees** (15s throttle):
- Price chart updates every 15s (smooth — TradingView Lightweight Charts interpolates between ticks)
- PnL counter animates smoothly between 15s snapshots (Framer Motion number spring)
- Order fills appear within 2s (NOT throttled — order events bypass price throttle)
- Bot state changes appear within 2s (NOT throttled)
- "Last price update: 12s ago" indicator in header (subtle, not alarming)

### Storage

| Store | Service | Purpose |
|-------|---------|---------|
| Primary datastore | Cosmos DB **Autoscale** (all envs), **Session consistency** | 14 containers (12 data + Leases + FailedMessages). Shared DB 400 RU/s ($29) + Orders dedicated ($29) = ~$58/mo. Session consistency for read-your-writes at zero extra RU cost |
| Blob storage | Azure Blob Storage (Hot LRS) | Backtest data, exports |
| Cache | In-memory (lru-cache in Container Apps) | No Redis at launch. Add via `enableRedis=true` when needed |

### Security

| Service | All Envs | Purpose |
|---------|----------|---------|
| Key Vault Standard | ~$0 (pay per op) | Exchange API keys, platform secrets |
| Managed Identities | Same | Same | System-assigned per service. RBAC everywhere. Zero connection strings. |

### Monitoring

| Service | Role |
|---------|------|
| Application Insights | Distributed tracing, custom metrics, smart detection |
| Log Analytics Workspace | Centralized logs from all services |
| Azure Monitor Alerts | Order latency >500ms, bot failure >1%, Cosmos RU >80% |

## Network Topology

```
+-----------------------------------------------------------------------+
|  VNet: vnet-tradingtower-{env}   Address Space: 10.0.0.0/16           |
|                                                                       |
|  +-------------------------------------------------------------+      |
|  | snet-container-apps    10.0.0.0/21  (2048 IPs)              |      |
|  | Delegated to: Microsoft.App/environments                    |      |
|  | All Container Apps microservices                            |      |
|  +-------------------------------------------------------------+      |
|                                                                       |
|  +-------------------------------------------------------------+      |
|  | snet-functions         10.0.8.0/24  (256 IPs)               |      |
|  | Azure Functions (Signal Ingestion) - VNet integrated        |      |
|  +-------------------------------------------------------------+      |
|                                                                       |
|  +-------------------------------------------------------------+      |
|  | snet-reserved          10.0.9.0/24  (256 IPs)               |      |
|  | Reserved for future services (Front Door, etc.)             |      |
|  +-------------------------------------------------------------+      |
|                                                                       |
|  +-------------------------------------------------------------+      |
|  | snet-private-endpoints 10.0.10.0/24 (256 IPs)               |      |
|  | Private Endpoints: Cosmos DB, Key Vault, Service Bus,       |      |
|  |   Web PubSub, Storage Account (+ Event Hubs, Redis when enabled)|    |
|  +-------------------------------------------------------------+      |
|                                                                       |
|  +-------------------------------------------------------------+      |
|  | snet-reserved2          10.0.11.0/24  (256 IPs)             |      |
|  | Reserved (Redis when enableRedis=true)                     |      |
|  +-------------------------------------------------------------+      |
+-----------------------------------------------------------------------+
```

### Private Endpoints

| Service | Private Endpoint | DNS Zone |
|---------|-----------------|----------|
| Cosmos DB | pe-cosmos-tradingtower | privatelink.documents.azure.com |
| Key Vault | pe-kv-tradingtower | privatelink.vaultcore.azure.net |
| Service Bus | pe-sb-tradingtower | privatelink.servicebus.windows.net |
| Event Hubs (when enabled) | pe-eh-tradingtower | privatelink.servicebus.windows.net |
| Web PubSub | pe-wps-tradingtower | privatelink.webpubsub.azure.com |
| Storage Account | pe-st-tradingtower | privatelink.blob.core.windows.net |
| Redis Cache | pe-redis-tradingtower | privatelink.redis.cache.windows.net |

### Outbound Controls

**NAT Gateway** on `snet-container-apps` for fixed egress IPs (exchange IP whitelisting).

**Outbound control approach** (no Azure Firewall — $912/mo saved):

> **Technical note**: NSGs operate at IP/port level, NOT FQDN. FQDN-based filtering requires Azure Firewall ($912/mo) or a third-party NVA. For a personal project, we accept the trade-off.

- **NSG rules**: Allow outbound HTTPS (port 443) to `Internet` service tag. Block all other outbound ports.
- **Application-level allowlist**: The `BaseConnector` class validates that outbound connections target only configured exchange hostnames. Connections to unknown hosts are rejected in code.
- **Exchange hostnames** (enforced in application, not at network level):
  - `api.coinbase.com`, `advanced-trade-ws.coinbase.com`
  - `api.alpaca.markets`, `stream.data.alpaca.markets`
  - `api.ibkr.com`, `localhost:7496/7497` (TWS)
  - `api.tastyworks.com`, `tasty-openapi-ws.dxfeed.com`
- **Future**: Add Azure Firewall ($912/mo) when compliance requires network-level FQDN filtering.

## Service Inventory (Canonical)

**Design principle**: Minimize fixed costs. Use consumption/pay-per-use where possible. Accept fixed costs only for Cosmos Autoscale ($58), Service Bus Standard ($10), Container Registry ($5), and Front Door in prod ($35). Variable compute scales to zero in dev.

| # | Service | Model | Dev Cost | Prod Launch Cost | Role |
|---|---------|:-----:|:--------:|:----------------:|------|
| 1 | **Container Apps** (Next.js + 4 microservices) | **Consumption** | ~$0 idle (dev) | ~$75 (prod: 3 apps `minReplicas:1`) | Dev scales to zero. Prod: Next.js + Execution + Market Data always-on for latency/WS |
| 2 | **Azure Functions** | **Serverless** (Flex Consumption) | ~$0 idle | ~$2-5 | Signal ingestion, change feed processors |
| 3 | **Cosmos DB** | **Autoscale**, Session consistency | ~$58/mo | ~$58/mo | 14 containers. Shared DB 400 RU/s ($29) + Orders dedicated 400 RU/s ($29). Session consistency for read-your-writes |
| 4 | **Entra External ID** | **Free** | $0 | $0 | Free <50K MAU |
| 5 | **Key Vault** | **Serverless** (pay per operation) | ~$0 | ~$1 | $0.03/10K operations |
| 6 | **Blob Storage** | **Serverless** (pay per GB) | ~$0 | ~$1-5 | Backtest data, exports |
| 7 | **App Insights + Log Analytics** | **Serverless** (pay per GB ingested) | ~$0 (5GB free) | ~$5-20 | Telemetry, tracing |
| 8 | **Container Registry** | Fixed | $5 (Basic) | $5 | Unavoidable — need to store images |
| 9 | **Web PubSub** | **Free tier (all envs)** | $0 | $0 | Free: 20 concurrent, 20K msg/day. Upgrade to Standard ($49) when >20 concurrent users |
| 10 | **Service Bus** | Fixed (Standard) | $10 | $10 | No serverless option. Standard is cheapest ($10/mo) |
| | | | | | |
| | **Eliminated Services** | | | | |
| ~~11~~ | ~~Event Hubs~~ | **Eliminated** | -$22 saved | -$22 saved | Use Service Bus topics for market data at MVP scale. Add Event Hubs later if >1K ticks/sec |
| ~~12~~ | ~~Redis~~ | **Eliminated** | -$40 saved | -$40 saved | Use in-memory Map/LRU in Container Apps + Cosmos DB for rate limiting. Add Redis when >50 concurrent users |
| ~~13~~ | ~~NAT Gateway~~ | **Deferred** | -$32 saved | -$32 saved | Only needed for exchange IP whitelisting. Alpaca/Coinbase don't require it. Add when IBKR demands it |
| 14 | **Azure Front Door** | **Standard** | **$35/mo** | **$35/mo** | WAF (OWASP 3.2), CDN, TLS 1.3, custom domain, DDoS. Always on. |
| ~~15~~ | ~~App Service~~ | **Replaced** | -$13 saved | -$13 saved | Next.js runs on Container Apps Consumption instead (scales to zero) |

### Why These Eliminations Are Safe

| Eliminated | Replaced By | When to Add Back |
|-----------|-------------|-----------------|
| **Event Hubs** | Service Bus topics (same API pattern). Market data volume at <100 bots is <100 msg/sec — well within Service Bus Standard capacity | When market data exceeds 1K ticks/sec or >4 exchanges streaming simultaneously |
| **Redis** | In-memory `Map`/`lru-cache` in Container Apps for price cache. Cosmos DB for rate limiting counters (1 RU per read). Session managed by NextAuth.js in httpOnly cookie (no server-side session store needed) | When >50 concurrent users (memory pressure) or need distributed rate limiting across replicas |
| **NAT Gateway** | Container Apps uses Azure-assigned outbound IPs (dynamic). Alpaca and Coinbase don't require IP whitelisting | When IBKR connector needs fixed IPs (Weeks 16-19) |
| ~~Front Door~~ | **Always on** ($35/mo). WAF + CDN + DDoS for a financial platform is non-negotiable | N/A — always deployed |
| **App Service** | Next.js on Container Apps Consumption — same SSR capability, scales to zero, $0 when idle vs $13/mo fixed | Never — Container Apps is strictly better for serverless Next.js |

### Next.js on Container Apps (Key Detail)

Next.js with `output: 'standalone'` produces a self-contained Node.js server that runs perfectly on Container Apps:

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY .next/standalone ./
COPY .next/static ./.next/static
COPY public ./public
EXPOSE 3000
CMD ["node", "server.js"]
```

Container Apps Consumption plan:
- Scales to zero when no requests (evenings, weekends) → **$0 when idle**
- Scales up on demand (first request has ~2s cold start, subsequent are instant)
- Supports custom domains, TLS, WebSockets
- `minReplicas: 1` in prod to eliminate cold starts (costs ~$15/mo)

## Canonical Cost Breakdown (Single Source of Truth)

| Service | Dev (idle) | Dev (active) | Prod (personal) | Prod Scale (>20 users) |
|---------|:---------:|:------------:|:---------------:|:---------------------:|
| Container Apps (5 apps) | $0 | ~$10 | ~$75 (Exec+MktData minReplicas:1 ~$60 + Next.js minReplicas:1 ~$15) | ~$150 |
| Azure Functions | $0 | ~$1 | ~$3 | ~$10 |
| Cosmos DB Autoscale | $58 | $58 | $58 | $58 (increase max RU/s if needed) |
| Entra External ID | $0 | $0 | $0 | $0 |
| Key Vault | $0 | ~$0.50 | ~$1 | ~$2 |
| Blob Storage | $0 | ~$0.50 | ~$1 | ~$5 |
| App Insights | $0 | ~$0 (5GB free) | ~$5 | ~$30 |
| Container Registry | $5 | $5 | $5 | $5 |
| Web PubSub | $0 (Free) | $0 (Free) | $0 (Free) | $49 (Standard) |
| Service Bus Standard | $10 | $10 | $10 | $10 |
| **Front Door** | $0 (off in dev) | $0 (off) | **$35** (mandatory prod) | **$35** |
| **Private Endpoints (6)** | **~$44** | **~$44** | **~$44** | **~$44** |
| **DNS Private Zones (7)** | **~$3.50** | **~$3.50** | **~$3.50** | **~$3.50** |
| Cosmos DB continuous backup | $0 | $0 | ~$2-5 | ~$5-10 |
| **TOTAL** | **~$120** | **~$143** | **~$262** | **~$510+** |

> **Private Endpoint costs**: ~$7.30/mo each for Cosmos DB, Key Vault, Service Bus, Web PubSub, Storage Account, Container Registry = ~$44/mo. These are always-on regardless of environment. DNS Private Zones cost $0.50/mo each for 7 zones (Cosmos, Key Vault, Service Bus, Web PubSub, Storage, Event Hubs when enabled, Redis when enabled).

### Dev vs Prod — What's Actually Different?

In the serverless-first architecture, **dev and prod run the same code on the same services**. The only differences are configuration values in the Bicep parameter files:

| Service | Dev | Prod | Why Different |
|---------|-----|------|---------------|
| **Web PubSub** | Free tier ($0) | Free tier ($0) | Both Free (20 connections, 20K msg/day). Upgrade to Standard ($49) when >20 concurrent users |
| **Container Apps minReplicas** | All 0 (scales to zero) | 1 for Next.js + Execution + Market Data (~$75/mo) | Dev: cold starts OK. Prod: instant page load + persistent exchange WS connections |
| **Cosmos DB continuous backup** | Disabled | Enabled | Dev: data is disposable. Prod: 7-year retention, point-in-time restore |
| **Key Vault purge protection** | Disabled | Enabled (90-day) | Dev: allow fast delete/recreate. Prod: prevent accidental secret loss |
| **Front Door** | OFF ($0) | Standard ($35) | Dev: Container Apps free TLS. Prod: WAF mandatory for financial platform |
| **App Insights sampling** | 100% (all telemetry) | Adaptive 50% | Dev: see every request for debugging. Prod: reduce ingestion cost |
| **Exchange API keys** | Paper/sandbox credentials | Live production credentials | Dev: testnet orders. Prod: real money |
| **Custom domain** | `dev.tradingtower.com` | `tradingtower.com` | Standard DNS routing |

**Everything else is identical**: same Container Apps Consumption plan, same Cosmos DB Autoscale ($58/mo), same Service Bus Standard ($10/mo), same Key Vault Standard, same Functions Flex Consumption, same Web PubSub Free tier, same Private Endpoints ($44/mo), same DNS zones ($3.50/mo). Only differences: Front Door (prod only, $35), `minReplicas` (prod only, ~$75), and Cosmos continuous backup (prod only, ~$2-5).

This means:
- A bug fixed in dev behaves identically in prod (same runtime, same services)
- No "works in dev but not prod" surprises from different service tiers
- Promotion from dev → prod is just changing the Bicep param file

### Scale-Up Triggers (When to Add Optional Services)

These are enabled via Bicep feature flags (`enableX=true`) — no code changes, just redeploy:

| Trigger | Add Service | Cost Impact |
|---------|-------------|:-----------:|
| >20 concurrent users | Web PubSub Standard (`webPubSubSku='Standard'`) | +$49/mo |
| >50 concurrent users | Redis Standard C2 (`enableRedis=true`) | +$100/mo |
| Market data bottleneck (see triggers below) | Event Hubs Standard 4TU (`enableEventHubs=true`) | +$89/mo |
| IBKR connector (Week 16-19) | NAT Gateway (`enableNatGateway=true`) | +$32/mo |
| >50 concurrent bots | Service Bus Premium (change SKU param) | +$667/mo |
| >100 concurrent bots | Cosmos DB Autoscale (new account + data migration) | +$145+/mo |
| >200 concurrent bots | Container Apps Dedicated D4 (add workload profile) | +$300/mo |

### Service Bus → Event Hubs Cutover Criteria

Service Bus Standard handles market data at MVP scale. Switch to Event Hubs when **any** of these measurable thresholds are breached consistently over a 1-hour window:

| Metric | Threshold | How to Measure | Why It Matters |
|--------|:---------:|----------------|----------------|
| **p95 message delivery latency** | >500ms | Service Bus metrics in Azure Monitor | Delayed ticks mean stale prices for strategy decisions |
| **Active message queue depth** | >1,000 messages sustained | Service Bus queue metrics | Backlog means market data consumer can't keep up |
| **Dead-letter queue (DLQ) rate** | >0.1% of messages | DLQ count / total messages | Messages are being dropped or failing processing |
| **Incoming message rate** | >500 msg/sec sustained | Service Bus throughput metric | Approaching Service Bus Standard single-topic limits |
| **Number of active exchange streams** | >4 concurrent | Application metric | More streams = more fanout = more message volume |

**Action**: When triggered, set `enableEventHubs=true` in Bicep params and redeploy. Market data topics migrate to Event Hubs partitioned by `exchange:symbol`. Service Bus continues to handle commands only.

### Cost Guardrails (Azure Budget Alarms)

Deploy these via Bicep `alerts.bicep` module:

| Alert | Threshold | Action |
|-------|:---------:|--------|
| **Monthly budget alarm (dev)** | $100/mo | Email notification. Investigate unexpected compute or Cosmos RU spike |
| **Monthly budget alarm (prod)** | $250/mo | Email notification. Review scale trigger dashboard |
| **Cosmos RU consumption** | >80% of autoscale max sustained 1h | Email + Teams. Consider increasing max RU/s |
| **Web PubSub message count** | >18,000/day (90% of Free 20K) | Email. Evaluate upgrading to Standard or increasing tick throttle |
| **Log Analytics daily ingestion** | >5 GB/day | Email. Increase adaptive sampling or add retention cap |
| **Container Apps vCPU-hours** | >500 vCPU-hours/month | Email. Review if bots are scaling unexpectedly |

**Operational costs not in baseline** (variable, usage-dependent):
| Cost | Dev Estimate | Prod Estimate | Notes |
|------|:-----------:|:------------:|-------|
| Network egress | ~$0 | ~$1-5/mo | First 100 GB/mo free across all services |
| Log Analytics ingestion | ~$0 | ~$5-15/mo | 5 GB/mo free. Set daily cap at 2 GB. Adaptive sampling 50% in prod |
| Log Analytics retention beyond 31 days | ~$0 | ~$2-5/mo | $0.10/GB/mo for 31-90 day retention. Archive older to Blob ($0.01/GB) |
| Front Door WAF rule tuning | $0 | ~$0 | Custom rules included in Standard. No per-rule cost |
| Front Door request processing | $0 | ~$1-3/mo | <1M requests/mo: effectively free beyond $35 base |
| Key Vault operations | ~$0 | ~$1-2/mo | $0.03/10K transactions. ~50K ops/mo at scale |
| Cosmos DB continuous backup | ~$0 | ~$1-3/mo | $0.20/GB/mo for backup storage. <15 GB at personal scale |
| Web PubSub upgrade pressure | $0 | **$0 or $49** | Free with 15s throttle. Standard ($49) if throttle insufficient or >3 users |
| **Total operational overhead** | **~$0** | **~$10-30/mo** | On top of fixed baseline |

**FinOps monthly checklist** (manual, 15 min/month):
1. Check Azure Cost Management for unexpected spikes
2. Review budget alarm triggers (did any fire?)
3. Verify Log Analytics daily ingestion stays under 2 GB cap
4. Check Web PubSub message count vs 20K/day limit
5. Review Cosmos RU consumption — is autoscale ceiling being hit?

## Bicep Module Structure (TDD-Validated)

Each module follows **Bicep TDD**: define expected resources → write module → `az deployment group validate --what-if` → assert in CI.

```
infra/
  main.bicep                    # Orchestrates all modules, conditional feature flags
  environments/
    dev.bicepparam              # Autoscale Cosmos, Web PubSub Free, no Front Door/Redis/EventHubs/NAT
    staging.bicepparam          # Same as dev (Web PubSub Free, no Front Door)
    prod.bicepparam             # Autoscale Cosmos + Front Door + Standard SB. Feature flags for Redis/EventHubs/NAT
  modules/
    network/
      vnet.bicep                # VNet + 4 subnets + NSGs (no APIM subnet)
      nat-gateway.bicep         # OPTIONAL: deploy only when enableNatGateway=true (IBKR)
      private-dns.bicep         # DNS zones for enabled services
    identity/
      managed-identities.bicep  # 1 per service
      role-assignments.bicep    # RBAC for Key Vault, Cosmos, Service Bus
    compute/
      container-apps-env.bicep  # Environment
      container-apps.bicep      # 5 apps (Next.js + 4 microservices), ALL Consumption
      functions.bicep            # Signal ingestion + change feed processors
    data/
      cosmos-account.bicep      # Autoscale (shared DB 400 RU/s + dedicated for Orders)
      cosmos-database.bicep     # 14 containers + hierarchical partition keys + Session consistency
      storage-account.bicep     # Blob storage for backtest data
      redis.bicep               # OPTIONAL: deploy only when enableRedis=true
    messaging/
      service-bus.bicep         # Standard ($10/mo fixed)
      event-hubs.bicep          # OPTIONAL: deploy only when enableEventHubs=true
      web-pubsub.bicep          # Free tier all envs (upgrade via sku param when >20 users)
    security/
      key-vault.bicep           # Standard
      private-endpoints.bicep   # PE for Cosmos, Key Vault, Service Bus
    gateway/
      front-door.bicep          # Mandatory in prod. Optional in dev (enableFrontDoor param)
    monitoring/
      log-analytics.bicep       # Centralized logs
      app-insights.bicep        # APM (pay per GB)
      alerts.bicep              # Sev1-4 alert rules
```

**Feature flags in Bicep** (`main.bicep` parameters):
```bicep
@description('Enable Redis when >50 concurrent users')
param enableRedis bool = false

@description('Enable Event Hubs when >1K ticks/sec')
param enableEventHubs bool = false

@description('Enable NAT Gateway when IBKR connector needs fixed IPs')
param enableNatGateway bool = false

@description('Enable Front Door WAF + CDN ($35/mo) when facing public traffic')
@description('Enable Front Door WAF+CDN. OFF in dev, ON in prod.')
param enableFrontDoor bool  // dev.bicepparam=false, prod.bicepparam=true
```

Dev/staging/prod param files set these to `false` by default. Flip individually when scale demands it — no code changes, just redeploy with updated param.

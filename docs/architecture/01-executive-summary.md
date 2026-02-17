# TradingTower Architecture Plan

## A) Executive Summary

**TradingTower** is a multi-tenant trading bot platform on Microsoft Azure enabling users to authenticate, connect broker/exchange accounts, configure and run automated trading bots across multiple asset classes (stocks, futures, forex, crypto), monitor live/historical performance, backtest strategies, and modify/stop bots safely.

### Architecture Approach

**Serverless-first with always-on essentials.** All compute on **Azure Container Apps Consumption** (dev scales to zero; prod: 3 apps always-on for WS/latency). **Azure Functions** for event-driven signal ingestion. **Next.js SSR** on Container Apps alongside 4 microservices. State in **Cosmos DB Autoscale** ($58/mo fixed). Messaging via **Service Bus Standard** ($10/mo fixed). **Front Door** mandatory in prod ($35/mo) for WAF/CDN, optional in dev. Real-time via **Web PubSub Free tier**. Redis, Event Hubs, NAT Gateway added via Bicep feature flags when scale demands.

### Major Components

| Component | Azure Service | Role |
|-----------|--------------|------|
| **Next.js Frontend** | Container Apps (Consumption, `minReplicas: 1` prod) | SSR dashboard, server-side auth, Web PubSub negotiate |
| **Auth** | Microsoft Entra External ID (Free) | Google + Microsoft OIDC, NextAuth.js server-side |
| **API Gateway** | **None (removed)** — JWT middleware in Express | $175/mo saved vs APIM |
| **Bot Orchestration** | Container Apps (Consumption) | Bot lifecycle, state machine |
| **Strategy Engine** | Container Apps (Consumption) | 8 strategy implementations |
| **Execution Service** | Container Apps (Consumption, `minReplicas: 1` prod) | Order routing, fill tracking. Always-on for persistent exchange WS |
| **Market Data** | Container Apps (Consumption, `minReplicas: 1` prod) | Persistent WS to exchanges. Always-on to avoid data gaps |
| **Signal Ingestion** | Azure Functions (Flex Consumption) | Webhook intake |
| **Real-Time** | Azure Web PubSub (**Free tier**) | Live bot state + market data to UI. Upgrade to Standard when >20 users |
| **Datastore** | Cosmos DB (**Autoscale**, ~$58/mo, **Session** consistency) | 14 containers, hierarchical partition keys. Shared 400 RU/s + Orders dedicated |
| **Secrets** | Key Vault (Standard, pay per op) | Exchange API keys, platform secrets |
| **Commands + Market Data** | Service Bus (Standard $10/mo) | 4 topics: `bot-commands`, `order-commands`, `signal-events`, `market-data` |
| ~~Streams~~ | ~~Event Hubs~~ (deferred) | Add via Bicep flag when >1K ticks/sec |
| ~~Cache~~ | ~~Redis~~ (deferred) | In-memory cache at MVP. Add via Bicep flag when >50 users |
| **CDN/WAF** | **Azure Front Door Standard ($35/mo)** | WAF (OWASP 3.2), CDN, TLS 1.3, custom domain, DDoS. Always on |
| **Monitoring** | Application Insights + Log Analytics | Tracing, alerts (Sev1-4) |
| **IaC** | Bicep (modular, TDD-validated) | 12 modules, 3 env param files |

### Key Architecture Decisions

1. **Cost-optimized with always-on essentials** — All Container Apps Consumption. Dev scales to zero (~$120/mo fixed baseline incl. Private Endpoints). Prod: 3 apps `minReplicas: 1` (~$75) + Front Door ($35). Cosmos Autoscale ($58/mo fixed). No Redis/Event Hubs/NAT at MVP — add via feature flags.
2. **No APIM** — JWT validation in Express middleware. $175/mo saved.
3. **Bicep feature flags** — Redis, Event Hubs, NAT Gateway deployed only when `enableX=true`. No code changes to scale up.
4. **Hierarchical partition keys** — Sensitive containers use `/tenantId/...` prefix (e.g., BotRuns: `/tenantId/botDefinitionId`). Cross-tenant reads structurally impossible at Cosmos level.
5. **Interface freeze via ADR** — IStrategy and IExchangeConnector frozen before strategy implementation begins.
6. **Bicep TDD** — All modules validated via `az deployment group validate --what-if` in CI.

### Tech Stack

- **Language**: TypeScript (strict, ES2022)
- **Runtime**: Node.js 20 LTS
- **Frontend**: Next.js 14 (App Router) + Tailwind CSS + shadcn/ui + TradingView Lightweight Charts + Recharts
- **Auth**: NextAuth.js (server-side) + Entra External ID
- **API**: Express.js with JWT middleware
- **Build**: npm workspaces + Turborepo
- **Testing**: Jest (TDD, **~1,120 tests** planned — authoritative count from `09-tdd-strategy.md`) + Playwright (E2E)
- **IaC**: Bicep (TDD-validated)

### Estimated Monthly Costs (Canonical)

| Environment | Cost | Notes |
|-------------|------|-------|
| **Dev (idle)** | **~$120** | Cosmos ($58) + Service Bus ($10) + CR ($5) + Private Endpoints ($44) + DNS Zones ($3.50). No Front Door in dev. |
| **Dev (active)** | **~$143** | Above + Container App vCPU-seconds when testing |
| **Prod (personal)** | **~$262** | Dev baseline + Front Door ($35) + 3 Container Apps `minReplicas:1` (~$75) + Cosmos backup ($2-5) |
| **Prod (>20 users)** | **~$510+** | Add Web PubSub Standard ($49), Redis, Event Hubs, NAT Gateway via Bicep flags |

**Fixed-cost breakdown**:
| Component | Dev | Prod | Type |
|-----------|:---:|:----:|------|
| Cosmos Autoscale | $58 | $58 | Fixed (400 RU/s shared + Orders dedicated) |
| Front Door | $0 (off) | $35 | Fixed in prod. Optional in dev (`enableFrontDoor`) |
| Service Bus | $10 | $10 | Fixed |
| Container Registry | $5 | $5 | Fixed |
| Private Endpoints (6) | ~$44 | ~$44 | Fixed (~$7.30 each: Cosmos, KV, SB, WPS, Storage, ACR) |
| DNS Private Zones (7) | ~$3.50 | ~$3.50 | Fixed ($0.50 each) |
| Container Apps (3 apps minReplicas:1) | $0 | ~$75 | Fixed in prod (always-on for WS/latency) |
| Cosmos continuous backup | $0 | ~$2-5 | Prod only (30d retention) |
| **Fixed subtotal** | **~$120** | **~$262** | |
| Variable (compute, functions, telemetry) | ~$0-23 | ~$30+ | Scales with usage |

### Exchanges/Brokers

| Priority | Exchange | Assets | Build Order |
|:---:|----------|--------|:-----------:|
| 1 | **Alpaca** | US stocks, ETFs, crypto | Weeks 6-9 |
| 2 | **Coinbase** | Crypto spot + futures | Weeks 9-11 |
| 3 | **Tasty Trade** | Futures, options, stocks, crypto | Weeks 30-35 |
| 4 | **IBKR** | Global multi-asset (Gateway primary) | Weeks 40-49 |

### Timeline

**~65 weeks** solo developer. 11 Epics (+ Epic 0 dependency gates), ~80 tasks, **~1,120 TDD tests**. All 4 brokers in MVP. TDD-rigorous pacing (~3 wk/strategy). MVP-1 deliverable at Week 30. M6b/M7b serialized (no risky overlap). 3-week buffer.

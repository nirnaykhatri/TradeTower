# J) Implementation Plan

> **TDD Policy**: Every task follows the Universal TDD Task Template from `09-tdd-strategy.md`. No production code without companion tests. CI blocks PRs that change production files without test files. See `09-tdd-strategy.md` for Application, IaC, Connector, and Frontend templates.

## Project Structure (npm Workspaces Monorepo)

```
tradetower/
├── .github/workflows/           # CI/CD pipelines
├── packages/
│   ├── shared/                  # @tradetower/shared - types, constants, utils
│   ├── api/                     # @tradetower/api - Express REST API + JWT middleware
│   ├── bot-engine/              # @tradetower/bot-engine - strategy framework
│   ├── exchange-connectors/     # @tradetower/exchange-connectors - exchange adapters
│   ├── signal-service/          # @tradetower/signal-service - webhook + signals
│   ├── market-data/             # @tradetower/market-data - price ingestion
│   ├── data-access/             # @tradetower/data-access - Cosmos repositories
│   ├── web/                     # @tradetower/web - Next.js (App Router, SSR, NextAuth.js)
│   └── infrastructure/          # @tradetower/infrastructure - Bicep modules (TDD-validated)
├── package.json                 # Workspace root + Turborepo
├── tsconfig.base.json           # Strict TS base config
├── turbo.json                   # Build pipeline
└── jest.config.ts               # Root test config
```

## Epics & Milestones

### EPIC 0: Dependency Gates (Week 1 — Before Any Code)

| Task | Description | Go/No-Go | Fallback |
|------|-------------|----------|----------|
| 0.1 | **IBKR OAuth application** — email `api@interactivebrokers.com`. Design `IBKRAuthStrategy` interface with `GatewayAuth` + `OAuthAuth` impls | Email sent + fallback designed by end of Week 1 | Gateway fallback ready from Day 1 |
| 0.2 | **Entra External ID tenant** — create External tenant, test Google sign-in | Working sign-in by end of Week 2 | Pivot to Auth0 free tier (~1 week cost) |
| 0.3 | **Alpaca paper access** — create API key, place test order via REST | Test order succeeds by Week 3 | Start with Coinbase sandbox instead |
| 0.4 | **Coinbase sandbox access** — create CDP key pair, test order | Test order succeeds by Week 4 | Use recorded fixtures; defer live sandbox |
| 0.5 | **Tasty Trade cert env** — apply for cert account, verify session auth | Access confirmed by Week 16 | Build against recorded fixtures |
| 0.6 | **IBKR OAuth checkpoint** — check approval status | Week 12: approved or not | Proceed with Gateway fallback |
| 0.7 | **IBKR paper account** — verify TWS login + paper order | Access confirmed by Week 18 | Use recorded fixtures |

> **Rule**: No connector task starts until its corresponding gate passes. If gate fails, fallback activates automatically. No schedule slip — fallback work runs in parallel.

### EPIC 1: Foundation & Infrastructure (M1 — Weeks 1-6)

| Task | Description | TDD Acceptance |
|------|-------------|---------------|
| 1.1.1 | Init npm workspace + Turborepo [~2 tests] | `turbo build` succeeds. Tests: workspace resolution, build order |
| 1.1.2 | TypeScript strict config + project refs [~2 tests] | `tsc --build` zero errors. Tests: strict mode catches violations |
| 1.1.3 | ESLint + Prettier + Husky [~2 tests] | `npm run lint` passes. Tests: lint catches violations, Husky pre-commit runs |
| 1.1.4 | Jest + ts-jest with **80% coverage gate in CI** [~4 tests] | `npm test` enforces coverage. Tests: coverage gate fails at 79%, passes at 80% |
| 1.2.1 | **Bicep: Network** (VNet, 5 subnets, NSGs, NAT Gateway, 7 DNS zones) [~3 what-if assertions] | `--what-if` shows VNet + subnets + DNS |
| 1.2.2 | **Bicep: Cosmos DB Autoscale** (shared 400 RU/s + Orders dedicated, 14 containers, **tenant-prefixed hierarchical PK**, Session consistency) [~4 what-if assertions] | `--what-if` shows Autoscale account + 14 containers + hierarchical PKs + Session consistency |
| 1.2.3 | **Bicep: Key Vault Standard** (RBAC, purge protection, PE) [~2 what-if assertions] | `--what-if` shows Standard SKU + RBAC |
| 1.2.4 | **Bicep: Container Apps** (env + **5 apps** incl Next.js, ALL Consumption, KEDA) [~3 what-if assertions] | `--what-if` shows env + 5 container apps, all Consumption |
| 1.2.5 | **Bicep: Service Bus Standard** (4 topics + tenant subscription filters, dead-letter) [~3 what-if assertions] | `--what-if` shows Standard namespace + 4 topics + subscription filters |
| 1.2.6 | **Bicep: Web PubSub** (Free tier all envs, upgrade via SKU param) [~2 what-if assertions] | `--what-if` shows Free tier |
| 1.2.7 | **Bicep: Front Door** (always-on, WAF OWASP 3.2, CDN, custom domain) [~3 what-if assertions] | `--what-if` shows Front Door + WAF policy |
| 1.2.8 | **Bicep: Optional modules** (Redis, Event Hubs, NAT GW — feature-flagged) [~6 what-if assertions] | `--what-if` shows resources only when enableX=true. 2 assertions per module |
| 1.2.9 | **Bicep: Monitoring** (Log Analytics, App Insights, Sev1-4 alerts) [~3 what-if assertions] | `--what-if` shows workspace + alerts |
| 1.2.10 | **Bicep: main.bicep + 3 env param files + Functions app** [~3 what-if assertions] | All 3 envs validate, RBAC present, Functions app for signal ingestion |
| 1.3.1 | **CI/CD: PR validation** (lint, build, test, coverage, **Bicep validate 3 envs**) | PR blocked if any gate fails |
| 1.3.2 | CI/CD: Dev deploy (OIDC, Container Apps revision deploy, smoke test) | Health check passes |
| 1.3.3 | CI/CD: Prod deploy (GitHub Environment protection rule for manual approval, **revision-based deployment** with traffic splitting, auto-rollback on failed health check) [~3 tests] | Tests: new revision deploys at 0% traffic, health check passes → shift to 100%, failed health → rollback to previous revision within 60s |
| 1.4.1 | Local dev (.env.example, Docker Compose: Cosmos emulator) [~2 tests] | Running in <10 min. No Redis needed — in-memory cache + Cosmos for rate limiting. Tests: Cosmos emulator reachable, health check passes |

### EPIC 2: Authentication (M2a — Weeks 3-5)

| Task | Description | TDD Acceptance |
|------|-------------|---------------|
| 2.1.1 | Configure Entra External ID (Google + Microsoft OIDC) [~3 tests] | Both sign-in flows return valid JWTs. Tests: Google OIDC flow, Microsoft flow, invalid state rejected |
| 2.1.2 | **NextAuth.js server-side auth** [~5 tests] | Tests: redirect unauthenticated, server-side token exchange, httpOnly cookie set, session refresh, logout clears session |
| 2.1.3 | User profile service [~6 tests] | Tests: first login creates user, subsequent returns existing, CRUD operations, preferences update, missing tenantId rejected |
| 2.1.4 | **JWT validation middleware in Express** [~6 tests] | Tests: reject expired, reject invalid issuer, extract tenantId, rate limit per user, missing token returns 401, malformed token returns 401 |

### EPIC 3: Exchange Connectivity (M2b/M2c/M7a/M7b — Weeks 6-47)

**All 4 brokers are MVP scope.** TDD: tests before implementation. Record sandbox responses as fixtures.

**BLOCKING GATE per connector**: Verify testnet/paper access before starting implementation.

| Task | Description | Dependencies | Acceptance Criteria |
|------|-------------|-------------|-------------------|
| 3.0.1 | **IBKR OAuth application (WEEK 1)** — email `api@interactivebrokers.com` with platform description + use case. Design fallback: Client Portal Gateway + session monitor + graceful bot pause + user re-auth notification. Document both auth paths behind `IBKRAuthStrategy` interface so OAuth swaps in when approved. | None | Email sent. Fallback design documented. `IBKRAuthStrategy` interface defined with `GatewayAuth` and `OAuthAuth` implementations. **Week-12 checkpoint**: check approval status. |
| 3.1.1 | IExchangeConnector interface (multi-asset: stocks, crypto, futures) [~3 tests] | Market hours (04:00-20:00 ET), PDT, settlement, asset classes. **FREEZE via ADR.** Tests: interface contract compliance |
| 3.1.2 | BaseConnector (HTTP retry, WS, rate limiter, circuit breaker, market hours, symbol mapper) [~12 tests] | Tests: retry with backoff, circuit breaker states (CLOSED→OPEN→HALF-OPEN), rate limiter queuing, WS reconnect, market hours scheduler |
| 3.1.3 | Symbol normalization layer (per-exchange mapping) [~4 tests] | Tests: bidirectional mapping for all 4 exchanges |
| 3.1.4 | Market hours service (calendar + real-time status) [~6 tests] | Tests: pre/regular/post market, holidays, weekends, extended hours LIMIT-only, 24/7 crypto bypass |
| 3.2.1 | **Alpaca connector** [TDD: 35 tests] (Weeks 6-9) | 3.1.2 | Testnet gate → Orders on paper, WS <100ms, PDT tracking |
| 3.2.2 | **Coinbase connector** [TDD: 32 tests] (Weeks 9-11) | 3.1.2 | Testnet gate → JWT auth, sandbox orders, WS heartbeat |
| 3.2.3 | **Tasty Trade connector** [TDD: 30 tests] (Weeks 30-35) | 3.1.2 | Testnet gate → Session auth, DXLink streaming protocol |
| 3.2.4 | **IBKR connector** [TDD: 38 tests] (Weeks 38-47) | 3.1.2, 3.0.1 | Testnet gate → Gateway primary (OAuth if approved by Week 12). conId resolution. Session mgmt. Uses `IBKRAuthStrategy` from 3.0.1 |
| 3.3.1 | Credential encryption + Key Vault storage [~5 tests] | 1.2.3 | AES-256-GCM + KEK, remember-token support. Tests: encrypt/decrypt roundtrip, Key Vault store/retrieve, rotation zero-downtime |
| 3.3.2 | Connection health monitoring + session expiry alerts [~5 tests] | 3.2.x | Detect disconnect <2 min. Tests: health check passes/fails, session expiry triggers notification, reconnect attempt |
| 3.3.3 | PDT tracking service [~5 tests] | 3.2.1, 3.2.4 | Tests: count day trades correctly, block at limit (3), reset after 5 rolling days, bypass for >$25K equity, crypto exempt |

### EPIC 4: Strategy Framework & Bot Engine (M3b/M5b — Weeks 11-38)

**TDD**: Each strategy follows the 8-step TDD sequence (see `09-tdd-strategy.md`). Tests written BEFORE implementation.

| Task | Description | Dependencies | TDD Acceptance |
|------|-------------|-------------|----------------|
| 4.1.1 | IStrategy interface + Zod schemas | 1.1.2, 3.1.1 | Tests: all 8 config schemas validated (12-18 tests each) |
| 4.1.2 | Bot state machine (10 states, 30+ transitions) | 4.1.1 | Tests: all valid transitions, invalid throws, logging (~25 tests) |
| 4.1.3 | Bot engine orchestrator | 4.1.1, 4.1.2 | Tests: restart survival, idempotency, event routing (~20 tests) |
| 4.2.1 | Grid Trading strategy [TDD: 65 tests] | 4.1.3 | Steps 1-7 tests → Step 8 implement → >90% coverage |
| 4.2.2 | DCA strategy [TDD: 71 tests] | 4.1.3 | Multipliers, AOL, reinvestment, reserve funds, market hours |
| 4.2.3 | DCA Futures strategy [TDD: 83 tests] | 4.1.3 | Leverage, liquidation buffer, trailing, pump protection |
| 4.2.4 | BTD strategy [TDD: 64 tests] | 4.1.3 | Asymmetric grid, base-currency profit, both config paths |
| 4.2.5 | Combo strategy [TDD: 80 tests] | 4.1.3 | DCA entry + Grid exit phases, trailing SL |
| 4.2.6 | Loop strategy [TDD: 58 tests] | 4.1.3 | Fixed entry, gap-filling, 500 level cap, profit compounding |
| 4.2.7 | Futures Grid strategy [TDD: 76 tests] | 4.1.3 | LONG/SHORT/NEUTRAL, arithmetic/geometric, trigger price |
| 4.2.8 | TWAP strategy [TDD: 54 tests, fake timers] | 4.1.3 | Slice scheduling, price limit pause, market hours respect |

**Strategy implementation order within M5b (Weeks 19-38, ~3 wk each)**:

| Order | Task | Strategy | Weeks | Rationale |
|:-----:|------|----------|:-----:|-----------|
| 1 | 4.2.3 | DCA Futures | 19-22 | Extends DCA from M3b — natural progression, adds leverage/margin |
| 2 | 4.2.4 | BTD | 22-24 | Simpler asymmetric grid variant, validates grid foundation |
| 3 | 4.2.6 | Loop | 24-27 | Simple cycling, unique fixed-entry concept, independent |
| 4 | 4.2.7 | Futures Grid | 27-30 | Extends Grid from M3b with leverage + 3 modes |
| 5 | 4.2.5 | Combo | 30-34 | Combines DCA + Grid — requires both to be solid and tested |
| 6 | 4.2.8 | TWAP | 34-38 | Most distinct strategy, independent, time-based (fake timers) |
| 4.3.1 | Pre-trade risk checks [TDD] | 4.1.1 | Tests: balance, notional, leverage, rate, PDT (~15 tests) |
| 4.3.2 | Intra-trade risk monitoring [TDD] | 4.3.1 | Tests: drawdown, daily loss, circuit breaker (~15 tests) |
| 4.3.3 | Kill switch [TDD] | 4.3.2, 3.1.1 | Tests: cancel all, close all, <5s, audit trail (~10 tests) |
| 4.4.1 | Idempotent order executor [TDD] | 3.1.1 | Tests: no duplicates, partial fills, retry (~12 tests) |
| 4.4.2 | Fill processor [TDD] | 4.4.1 | Tests: process <500ms, partials, PnL calc (~10 tests) |
| 4.5.1 | **Insufficient funds handling** [TDD: ~8 tests] | 4.1.2 | Tests: auto-pause on insufficient, balance poll at 15s/30s/60s/120s/300s, auto-resume when funds available, stay paused after 5min, notification sent, no duplicate pauses, re-entry after manual resume |
| 4.5.2 | **Notification service** [TDD: ~10 tests] | 6.1.1, 7.2.1 | Tests: kill switch alert (in-app + email), bot error, exchange disconnect, SL trigger, TP hit, IBKR re-auth, insufficient funds, duplicate suppression, Web PubSub delivery, email via ACS |

### EPIC 5: Signal Ingestion (M4 — Weeks 14-15)

| Task | Description | Dependencies | Acceptance Criteria |
|------|-------------|-------------|-------------------|
| 5.1.1 | Azure Function HTTP trigger [~5 tests] | **1.2.10** (Functions app Bicep), 1.2.5 | <200ms accept, rate limited. Tests: 200 on valid, 400 on bad schema, 401 on bad token, 429 on rate limit, timeout handling |
| 5.1.2 | TradingView webhook validator [~6 tests] | 5.1.1 | Tests: valid payload accepted, missing fields rejected, expired timestamp rejected (>60s), valid auth token, invalid auth token, IP allowlist check |
| 5.1.3 | Replay protection (**Cosmos DB** — replaces Redis) [~5 tests] | 6.1.1 | Tests: first signal accepted, duplicate within 5min rejected (409), duplicate after TTL accepted, cross-instance dedup, hash collision handling |
| 5.2.1 | Signal router (match signal to bots) [~8 tests] | 5.1.1, 4.1.3 | Tests: route to matching bot, no match returns warning, multi-bot fanout, dead-letter after 5 failures, route within 500ms, pair + exchange matching |
| 5.2.2 | AI/ML signal plugin interface [~6 tests] | 5.2.1 | File-based plugin discovery from `plugins/` directory. Plugin lifecycle: `initialize()` → `generateSignal()` → `shutdown()`. Sandbox: plugin crash doesn't affect other plugins. Health check per plugin. Tests: load valid plugin, reject invalid plugin, plugin crash isolated, health check timeout, MA crossover plugin generates correct signal |

### EPIC 6: Data Layer (M3a — Weeks 8-10)

| Task | Description | Dependencies | Acceptance Criteria |
|------|-------------|-------------|-------------------|
| 6.1.1 | Cosmos DB client (managed identity, retry) [~5 tests] | 1.2.2 | No connection strings, 429 retry. Tests: managed identity auth, 429 retry with backoff, session token passed, connection failure handling |
| 6.1.2 | Repository pattern + **TenantContext mandatory filter** + **tenant isolation integration tests** [~15 tests] | 6.1.1 | ETag concurrency, parameterized queries, tenantId enforced. **CI-blocking tests**: every repository method must fail if tenantId is missing or mismatched. Tests: CRUD per repository, User A can't read User B's data (8 repos × 1 test), missing tenantId throws |
| 6.1.3 | Change feed processors (UI updates, metrics, audit) + **Leases container** [~10 tests] | 6.1.1 | Process within 2s, idempotent writes via `_lsn` checkpoint, Leases container for dedup. Tests: process event, idempotent reprocessing, lease acquisition, multi-replica dedup |
| 6.1.4 | **Schema versioning** (`_schemaVersion` on all entities) [~5 tests] | 6.1.2 | All documents include version. **Migration strategy**: lazy migration on read — if `_schemaVersion < current`, deserializer applies transforms and writes updated version back. Tests: read v1 doc returns v2 shape, write includes version, version mismatch logged, batch migration script for bulk updates |

### EPIC 7: Real-Time & API (M5a — Weeks 17-19)

| Task | Description | Dependencies | Acceptance Criteria |
|------|-------------|-------------|-------------------|
| 7.1.0 | **API versioning strategy** (URL-based `/api/v1/`) + **CORS config** [~4 tests] | 2.1.4 | Tests: versioned route resolves, CORS allows Next.js origin, CORS blocks unknown origin, deprecation header present on old version |
| 7.1.1 | Bot management API endpoints [~10 tests] | 2.1.2, 4.1.3, 6.1.2 | Zod validation, pagination, RFC 7807 errors. Tests: CRUD, validation rejects bad config, pagination, 404 on missing, 403 cross-tenant |
| 7.1.2 | Exchange connection API endpoints + **key rotation flow** [~8 tests] | 2.1.2, 3.3.1, 6.1.2 | Tests: create connection, list, delete, test connection, key rotation (new validated before old deleted), mask secrets in response |
| 7.1.3 | Signal & metrics API endpoints [~6 tests] | 2.1.2, 6.1.2 | Tests: time-range filter, pagination, empty result, metrics aggregation, signal list |
| 7.2.1 | **Web PubSub negotiate** + **tenant-scoped groups** + **polling fallback** [~8 tests] | 1.2.6 | Tests: 401 without session, returns WSS URL, groups restricted to authenticated user, **Client A cannot subscribe to Client B's groups**, polling fallback when WS unavailable |
| 7.2.2 | Market data WebSocket proxy [~4 tests] | 7.2.1 | <500ms delivery. Tests: subscribe/unsubscribe, auto-cleanup on disconnect, throttle to 15s for Web PubSub |

### EPIC 8: Frontend — Premium UX (M6a + M6b)

**UI/UX Stack**: Next.js App Router + Tailwind CSS + shadcn/ui + **Framer Motion** (animations) + TradingView Lightweight Charts + Recharts + skeleton loaders + dark/light mode

**Client State Management**:
- **TanStack Query (React Query)**: Server-state management with SWR (stale-while-revalidate) for all API data (bots, orders, metrics). Automatic refetch on focus, retry on error, optimistic updates for bot toggle/config changes.
- **Zustand**: Client-only state — theme preference, sidebar collapsed, active bot selection, wizard step position. Persisted to localStorage where needed.
- **WebSocket Provider Context**: React context wrapping Web PubSub lifecycle — connection, reconnection, group subscription management. Feeds real-time updates into TanStack Query cache via `queryClient.setQueryData()` for seamless merge of REST + WebSocket data.

**Phase 1: Frontend Skeleton (M6a)**

| Task | Description | TDD Acceptance |
|------|-------------|---------------|
| 8.0.1 | Design system setup (Tailwind theme, shadcn/ui, Framer Motion presets, color palette, dark/light) | Theme tokens defined, Storybook or visual test |
| 8.0.2 | Layout shell (animated sidebar, header, page transitions via Framer Motion) | Tests: SSR render, redirect unauthenticated, smooth transitions |
| 8.0.3 | Skeleton loader components + loading states (shimmer animations, no layout shifts) | Tests: skeleton renders during data fetch |
| 8.1.1 | **NextAuth.js auth flow** + Server Actions + API client | Tests: Server Action rejects without session |
| 8.1.2 | **Bot list page** (table with status indicators, PnL summary, start/stop/pause buttons, search/filter) | Tests: renders bot list, filters by status, shows PnL (~5 tests) |
| 8.1.3 | **Bot lifecycle controls** (start/stop/pause/resume buttons with confirmation dialogs, optimistic UI updates) | Tests: toggle triggers API call, confirmation shown for stop, state updates optimistically (~5 tests) |
| 8.1.4 | **Order history view** (paginated table with fills, side indicators, PnL per trade, export CSV) | Tests: renders orders, pagination works, export triggers download (~5 tests) |
| 8.2.4 | Exchange connection management (masked credentials, test button, health animation) | Tests: mask API key, test connection, status indicator (~5 tests) |

**Phase 2: Premium UI (M6b — after all strategies complete)**

| Task | Description | TDD Acceptance |
|------|-------------|---------------|
| 8.2.1 | Dashboard (animated metric cards: PnL counter, drawdown gauge, win rate ring, real-time via Web PubSub) | Tests: cards render, PnL updates smoothly, <2s load |
| 8.2.2 | Bot creation wizard (step animations, strategy preview, Zod validation with inline error animations) | Tests: validates config, step transitions, submits |
| 8.2.3 | Bot detail (**TradingView Lightweight Charts** candlesticks, **Recharts** animated PnL, order table with fill animations) | Tests: equity curve renders, order markers display |
| 8.3.1 | Mobile responsive pass (all pages fluid, touch targets, swipe gestures) | Tests: viewport tests at 375px, 768px, 1280px |
| 8.3.2 | Dark/light mode with smooth Framer Motion theme transitions | Tests: toggle works, colors correct in both modes |
| 8.4.1 | Playwright E2E tests (bot creation, dashboard, exchange management) | All critical user flows covered |
| 8.4.2 | Visual regression tests (screenshot comparison on PR) | Baseline established, no unintended visual changes |

### EPIC 9: Observability & Hardening (M9/M10 — Weeks 50-58)

| Task | Description | Dependencies | Acceptance Criteria |
|------|-------------|-------------|-------------------|
| 9.1.1 | App Insights + distributed tracing | 1.2.7 | End-to-end trace webhook→order |
| 9.2.1 | Health check endpoints | 6.1.1, 1.2.8 | /health + /ready, <500ms |
| 9.0.1 | **STRIDE threat model** (exchange key compromise, JWT theft, cross-tenant, order replay, webhook DDoS, malicious config) | Before 9.x tasks | Threat model documented. Mitigations mapped to architecture |
| 9.3.1 | Security audit (OWASP, npm audit, **CSP headers per Decision 14**, **strict CORS**) | All epics | Zero critical vulnerabilities. CSP blocks inline scripts. CORS allows Next.js origin only |
| 9.4.1 | Load testing (k6) | All deployed | p95 <500ms API, <1s orders |
| 9.5.1 | SLA alerting (Sev1=30m, Sev2=1h, Sev3=4h, Sev4=1d) | 9.1.1 | PagerDuty/Teams for Sev1, auto-ticket for Sev3 |
| 9.6.1 | GDPR: anonymization service (Art.17 erasure) + **data export API** (Art.20 portability, JSON + CSV) | 6.1.2 | Erasure: anonymize PII, delete KV creds. Export: `GET /api/v1/me/export` returns JSON archive (CSV option for trades). Rate-limited: 1/24h. Background job + notification |
| 9.6.2 | **Audit trail immutability** — change feed → Blob Storage immutable container (7yr retention) | 6.1.3 | AuditEvents archived to Blob with time-based retention policy. Integrity check: Cosmos vs Blob count |
| 9.7.1 | Configurable tenant limits (leverage, grid levels, safety orders) | 6.1.2 | Per-tenant config in Cosmos, admin API, defaults applied |
| 9.7.2 | **DLQ processor** (Azure Function timer, 5min interval, retry + persist to FailedMessages, Sev2 alert) | 1.2.5, 6.1.1 | DLQ depth monitored, failed messages persisted, retry attempted, Sev2 at depth > 10 |
| 9.8.1a | **DR runbook document** (documentation deliverable, not code) | All | Deliverable: runbook doc with CLI commands per scenario (Cosmos restore, KV recovery, region failover, revision rollback). See `02-assumptions-and-questions.md` runbooks |
| 9.8.1b | **DR validation test** (code) [~4 tests] | 9.8.1a | Tests: Cosmos point-in-time restore works, Key Vault soft-delete recovery works, Container App revision rollback succeeds, health check endpoints respond after recovery |
| 9.9.1 | **End-to-end flow diagrams** (documentation deliverable — 4+ Mermaid sequence diagrams) | All | Deliverable: Mermaid diagrams for webhook→order, bot creation, stop loss, disconnect recovery. NOT a code task |

### EPIC 10: Backtesting (M8 - Weeks 36-42)

**See `10-backtesting-architecture.md` for full design.**

| Task | Description | Dependencies | TDD Acceptance |
|------|-------------|-------------|----------------|
| 10.1.1 | SimulatedExchangeConnector [TDD: 35 tests] | 3.1.1 | Fill logic, slippage, fees, partial fills, balance tracking |
| 10.1.2 | BacktestEngine [TDD: 30 tests] | 10.1.1, 4.1.1 | Lifecycle, metrics, known-outcome integration |
| 10.2.1 | Historical data service | 3.2.x | Fetch from exchange APIs, cache in Blob Storage |
| 10.2.2 | Historical data catalog (Cosmos) | 6.1.1 | Track available date ranges, pairs, resolutions |
| 10.3.1 | Backtest API endpoints [TDD: 15 tests] | 10.1.2, 7.1.x | Submit, status, results, history, compare |
| 10.3.2 | Anti-abuse limits | 10.3.1 | Max 3 concurrent, 50/day, 500K candles |
| 10.4.1 | Backtest config form (reuses bot wizard) | 8.2.2, 10.3.1 | Strategy-specific forms + date/timeframe/fidelity |
| 10.4.2 | Results dashboard [TDD: 15 tests] | 10.3.1 | Equity curve, drawdown, metrics, trade table |
| 10.4.3 | Backtest comparison view | 10.4.2 | Side-by-side 2-5 backtests |

## Epic Checkpoint Summaries

> Use these checkboxes to track progress. Check off each task as it completes.

### EPIC 1 Checkpoint (Weeks 1-6)
- [ ] 1.1.1 npm workspace + Turborepo
- [ ] 1.1.2 TypeScript strict config
- [ ] 1.1.3 ESLint + Prettier + Husky
- [ ] 1.1.4 Jest + coverage gate
- [ ] 1.2.1–1.2.10 Bicep modules (10 modules, 3 env params)
- [ ] 1.3.1 CI/CD PR validation
- [ ] 1.3.2 CI/CD Dev deploy
- [ ] 1.3.3 CI/CD Prod deploy (revision-based)
- [ ] 1.4.1 Local dev environment

### EPIC 2 Checkpoint (Weeks 3-5)
- [ ] 2.1.1 Entra External ID configured
- [ ] 2.1.2 NextAuth.js server-side auth
- [ ] 2.1.3 User profile service
- [ ] 2.1.4 JWT validation middleware

### EPIC 3 Checkpoint (Weeks 6-47)
- [ ] 3.0.1 IBKR OAuth application sent
- [ ] 3.1.1–3.1.4 Base connector + interface + market hours
- [ ] 3.2.1 Alpaca connector (Weeks 6-9)
- [ ] 3.2.2 Coinbase connector (Weeks 9-11)
- [ ] 3.2.3 Tasty Trade connector (Weeks 30-35)
- [ ] 3.2.4 IBKR connector (Weeks 38-47)
- [ ] 3.3.1–3.3.3 Credentials + health + PDT

### EPIC 4 Checkpoint (Weeks 11-38)
- [ ] 4.1.1–4.1.3 IStrategy + state machine + orchestrator
- [ ] 4.2.1 Grid (M3b)
- [ ] 4.2.2 DCA (M3b)
- [ ] 4.2.3 DCA Futures (M5b, Weeks 19-22)
- [ ] 4.2.4 BTD (M5b, Weeks 22-24)
- [ ] 4.2.6 Loop (M5b, Weeks 24-27)
- [ ] 4.2.7 Futures Grid (M5b, Weeks 27-30)
- [ ] 4.2.5 Combo (M5b, Weeks 30-34)
- [ ] 4.2.8 TWAP (M5b, Weeks 34-38)
- [ ] 4.3.1–4.3.3 Risk engine + kill switch
- [ ] 4.4.1–4.4.2 Order executor + fill processor
- [ ] 4.5.1–4.5.2 Insufficient funds + notifications

### EPIC 5 Checkpoint (Weeks 14-15)
- [ ] 5.1.1–5.1.3 Signal ingestion + validation + replay protection
- [ ] 5.2.1–5.2.2 Signal router + plugin interface

### EPIC 6 Checkpoint (Weeks 8-10)
- [ ] 6.1.1–6.1.4 Cosmos client + repos + change feed + schema versioning

### EPIC 7 Checkpoint (Weeks 17-19)
- [ ] 7.1.0–7.1.3 API endpoints + versioning
- [ ] 7.2.1–7.2.2 Web PubSub + market data proxy

### EPIC 8 Checkpoint (Phase 1: Weeks 25-30, Phase 2: Weeks 47-54)
- [ ] 8.0.1–8.0.3 Design system + layout + skeleton loaders
- [ ] 8.1.1 NextAuth.js auth flow
- [ ] 8.1.2 Bot list page (MVP-1)
- [ ] 8.1.3 Bot lifecycle controls (MVP-1)
- [ ] 8.1.4 Order history view (MVP-1)
- [ ] 8.2.4 Exchange connection management
- [ ] 8.2.1–8.2.3 Dashboard + wizard + bot detail (Phase 2)
- [ ] 8.3.1–8.3.2 Mobile responsive + dark/light mode
- [ ] 8.4.1–8.4.2 Playwright E2E + visual regression

### EPIC 9 Checkpoint (Weeks 50-58)
- [ ] 9.0.1 STRIDE threat model
- [ ] 9.1.1 App Insights + tracing
- [ ] 9.2.1 Health check endpoints
- [ ] 9.3.1 Security audit + CSP
- [ ] 9.4.1 Load testing (k6)
- [ ] 9.5.1 SLA alerting
- [ ] 9.6.1–9.6.2 GDPR + audit immutability
- [ ] 9.7.1–9.7.2 Tenant limits + DLQ processor
- [ ] 9.8.1a–9.8.1b DR runbook + validation
- [ ] 9.9.1 End-to-end flow diagrams

### EPIC 10 Checkpoint (Weeks 36-42)
- [ ] 10.1.1–10.1.2 SimulatedExchangeConnector + BacktestEngine
- [ ] 10.2.1–10.2.2 Historical data service + catalog
- [ ] 10.3.1–10.3.2 Backtest API + anti-abuse
- [ ] 10.4.1–10.4.3 Backtest UI (config, results, compare)

---

## Milestone Timeline (Realistic Solo Developer — 65 Weeks)

> 45-week estimate was 30-40% too optimistic. Strategy pace at ~1.7 wk/each is unrealistic under strict TDD (realistic: 2.5-3.5 wk/each). This timeline adds proper pacing + 3-week buffer. IBKR Gateway is the primary path (not OAuth fallback).

```
Week  1:       M0   Dependency gates (IBKR OAuth app, Entra tenant, Alpaca paper key)
Weeks 1-6:     M1   Foundation (Bicep TDD, CI/CD, Cosmos Autoscale, auth)
Weeks 3-5:     M2a  Auth (Entra External ID + NextAuth.js)
Weeks 6-9:     M2b  Alpaca connector [TDD: 35 tests]
Weeks 9-11:    M2c  Coinbase connector [TDD: 32 tests]
Weeks 8-10:    M3a  Data Layer (Cosmos repos, tenant isolation, change feed)
Weeks 11-17:   M3b  Strategy core + Grid + DCA + risk engine [TDD: ~165 tests]
Weeks 14-15:   M4   Signal Ingestion [TDD: 30 tests]
Week  12:      ──   IBKR OAuth checkpoint
Week  16:      ──   DXLink spike/PoC (1-2 weeks)
Weeks 17-19:   M5a  API + Real-Time layer
Weeks 19-38:   M5b  Remaining 6 strategies [TDD: ~420 tests, ~3 wk each]
Weeks 25-30:   M6a  Frontend skeleton (design system, layout, auth, connections)
Weeks 30-35:   M7a  Tasty Trade connector [TDD: 30 tests]
Weeks 36-42:   M8   Backtesting engine + API [TDD: ~95 tests]
Weeks 38-47:   M7b  IBKR connector [TDD: 38 tests, Gateway primary]
Weeks 47-54:   M6b  Frontend premium UI (strategy forms, bot detail, charts, animations)
Weeks 50-54:   M9   Observability + SLA alerting + STRIDE threat model + DLQ processor
Weeks 54-58:   M10  Security hardening + GDPR + CSP + data export + audit immutability
Weeks 58-62:   M11  Backtesting UI + integration + E2E + load testing
Weeks 62-65:   ──   Buffer / contingency / polish (3 weeks)
```

**Total: ~65 weeks** (solo developer, TDD-rigorous, with 3-week buffer). Extended from 60 weeks to eliminate M6b/M7b parallel overlap — solo dev cannot context-switch between Framer Motion animations and TWS socket protocol effectively.

**MVP-1 deliverable at Week 30** (working software early):
- 2 exchanges (Alpaca + Coinbase)
- 8 strategies (Grid, DCA, DCA Futures, BTD, Combo, Loop, Futures Grid, TWAP)
- Frontend skeleton (functional but not premium)
- Signal ingestion + webhooks
- ~655 tests passing

**Full MVP at Week 65**:
- All 4 exchanges (+ Tasty Trade, IBKR)
- Premium animated UI
- Backtesting system
- Security hardened + GDPR compliant
- ~1,120 tests passing

**Key checkpoints**:
- Week 1: IBKR OAuth application submitted + Gateway fallback designed
- Week 9: First bot runs on Alpaca paper trading (Grid strategy)
- Week 12: IBKR OAuth checkpoint
- Week 16: DXLink spike validates Tasty Trade feasibility
- Week 30: **MVP-1 usable** (8 strategies + 2 exchanges + basic UI)
- Week 38: All 8 strategies complete with full tests
- Week 47: All 4 brokers connected (IBKR connector done)
- Week 54: Premium frontend complete
- Week 58: Security hardened, ~1,090 tests
- Week 62: Production-ready, ~1,120 tests
- Week 65: Buffer consumed or polish complete

**TDD Test Milestones** (authoritative: **~1,120 total** — source: `09-tdd-strategy.md`):
- M1: ~70 (infra, auth, tenant isolation)
- M3b: ~235 (Grid + DCA + risk engine ~70 tests)
- M5b: ~691 (all 8 strategies + risk engine)
- M7b: ~759 (all 4 exchange connectors at 90% coverage)
- M8: ~854 (backtesting engine)
- M10: ~1,040 (security, GDPR, STRIDE, audit immutability)
- M11: **~1,120** (premium frontend ~80, E2E, visual regression)

## CI/CD Strategy

### Environments

| Env | Trigger | Cosmos | Compute |
|-----|---------|--------|---------|
| Dev | Merge to `develop` | Autoscale (shared 400 RU/s) | Consumption (scales to zero) |
| Prod | Release tag + manual approval | Autoscale (same config) | Consumption (minReplicas:1 for 3 apps) |

### Deployment Safety (Revision-Based — Container Apps Consumption)

1. **Revision deployment**: Deploy new revision at 0% traffic → health check (`/health` + `/ready`) → shift traffic to 100% → deactivate old revision (zero downtime)
2. **Auto-rollback**: If post-deploy health fails within 60s, reactivate previous revision and shift traffic back: `az containerapp revision activate` + `az containerapp ingress traffic set --revision-weight <old>=100`
3. **Feature flags**: Azure App Configuration for gradual strategy rollout
4. **Data rollback**: Cosmos point-in-time restore (7d dev, 30d prod)
5. **Infra rollback**: Re-deploy previous Bicep version (declarative)

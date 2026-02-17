# B) Assumptions, Decisions & Open Questions

## Assumptions

1. **Single-region deployment** (East US 2). Multi-region via Bicep params when needed.
2. **Exchange testnet access**: Alpaca paper (confirmed available), Coinbase sandbox (confirmed). Tasty Trade cert env (requires approval — verify before scheduling). IBKR paper (requires account + 2FA setup — verify before scheduling). **Blocking gate**: each connector task verifies testnet access before starting.
3. **7-year financial data retention** for orders, fills, positions, audit events, state transitions.
4. **User count**: Personal project initially (<5 users). Architecture supports scaling to 1K+ MAU via Bicep feature flags.
5. **Order frequency**: Personal use ~1-10 orders/sec. Internal queue (Service Bus) handles 200 msg/sec. **Per-exchange effective limits are lower**: Alpaca 200/min, Coinbase 30/s, IBKR 5/s, Tasty Trade 60/min. The 200/sec figure is internal pipeline capacity, not per-exchange order rate. Per-exchange rate limiters in `BaseConnector` enforce exchange-specific caps.
6. **Market data**: Tick-level for active pairs only (not full orderbook). Cosmos Autoscale handles price updates within shared 400 RU/s. Increase max RU/s via Bicep param if needed.
7. **AI/ML signal source**: Plugin interface validated with a concrete MA crossover plugin (task 5.2.2). Full ML integration post-MVP.
8. **Backtesting**: Included in MVP as Epic 10.
9. **Mobile app**: Not in scope; responsive web.
10. **Leverage cap**: `min(tenant_config, exchange_api_max)`. Platform default 10x. **Runtime enforcement**: risk engine queries exchange API for actual max before applying.
11. **Schema evolution**: All entities include `_schemaVersion: number`. Readers handle old versions gracefully via version-aware deserializers.
12. **Exchange API versioning**: `BaseConnector` validates response schemas against expected format. Schema mismatch logs error + alerts (Sev 2). Connector tests use recorded fixtures validated weekly against live sandboxes (task in CI).
13. **Legal/compliance**: Platform provides software for user's own trading accounts. Not a broker-dealer. Not providing investment advice. User assumes all trading risk. Terms of service required at sign-up.

## Assumption Resolution Status

> Every assumption is either **Confirmed** (validated, no risk), **Pending** (needs verification at a specific milestone), or **Blocked** (requires external action before work can proceed). Development can start — all pending items have fallbacks and deadlines.

| # | Assumption | Status | Resolution Gate | Fallback | Risk if Wrong |
|---|-----------|:------:|----------------|----------|---------------|
| 1 | Single-region (East US 2) | **Confirmed** | Architectural decision | Bicep params support multi-region | Low — Bicep is region-agnostic |
| 2a | Alpaca paper access | **Pending** | Week 3 go/no-go | Start with Coinbase | Low — well-documented API |
| 2b | Coinbase sandbox access | **Pending** | Week 4 go/no-go | Build against recorded fixtures | Low — sandbox is self-service |
| 2c | Tasty Trade cert env | **Pending** | Week 16 go/no-go | Build against recorded fixtures | Medium — DXLink complexity |
| 2d | IBKR OAuth approval | **Pending** | Week 12 checkpoint | Gateway fallback (designed Week 1) | Medium — 3-6mo approval |
| 2e | IBKR paper account | **Pending** | Week 18 go/no-go | Record fixtures from API docs | Low — paper accounts are routine |
| 3 | 7-year retention viable | **Confirmed** | Cosmos TTL + continuous backup | N/A | None — built into Cosmos |
| 4 | <5 users at launch | **Confirmed** | Personal project scope | Scale-up triggers documented | None |
| 5 | Order frequency <10/sec | **Confirmed** | Per-exchange rate limiters | Service Bus handles 200 msg/sec internal | Low |
| 6 | Tick-level market data (not full book) | **Confirmed** | Architectural decision | Upgrade Cosmos RU/s via Bicep param | None |
| 7 | AI/ML post-MVP | **Confirmed** | Plugin interface in Epic 5 | MA crossover plugin validates interface | None |
| 8 | Backtesting in MVP | **Confirmed** | Epic 10 (Weeks 36-42) | N/A | None |
| 9 | No mobile app | **Confirmed** | Responsive web only | N/A | None |
| 10 | Leverage cap enforcement | **Confirmed** | Risk engine queries exchange API | `min(tenant, exchange)` at runtime | None |
| 11 | Schema evolution via `_schemaVersion` | **Confirmed** | All entities include version | Version-aware deserializers | None |
| 12 | Exchange API stability | **Pending** | Weekly contract tests in CI | Fixture-based fallback | Medium — schema drift possible |
| 13 | Not a broker-dealer | **Confirmed** | Legal/compliance assumption | ToS required at sign-up | Low — user's own accounts |
| — | Entra External ID | **Pending** | Week 2 go/no-go | Auth0 free tier (~1 week pivot) | Low — well-documented |
| — | Market data subscriptions | **Pending** | Before each connector | Delayed/free data + fixtures | Low — bots work with delayed data |

**Summary**: 10 confirmed, 7 pending (all have fallbacks + deadlines), 0 blocked. Development can start immediately — pending items resolve naturally through go/no-go gates.

## External Dependency Go/No-Go Gates

| Dependency | Go/No-Go Check | Deadline | Fallback if No-Go | Fallback Runbook |
|-----------|----------------|:--------:|-------------------|-----------------|
| Alpaca paper trading | Verify API key + test order | Week 3 | Start with Coinbase instead | 1. Create Coinbase sandbox key. 2. Swap M2 task order. 3. Return to Alpaca when resolved. |
| Coinbase sandbox | Verify CDP key pair + sandbox order | Week 4 | Record fixtures from docs; build against fixtures | 1. Create fixtures from API docs. 2. Build connector. 3. Validate against live sandbox post-access. |
| Tasty Trade cert env | Apply for cert account + verify session | Week 16 | Build against recorded fixtures | 1. Record fixtures from Tasty API docs. 2. Build DXLink client against mock WS. 3. Validate post-access. |
| IBKR OAuth approval | Is OAuth token available? | **Week 12** | Gateway fallback (designed Week 1) | 1. Deploy IBKR Gateway container. 2. Configure session monitor + re-auth notification. 3. Build connector against Gateway API. 4. Swap to OAuth when approved (same `IBKRAuthStrategy` interface). |
| IBKR paper account | TWS login + paper order works | Week 18 | Record fixtures; validate post-access | 1. Create fixtures from IBKR API docs. 2. Build connector with conId mock. 3. Validate against paper account post-access. |
| Entra External ID | Create tenant + Google sign-in works | Week 2 | Auth0 free tier | 1. Create Auth0 tenant. 2. Configure Google + Microsoft social. 3. Replace NextAuth Entra provider with Auth0 provider (~1 week). |
| Market data subscriptions | Verify real-time quotes available on each exchange | Before each connector | Use delayed/free data + recorded fixtures | 1. Test with free/delayed tier. 2. Subscribe to real-time when ready for prod. 3. Bot still functional with delayed data (wider spreads). |

## Decisions (Resolved)

### 1. Authentication: Microsoft Entra External ID

**Decision**: Use Entra External ID (not Auth0, not Azure AD B2C).

- **Why not B2C**: Microsoft is sunsetting Azure AD B2C in favor of Entra External ID (the successor product). Entra External ID offers the same OIDC/SAML capabilities with native Azure integration, risk-based sign-in, and no per-authentication fees under 50K MAU. Starting on B2C would require a future migration.
- **Why not Auth0**: Auth0 has better login page customization but costs $35-240/mo for custom domains/branding removal, creates a separate identity plane from Azure, and adds network hop latency.
- **Rationale for Entra**: Free <50K MAU, native Container Apps/managed identity/Conditional Access integration, risk-based sign-in powered by Microsoft threat intelligence.
- **App registration type**: **Web application** (confidential client), NOT SPA. NextAuth.js runs server-side and securely holds a client secret. SPA registration would create a public client (PKCE only), losing the security benefit of server-side auth. Redirect URI: `https://tradingtower.com/api/auth/callback/azure-ad`.
- **Quick-start**: Create External tenant → register **Web** app + API app → configure Google + Microsoft OIDC → apply branding → integrate NextAuth.js server-side → Express JWT middleware.

### 2. Exchange Build Order: Alpaca → Coinbase → Tasty Trade → IBKR

**Decision**: All 4 brokers in MVP. Build order: Alpaca (Weeks 6-9) → Coinbase (Weeks 9-11) → Tasty Trade (Weeks 30-35) → IBKR (Weeks 40-49).
- **No deferral**: All brokers ship in MVP within the 65-week timeline.
- **IBKR checkpoint**: OAuth application submitted Week 1. Approval checked Week 12. If not approved, Gateway fallback already designed and ready.

### 3. IBKR: Apply for OAuth Now, Build Gateway Fallback

**Decision**: Apply for Technology Provider OAuth program immediately (free, no fees, 3-4 month approval).
- **Action item (Week 1)**: Email `api@interactivebrokers.com` with platform description + use case.
- **Week 12 checkpoint**: If OAuth not approved, proceed with Client Portal Gateway + session monitoring + graceful bot pause + user re-auth notification.

### 4. Backtesting: Include in MVP (Epic 10)

**Decision**: Include. Reuses IStrategy + SimulatedExchangeConnector. See `10-backtesting-architecture.md`.

### 5. Strategy Limits: Configurable Per Tenant

**Decision**: Stored in tenant config in Cosmos DB. Defaults: max 10x leverage, max 100 grid levels, max 50 safety orders. Effective limit = `min(tenant_config, exchange_limit)`.

### 6. Azure Firewall: Removed ($912/mo saved)

**Decision**: Use NSG rules + NAT Gateway (deferred) for outbound control.

### 7. Multi-Region: Single Region, Multi-Region Ready

**Decision**: Deploy East US 2. Architecture designed for easy expansion (region-agnostic Bicep params, stateless Container Apps, Cosmos DB trivially converts to multi-region).

### 8. Data Retention: 7 Years for Financial Data

**Decision**: Orders, fills, positions, audit events, bot state transitions retained 7 years. Signal events 90 days. Minute-level metrics 1 day, hourly 30 days, daily 7 years.

### 9. GDPR: Right-to-Erasure

**Decision**: Anonymization service replaces PII with hashed identifiers, deletes Key Vault credentials. Preserves anonymized trade records for compliance.

**Per-entity anonymization specification**:

| Entity | Fields Anonymized | Method |
|--------|------------------|--------|
| Users | `displayName`, `email`, `identityProviderSubjectId` | SHA-256 with per-tenant salt |
| Connections | `label`, `apiKeyVaultSecretUri`, `apiSecretVaultSecretUri`, `passphraseVaultSecretUri` | Delete Key Vault secrets entirely. Replace URIs with `[REDACTED]` |
| AuditEvents | `details` (if contains PII) | Selective field redaction |
| Notifications | `title`, `message` (if contains PII) | Selective field redaction |
| BotDefinitions, Orders, Positions | No PII fields | No anonymization needed (reference by IDs only) |

- **Salt handling**: Per-tenant salt stored in Key Vault. Salt is **destroyed** after erasure, making re-identification impossible even with the hash algorithm.
- **Immutable audit entry**: The erasure action itself is logged as an AuditEvent (type: `GDPR_ERASURE_COMPLETED`) BEFORE the anonymization runs. This ensures there's always a record that erasure occurred.
- **Timing**: Erasure completes within 72 hours of request (Art. 17 compliance).

### 10. SLA Targets & Disaster Recovery

**SLA Response Times:**

| Severity | Response Time | Description |
|----------|-------------|-------------|
| Sev 1 | 30 minutes | Platform down, trading halted |
| Sev 2 | 1 hour | Feature degraded, some bots affected |
| Sev 3 | 4 hours | Non-critical bug, workaround available |
| Sev 4 | 1 business day | Cosmetic, enhancement |

**Disaster Recovery (RTO/RPO):**

**Service-level failure** (single service outage within the region):

| Component | RPO (max data loss) | RTO (max downtime) | Backup Method |
|-----------|:---:|:---:|---------------|
| Cosmos DB | **0 min** (continuous backup) | **< 1 hour** | Point-in-time restore (7-day dev, 30-day prod) |
| Key Vault | **0 min** (soft-delete) | **< 30 min** | Soft-delete (90 days) + purge protection |
| Container Apps | N/A (stateless) | **< 5 min** | Auto-restart. State in Cosmos, not in containers |
| Service Bus | **< 5 min** (in-flight msgs) | **< 15 min** | In-flight messages may be lost. Idempotent replay from Cosmos change feed |
| Blob Storage | **0 min** (LRS 3 copies) | **< 1 hour** | Backtest data regenerable from exchange APIs |

**Full region failure** (East US 2 down — rare but possible):

| Component | RPO | RTO | Recovery |
|-----------|:---:|:---:|----------|
| Cosmos DB | **< 1 hour** | **4-8 hours** | Restore from continuous backup to new region. Data since last backup point lost. |
| Key Vault | **0 min** | **2-4 hours** | Recover from soft-delete in new region (secrets replicated by Azure) |
| Container Apps | N/A | **1-2 hours** | Redeploy Bicep to secondary region. Container images in ACR (geo-replicated if Standard) |
| Service Bus | **< 15 min** | **1-2 hours** | Recreate namespace in new region. In-flight messages lost. Bots recover from Cosmos state |
| **Overall platform** | **< 1 hour** | **4-8 hours** | Bicep redeploy to secondary region + Cosmos restore + DNS update |

> **Note**: RPO=0 for region failure requires multi-region Cosmos write ($$$) and Service Bus Geo-DR (Premium tier, $677/mo). Not justified for a personal project. Current architecture accepts < 1 hour data loss in a full region outage.

**Infrastructure Runbooks (with CLI commands):**

**Runbook 1: Cosmos DB Failure**
- **Owner**: Platform operator (solo dev)
- **Alert**: App Insights metric `cosmos_request_failures > 10/min` → Sev1
- **Steps**:
```bash
# 1. Verify failure scope
az cosmosdb show -g rg-tradetower-prod -n cosmos-tradetower-prod --query "failoverPolicies"

# 2. Trigger point-in-time restore (within 30-day window)
az cosmosdb restore -g rg-tradetower-prod -n cosmos-tradetower-prod-restored \
  --restore-timestamp "2026-02-17T10:00:00Z" \
  --source-database-account cosmos-tradetower-prod

# 3. Update Container Apps to use restored account
az containerapp update -g rg-tradetower-prod -n ca-bot-engine \
  --set-env-vars COSMOS_ENDPOINT=https://cosmos-tradetower-prod-restored.documents.azure.com:443/

# 4. Verify data integrity
az cosmosdb sql container list -g rg-tradetower-prod -a cosmos-tradetower-prod-restored -d tradetower
```

**Runbook 2: Key Vault Failure**
- **Owner**: Platform operator
- **Alert**: App Insights dependency `keyvault_failures > 0` → Sev1
- **Steps**:
```bash
# 1. Check soft-delete status
az keyvault list-deleted --query "[?name=='kv-tradetower-prod']"

# 2. Recover vault
az keyvault recover -n kv-tradetower-prod

# 3. Verify secrets accessible (managed identity auto-reconnects)
az keyvault secret list --vault-name kv-tradetower-prod --query "[].name"
```

**Runbook 3: Container App Persistent Crash**
- **Owner**: Platform operator
- **Alert**: Container Apps `restart_count > 5/10min` → Sev2
- **Steps**:
```bash
# 1. Check logs for crash reason
az containerapp logs show -g rg-tradetower-prod -n ca-bot-engine --tail 100

# 2. Check current revision health
az containerapp revision list -g rg-tradetower-prod -n ca-bot-engine -o table

# 3. Rollback to previous revision
az containerapp revision activate -g rg-tradetower-prod -n ca-bot-engine \
  --revision ca-bot-engine--<previous-revision-suffix>
az containerapp ingress traffic set -g rg-tradetower-prod -n ca-bot-engine \
  --revision-weight ca-bot-engine--<previous-revision-suffix>=100

# 4. Investigate and fix in dev, then redeploy
```

**Runbook 4: Full Region Failure (East US 2 down)**
- **Owner**: Platform operator
- **Alert**: Azure Status page + all health checks failing → Sev1
- **Steps**:
```bash
# 1. Deploy to secondary region (e.g., East US)
az deployment group create -g rg-tradetower-dr -f infra/main.bicep \
  -p infra/environments/dr.bicepparam --confirm-with-what-if

# 2. Restore Cosmos from backup
az cosmosdb restore -g rg-tradetower-dr -n cosmos-tradetower-dr \
  --restore-timestamp "<latest-available>" \
  --source-database-account cosmos-tradetower-prod \
  --location "East US"

# 3. Update DNS
az network dns record-set cname set-record -g rg-dns -z tradingtower.com \
  -n @ -c ca-web-dr.azurecontainerapps.io

# 4. Verify all services healthy
curl https://tradingtower.com/api/health
```

**Alert-to-Action Mapping:**

| Alert | Sev | Owner | First Action | Escalation (if unresolved 15min) |
|-------|:---:|-------|-------------|--------------------------------|
| Cosmos request failures >10/min | 1 | Platform op | Runbook 1: check failover, restore if needed | N/A (solo dev) |
| Key Vault dependency failure | 1 | Platform op | Runbook 2: recover soft-deleted vault | N/A |
| Container restart count >5/10min | 2 | Platform op | Runbook 3: check logs, rollback revision | N/A |
| Exchange circuit breaker tripped | 2 | Platform op | Verify exchange status page. Wait for auto-recovery. | Manual resume if exchange is up but circuit stuck |
| DLQ depth >10 messages | 2 | Platform op | Check DLQ processor logs. Manually inspect FailedMessages. | Investigate root cause in Service Bus metrics |
| Cosmos RU >80% sustained 1h | 3 | Platform op | Increase autoscale max via Bicep param + redeploy | N/A |
| Web PubSub >90% of 20K/day | 3 | Platform op | Evaluate upgrading to Standard or increasing throttle | Upgrade to Standard ($49/mo) |
| Kill switch triggered | 1 | Platform op | Investigate trigger in AuditEvents. Verify all positions closed. Notify user. | N/A |
| Order placement failure rate >1% | 2 | Platform op | Check exchange connector logs. Verify API keys valid. Check rate limits. | Pause affected bots. Rotate API key if compromised. |

**Security Incident Playbooks:**

| Incident | Detection | Response | Recovery |
|----------|-----------|----------|----------|
| **Auth compromise** (stolen JWT) | Anomalous API calls from new IP/location (App Insights) | 1. Revoke user session in Entra. 2. Force re-auth. 3. Review audit log for unauthorized actions. 4. Notify user. | Rotate Entra client secret if platform-level. User changes password. |
| **Exchange API key leak** | Key used from unknown IP (exchange alert) or user report | 1. Immediately rotate key on exchange. 2. Delete Key Vault secret version. 3. Store new key. 4. Reconnect bots. 5. Audit all trades since leak. | Key rotated. Connection health check confirms new key works. |
| **Exchange outage** (API down) | Health check fails for >2 min (task 3.3.2) | 1. Auto-pause all bots for that exchange. 2. Notify user (Notification: EXCHANGE_DISCONNECT). 3. Exponential backoff reconnect. | Auto-resume when health check passes. Reconcile open orders via REST. |
| **Replay attack** (webhook) | Duplicate signal detected by Cosmos TTL dedup (task 5.1.3) | 1. Reject duplicate (409). 2. Log source IP. 3. If >10 replays/min: block IP. | No trade impact (dedup prevents execution). Review webhook token security. |
| **Tenant boundary breach** (bug) | CI tenant isolation tests should catch pre-merge. If in prod: audit log shows cross-tenant data access | 1. **Kill switch** all bots immediately. 2. Identify and hotfix the repository bug. 3. Audit all data access since deployment. 4. Notify affected tenants. | Deploy fix. Verify CI tenant isolation tests cover the scenario. Add regression test. |
| **PDT violation** (unexpected) | Alpaca/IBKR API rejects order with PDT flag | 1. Pause bot. 2. Notify user (Notification: PDT_WARNING). 3. Surface day trade count in UI. | User adds funds to >$25K or waits for rolling 5-day window reset. |

### 11. Multi-Tenant Data Isolation

**Decision**: Defense-in-depth tenant isolation (3 layers).

**Layer 1 — Partition key enforcement (data-level)**:
All sensitive containers include `tenantId` in their partition key. Cross-tenant reads are structurally impossible at the Cosmos level:

| Container | Partition Key | Isolation |
|-----------|--------------|-----------|
| Users | `/tenantId` | Tenant-scoped. For personal use, tenantId = userId. For future multi-user orgs, tenantId = orgId. |
| Connections | `/tenantId` | Tenant-scoped |
| BotDefinitions | `/tenantId` | Tenant-scoped |
| BotRuns | `/tenantId/botDefinitionId` (hierarchical) | Tenant-scoped |
| Orders | `/tenantId/botRunId` (hierarchical) | Tenant-scoped |
| Positions | `/tenantId/botRunId` (hierarchical) | Tenant-scoped |
| AuditEvents | `/tenantId` | Tenant-scoped |
| SignalEvents | `/tenantId/botRunId` (hierarchical) | Tenant-scoped |

**Layer 2 — App-layer enforcement**:
- `TenantContext` middleware extracts `tenantId` from JWT
- Repository base class injects `tenantId` as mandatory partition key prefix — queries without it throw `TENANT_ID_REQUIRED`

**Layer 3 — CI test gate (build-blocking)**:
- Integration tests in `__integration__/tenant-isolation.test.ts` verify: User A cannot read User B's data for every repository method
- PR cannot merge if any tenant isolation test fails

### 12. Key Rotation Strategy

| Secret Type | Rotation Method | Frequency |
|------------|----------------|-----------|
| Exchange API keys | User-initiated via Connection API. Zero-downtime: new key validated before old key deleted | On demand |
| Entra client secret | Key Vault auto-rotation policy | 90 days |
| Cosmos DB keys | Not used — Entra auth via managed identity (no keys to rotate) | N/A |
| Service Bus keys | Key Vault references; rotate via Key Vault policy | 180 days |

### 13. Effectively-Once via Idempotency (Not True Exactly-Once)

> **Terminology**: The system provides **at-least-once delivery + idempotent processing = effectively-once semantics**. True exactly-once requires distributed transactions which are impractical at this scale. The guarantee is: a message may be delivered multiple times, but processing it twice produces the same result as processing it once.

| Message Type | Idempotency Key | Deduplication Store |
|-------------|----------------|---------------------|
| `bot-commands` | `commandId` (UUID) | Cosmos DB: check before processing |
| `order-commands` | `clientOrderId` | Exchange API + Cosmos DB: check both |
| `signal-events` | `hash(payload + timestamp)` | Cosmos DB with TTL=300s (replaces Redis) |
| Change feed events | `_lsn` (logical sequence number) | Built-in checkpoint in Azure Functions trigger |

**Order flow outbox pattern**: When a strategy decides to place an order, the sequence is:
1. Write `OrderRequest` document to Cosmos (outbox) with status `PENDING`
2. Cosmos change feed triggers the Execution Service
3. Execution Service places the order on the exchange (using `clientOrderId` for exchange-level idempotency)
4. On success/failure, update the `OrderRequest` status in Cosmos
5. If the Execution Service crashes between steps 2-3, the change feed redelivers → `clientOrderId` dedup prevents double-placement

### 14. Content Security Policy (CSP)

**Decision**: Strict CSP headers enforced on all Next.js responses.

```
default-src 'self';
script-src 'self' https://s3.tradingview.com;
style-src 'self' 'unsafe-inline';
connect-src 'self' wss://*.webpubsub.azure.com https://*.cosmos.azure.com;
img-src 'self' data: https:;
frame-src 'none';
font-src 'self';
object-src 'none';
base-uri 'self';
form-action 'self';
```

- `script-src` allows TradingView Lightweight Charts CDN
- `style-src 'unsafe-inline'` required for Tailwind CSS runtime styles
- `connect-src` allows Web PubSub WebSocket connections
- `frame-src 'none'` prevents clickjacking
- Applied via Next.js middleware (`middleware.ts`) as response headers

### 15. GDPR Data Portability (Art. 20)

**Decision**: `GET /api/v1/me/export` returns a JSON archive of all user data.

**Export format**: JSON primary, CSV secondary for trade data.

```typescript
interface DataExport {
  exportedAt: string;
  format: 'JSON';
  user: User;                    // Profile, preferences
  connections: Connection[];     // Exchange connections (credentials EXCLUDED)
  botDefinitions: BotDefinition[];
  botRuns: BotRun[];            // All historical runs
  orders: OrderRequest[];       // All orders
  fills: OrderFill[];           // All fills
  positions: PositionSnapshot[];
  signals: SignalEvent[];       // Last 90 days
  auditEvents: AuditEvent[];   // Last 7 years
  notifications: Notification[];
}
```

- CSV export option: `GET /api/v1/me/export?format=csv` returns a ZIP of CSV files (one per entity type). Trade data in CSV is more accessible for spreadsheet analysis.
- Export is rate-limited: max 1 export per 24 hours per user.
- Export runs as a background job; user receives notification when ready.

### 16. STRIDE Threat Model

**Decision**: Formal STRIDE threat analysis precedes Epic 9 (Security Hardening). Added as task 9.0.1.

**Priority threat scenarios**:

| Threat | STRIDE Category | Mitigation |
|--------|:-:|-------------|
| Exchange API key compromise | Information Disclosure | Key Vault + managed identity. Keys never in memory longer than needed. Rotation on demand. |
| JWT token theft | Spoofing | httpOnly cookies, short expiry (1h), refresh via server-side NextAuth.js. No tokens in localStorage. |
| Cross-tenant data access | Elevation of Privilege | 3-layer isolation (partition key + middleware + CI gate). Service Bus tenant filters. |
| Order replay attack | Tampering | `clientOrderId` idempotency. Cosmos dedup with TTL. Exchange-level dedup. |
| Webhook flood / DDoS | Denial of Service | 2-tier rate limiting (in-memory + Cosmos). Front Door WAF (OWASP 3.2). Azure DDoS L7. |
| Malicious strategy config | Tampering | Zod schema validation at API boundary. Max leverage/grid/order limits per tenant. |

### 17. Audit Trail Immutability

**Decision**: Defense-in-depth for audit log tamper resistance.

- **Hot copy**: AuditEvent documents in Cosmos DB (7-year TTL). Mutable by anyone with Cosmos write access.
- **Cold archive**: Change feed exports AuditEvents to Azure Blob Storage with **immutable container policy** (time-based retention, 7 years). Once written, blobs cannot be modified or deleted until retention expires.
- **Verification**: Periodic integrity check compares Cosmos AuditEvent count vs Blob archive count. Discrepancy triggers Sev2 alert.
- **Cost**: Blob immutable storage is ~$0.01/GB/mo (Cool tier). Negligible at personal scale.

### 18. Service Bus Tenant Isolation

**Decision**: All Service Bus topic subscriptions include `tenantId` correlation filter. Extends tenant isolation to the messaging layer. See `03-azure-architecture.md` for filter configuration. The `market-data` topic is exempt (market data is shared).

### 19. Exchange-Side Stop Protection

**Decision**: When a strategy sets a stop-loss, the Execution Service MUST also place a corresponding exchange-native stop order. This ensures positions survive platform outages (4-8hr RTO). Non-negotiable safety requirement. See `05-strategy-engine.md` for implementation details.

### 20. Web PubSub Tier

**Decision**: **Free tier for all environments** with mandatory throttling policy.
- Free: 20 concurrent connections, 20,000 messages/day
- **Known constraint**: 2 pairs at 5s ticks = ~23K msg/day (exceeds Free limit). Mitigation: **throttle UI price ticks to 15s intervals** (~7.7K msg/day). Strategy Engine receives full 5s ticks via Service Bus directly (not through Web PubSub).
- **Auto-upgrade trigger**: If >3 consecutive days hit 90% of 20K limit → alert. Upgrade to Standard ($49/mo) when >3 concurrent users or throttling is insufficient.
- Free tier is viable ONLY with the 15s throttle in place. Without throttle, Standard is required from day 1.

### 21. Front Door

**Decision**: **Mandatory in prod** ($35/mo). **Optional in dev** (`enableFrontDoor=false` in dev.bicepparam).
- Prod: Always on. WAF (OWASP 3.2), CDN, TLS 1.3, custom domain, DDoS L7. Non-negotiable for a financial platform.
- Dev: OFF by default. Container Apps provides free TLS/HTTPS for development.
- Dev idle cost: **~$120** (without Front Door) vs ~$155 (with). Includes Private Endpoints ($44) + DNS Zones ($3.50).

---

## Canonical Decisions Appendix (Single Source of Truth)

> **All other architecture docs reference this table.** If a doc contradicts this table, this table wins.

| Decision | Value | Notes |
|----------|-------|-------|
| **Cosmos DB mode** | **Autoscale** (all envs) | Shared DB 400 RU/s ($29) + Orders dedicated 400 RU/s ($29) = $58/mo |
| **Cosmos DB consistency** | **Session** (all envs) | Read-your-writes at zero extra RU cost. NOT Eventual (causes stale reads). See `04-data-architecture.md` |
| **Service Bus SKU** | **Standard** (all envs, $10/mo) | Upgrade to Premium ($677) at >50 concurrent bots (scale trigger) |
| **Front Door** | **OFF dev / ON prod** ($35/mo) | `enableFrontDoor=false` dev, `=true` prod |
| **Web PubSub tier** | **Free** (all envs) + **mandatory 15s UI tick throttle** | Free viable ONLY with throttle. Auto-upgrade alert at 90% of 20K/day. Standard ($49) at >3 users or if throttle insufficient |
| **Container Apps plan** | **Consumption** (all apps) | Dev: minReplicas=0. Prod: minReplicas=1 for Next.js, Execution, Market Data (~$75/mo) |
| **Always-on app count (prod)** | **3** apps at minReplicas=1 | Next.js ($15) + Execution ($30) + Market Data ($30) |
| **Redis** | **OFF** (feature flag) | In-memory lru-cache + Cosmos for rate limiting. Enable at >50 users |
| **Event Hubs** | **OFF** (feature flag) | Service Bus topics for market data. Enable at measurable bottleneck thresholds |
| **NAT Gateway** | **OFF** (feature flag) | Enable when IBKR requires fixed egress IPs |
| **Partition key pattern** | `/tenantId/...` prefix on **ALL** containers (no exceptions) | Users, Connections, BotDefs: `/tenantId`. BotRuns, StrategyConfigs: `/tenantId/botDefinitionId`. Orders, Positions, Signals, StateTransitions, Metrics: `/tenantId/botRunId`. AuditEvents, Notifications: `/tenantId` |
| **Auth registration** | **Web app** (confidential client) | NOT SPA. NextAuth.js server-side with client secret |
| **TDD policy** | Every task uses Universal TDD Template | CI blocks PRs without companion tests. See `09-tdd-strategy.md` |
| **Service Bus topics** | **4 topics**: `bot-commands`, `order-commands`, `signal-events`, `market-data` | Dead-letter enabled. Standard SKU ($10/mo) |
| **BotState enum** | `INITIALIZING, FUNDS_RESERVED, WAITING, ACTIVE, TRAILING, PUMP, PAUSED, CLOSING, STOPPED, COMPLETED, ERROR` | Canonical: `CLOSING` (not STOPPING). Source: `04-data-architecture.md` |
| **Private Endpoints** | **6 always-on** (~$44/mo) | Cosmos, Key Vault, Service Bus, Web PubSub, Storage, ACR. ~$7.30 each |
| **DNS Private Zones** | **7 zones** (~$3.50/mo) | $0.50 each |
| **Dev fixed baseline** | **~$120/mo** | Cosmos $58 + Service Bus $10 + CR $5 + PEs $44 + DNS $3.50 |
| **Prod fixed baseline** | **~$262/mo** | Dev + Front Door $35 + 3 apps minReplicas:1 $75 + Cosmos backup $2-5 |
| **Timeline** | **65 weeks** | Solo developer. TDD-rigorous. 3-week buffer. MVP-1 at Week 30. M6b/M7b serialized (no overlap). See `07-implementation-plan.md` |
| **Container count** | **14** (12 data + Leases + FailedMessages) | +2 Backtesting containers added separately in Epic 10 |
| **Circuit breaker** | Per-exchange, 5 failures → OPEN 60s → HALF-OPEN probe | `BaseConnector` pattern. 4xx does NOT trip. See `08-exchange-connectors.md` |
| **DLQ processing** | Azure Function timer, 5min, retry + FailedMessages container | Sev2 alert if DLQ depth > 10. See `03-azure-architecture.md` |
| **Test count (authoritative)** | **~1,120** | Source: `09-tdd-strategy.md`. +25 risk engine + +30 frontend premium over original 1,065 |
| **Mutation testing floor** | **70% general / 80% critical** | Critical = risk engine, order execution, auth modules. Raised from 60/80 |
| **Exchange connector coverage** | **90%** lines, branches, functions | Raised from 85% — connector bugs cause direct financial loss |
| **Service Bus tenant isolation** | **tenantId correlation filter** on all topic subscriptions | Except `market-data` (shared). Sessions via `sessionId = botId` for ordering |
| **Exchange-side stop protection** | **Mandatory** | Every stop-loss MUST have a corresponding exchange-native stop order |
| **CSP policy** | **Strict** | Allows TradingView CDN. Blocks frames. See Decision 14 |
| **Audit trail immutability** | **Blob Storage immutable container** | 7-year retention. Change feed export. See Decision 17 |
| **Outbound control** | **Application-level hostname allowlist** | NSGs for port-level only. No FQDN filtering (requires Azure Firewall $912). |
| **Service inventory** | **5 Container Apps + 1 Functions app** | `ca-web`, `ca-api`, `ca-bot-engine`, `ca-execution`, `ca-realtime` + `func-signals`. See `03-azure-architecture.md` |
| **Web PubSub UX** | **15s price throttle accepted** | UI is monitoring-only. Order fills + bot state unthrottled (≤2s). Upgrade at >3 users. |
| **Egress approach** | NSGs allow port 443 to Internet + `BaseConnector` validates hostnames in code | Add Azure Firewall when compliance requires network-level FQDN filtering |

You are a Principal Software Architect and Cloud Security Architect. Your task is to produce a complete, comprehensive, implementation-ready plan to build a multi-tenant trading bot platform named “TradingTower” running in Microsoft Azure.

GOAL
TradingTower allows end users to authenticate, connect their broker/exchange accounts, configure and run automated trading bots across multiple asset classes (stocks, futures, forex, crypto, and crypto derivatives futures), monitor live/historical performance, and modify/stop bots safely.

CORE FUNCTIONAL REQUIREMENTS
1) Authentication & User Management
- Users must be able to sign in using Google and Microsoft (Outlook) identities.
- Use secure, standards-based auth (OIDC/OAuth2). Minimize custom auth code.
- Note: If using Azure AD B2C, call out platform constraints/availability and propose viable alternatives if needed. (Provide options + tradeoffs.) 

2) Broker/Exchange Connectivity
- Users can configure and connect to their broker/exchange (per broker’s supported instruments).
- Credentials/API keys must be stored securely (encrypted at rest, least privilege).
- Persist connection details because the system executes trades on the user’s behalf.
- Support both REST and WebSocket where exchanges provide them (market data + order updates).

3) Bot Lifecycle
- Users can start bots using any supported strategy on any instrument they choose (e.g., AAPL, SPY, QQQ, BTC) as offered by their connected broker/exchange.
- Users can modify parameters of a running bot where safe, or stop it immediately.
- System must support viewing historical bots with their configurations, executions, and performance.

4) Signal Ingestion
- Bot entries/exits can be driven by:
  a) external webhook signals (e.g., TradingView webhooks)
  b) AI/ML signals (pluggable source)
  c) internal triggers (grid/DCA logic)
- Webhook endpoints must be secure, validated, throttled, and auditable. (Assume HTTP-trigger-based webhook ingestion in Azure.) 

5) Strategies (MUST IMPLEMENT)
Create a strategy framework with a clean interface/contract and implement the following strategies:
1. Grid Trading Bot
2. DCA (Dollar Cost Averaging) Bot
3. DCA Futures Bot
4. BTD (Buy The Dip) Bot
5. Combo Bot
6. Loop Bot (Recurring Buy/Sell Grid)
7. Futures Grid Bot
8. TWAP (Time-Weighted Average Price) Bot
I will provide more details for each strategy later. For now, define a strategy abstraction and identify per-strategy configuration schemas, state machine, and risk constraints.

6) Data & Observability
- Every bot run, order, fill, position change, and state transition must be logged and stored in Azure Cosmos DB.
- The stored data must support dashboards showing each bot’s performance (PnL, drawdown, win rate, exposure, fees, slippage).
- Cosmos DB design must include partition strategy aligned to access patterns and scale. 

7) Live Data
- The system must stream live market data and bot state to the UI using a scalable real-time mechanism (WebSockets / pub-sub / managed real-time service).
- Users should see live updates for running bots and orders.

NON-FUNCTIONAL REQUIREMENTS (MUST ADDRESS)
- Multi-tenant isolation (data & execution).
- Security: secret storage, encryption, key rotation, RBAC, managed identities preferred over connection strings.
- Reliability: retries, idempotency, exactly-once semantics where feasible for trade execution flows.
- Safety controls: guardrails to prevent runaway trading (max orders/min, max notional, max leverage, circuit breakers).
- Compliance posture: audit logs, immutable execution trail, PII handling, data retention.
- Performance: low-latency order routing, scalable signal ingestion, scalable websockets.
- Cost: identify major cost drivers and cost-optimization levers.

DELIVERABLES (OUTPUT FORMAT)
Produce the plan with the following sections, in order:

A) Executive Summary
- 1–2 pages: architecture approach, major components, and why.

B) Assumptions & Open Questions
- Make reasonable assumptions if details are missing, but clearly list them.
- List the minimal set of questions you need answered later (max 10), grouped by theme.

C) End-to-End Architecture
1) Logical Architecture
- Component diagram (text-based is fine): UI, API, auth, bot orchestration, strategy engine, execution service, market data ingestion, signal ingestion, telemetry, storage.
2) Physical Architecture in Azure
- Map each component to Azure services.
- Include network topology (VNet, private endpoints where appropriate), ingress (Front Door/App Gateway), and outbound controls.

D) Data Architecture (Cosmos DB)
- Containers/collections, partition keys, indexing policy approach, TTL/retention, change feed usage (if applicable).
- Entity schemas for: User, Connection, BotDefinition, BotRun, StrategyConfig, SignalEvent, OrderRequest, OrderFill, PositionSnapshot, BotStateTransition, MetricsSnapshot, AuditEvent.
- Query patterns needed for dashboards and historical views.

E) Bot Execution & Risk Engine Design
- Define a bot state machine and lifecycle transitions.
- Define a strategy interface (inputs/outputs/state), scheduling model, and how to ensure idempotent order placement.
- Describe handling of partial fills, reconnects, order amendments/cancels, and exchange outages.
- Define risk checks: pre-trade, intra-trade, and kill-switch behavior.

F) Signal Ingestion Design
- Webhook intake (validate payload, authN/Z, replay protection, rate limits, allowlists if needed).
- AI signal integration as a plugin (contract, versioning, observability, rollback).
- Event-driven pipeline from signal → decision → order.

G) Real-Time UI & APIs
- API surface: endpoints for bots, strategies, connections, orders, performance, logs.
- Real-time streaming approach for live bot status and market data to UI.
- Authorization model per tenant/user.

H) Azure Resources & IaC (Bicep)
- Provide a Bicep-based deployment plan matching the architecture.
- Use modular Bicep (separate modules for compute, network, Cosmos, Key Vault, messaging, monitoring).
- Include identities and RBAC assignments; avoid embedding secrets in code.
- Output a skeleton repository layout for IaC (folders/modules/params).

I) CI/CD & Environments
- Dev/Test/Prod separation, configuration strategy, secret management, safe deployment strategy.
- Automated tests (unit/integration/e2e), infrastructure validation, and rollback strategy.

J) Implementation Plan (Divide & Rule)
- Break work into Epics → Features → Tasks.
- For each task: objective, inputs/outputs, dependencies, acceptance criteria.
- Include milestones for: auth, broker connectors, strategy framework, each strategy implementation, telemetry, UI, and hardening.

CONSTRAINTS / HINTS
- Webhook handling should align with Azure Functions HTTP trigger/binding guidance. 
- TradingView webhooks may send JSON and have security considerations (e.g., don’t put secrets in the webhook body); incorporate secure endpoint practices.
- Cosmos DB should be provisioned and managed via Bicep; highlight how you deploy account/db/container and evolve throughput settings safely.
- Prefer managed identities and RBAC for Azure service-to-service access (no connection strings in code).

IMPORTANT
- Do not provide trading advice or recommend specific trades.
- Focus on software architecture, security, and implementation planning.
- Be concrete: name Azure services, show data schemas, and produce actionable task breakdowns.
- Use typescript and node/react js as the coding language.
``
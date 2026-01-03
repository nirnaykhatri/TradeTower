Created 25 todos

I've created a comprehensive plan with 25 breakdown tasks to implement WebSocket-based order fill detection. Here's the organization:

## Plan Overview

**Phase 1: Foundation & Interfaces (Tasks 1-3)**
- Design the overall architecture
- Create listener interfaces
- Extend connector interfaces

**Phase 2: Exchange Connector Implementation (Tasks 4-9)**
- Build WebSocket utility base class
- Implement for each exchange (Binance, Coinbase, Alpaca, IBKR, Futures)
- Handle exchange-specific WebSocket protocols

**Phase 3: Strategy Integration (Tasks 10-12)**
- Update BaseStrategy to be event-driven
- Update GridStrategy and other strategies
- Update BotManager to manage subscriptions

**Phase 4: Production Hardening (Tasks 13-17)**
- Create subscription manager (optional but recommended)
- Configuration framework
- Error handling & reconnection logic
- Monitoring & observability
- Trade recording accuracy

**Phase 5: Testing & Documentation (Tasks 18-25)**
- Unit and integration tests
- Fallback strategy for graceful degradation
- Documentation and migration guide
- Load testing
- Final cleanup

## Key Architecture Decisions to Make:

1. **Connection Pooling**: Share one WebSocket per exchange, or one per bot?
2. **Listener Pattern**: Strategy implements IOrderFillListener, or use event bus?
3. **Fallback Strategy**: Fail silently, fallback to polling, or disable bot?
4. **State Management**: How to handle fills received during WebSocket downtime?

Would you like me to start with any specific phase, or discuss the architecture decisions first before implementation?
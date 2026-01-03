# WebSocket-Based Order Fill Detection Architecture

## Overview

This document describes the event-driven architecture for handling order fills via WebSocket subscriptions to exchange servers. This replaces polling mechanisms to achieve better scalability when running multiple concurrent trading bots.

## Architecture Decisions

### 1. Connection Pooling Strategy
**Decision: Shared WebSocket per exchange per user**

- **One WebSocket connection per (user, exchange, environment)** rather than per bot
- Multiple bots subscribe to the same connection for the same pair
- Uses a connection manager to handle lifecycle and reconnection
- Reduces resource consumption and API connection limits
- Scales to 100+ concurrent bots with minimal footprint

### 2. Listener Pattern
**Decision: Strategy implements IOrderFillListener interface**

- Strategies inherit from `BaseStrategy` which implements `IOrderFillListener`
- Connector notifies listeners via `onOrderFilled()`, `onOrderPartiallyFilled()`, `onOrderCancelled()`
- One listener per active bot instance
- Allows strategies to react immediately to fill events

### 3. Fallback Strategy
**Decision: Graceful degradation with optional polling fallback**

- If WebSocket subscription fails, log critical error
- Bot can continue with optional polling (disabled by default)
- User is notified via UI that live fill detection is unavailable
- Configuration allows per-exchange fallback behavior

### 4. State Management
**Decision: Exchange remains source of truth**

- WebSocket fills are treated as events to update local state
- No caching of fills during downtime
- On reconnection, services can optionally poll for missed fills
- Strategy relies on exchange for order status confirmation

## Component Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Bot Engine                           │
│  (BotManager, GridStrategy, DCAStrategy, etc.)         │
└────────────────────┬────────────────────────────────────┘
                     │ subscribes/unsubscribes
                     ▼
┌─────────────────────────────────────────────────────────┐
│              Strategy (IOrderFillListener)              │
│  (Implements onOrderFilled, onOrderCancelled, etc.)     │
└────────────────────┬────────────────────────────────────┘
                     │ registered as listener
                     ▼
┌─────────────────────────────────────────────────────────┐
│          Exchange Connector (IExchangeConnector)        │
│  (BinanceConnector, CoinbaseConnector, etc.)           │
│  ┌──────────────────────────────────────────────────┐  │
│  │   WebSocket Manager                              │  │
│  │  - Connection lifecycle                          │  │
│  │  - Auto-reconnect with backoff                   │  │
│  │  - Event parsing & validation                    │  │
│  │  - Listener registry & notification              │  │
│  └──────────────────────────────────────────────────┘  │
└────────────────────┬────────────────────────────────────┘
                     │ WebSocket connection
                     ▼
        ┌────────────────────────────────┐
        │  Exchange Server               │
        │  (Binance, Coinbase, Alpaca)   │
        └────────────────────────────────┘
```

## Event Flow

### Order Fill Event

```
1. User places order via BotManager
   └─> BotManager.executeOrder() returns TradeOrder

2. Exchange executes order (market) or accepts (limit)
   └─> Exchange emits execution report

3. WebSocket receives execution event
   └─> Connector parses and validates event
   └─> Creates/updates TradeOrder object

4. Connector notifies all registered listeners
   └─> strategy.onOrderFilled(order) async call

5. Strategy updates internal state & balances
   └─> Calculate profit, place counter-orders
   └─> Record trade to database
```

### Connection Lifecycle

```
DISCONNECTED
    │ (subscribe to orders)
    ▼
CONNECTING (exponential backoff)
    │ (connection attempt)
    ├─ SUCCESS ──> CONNECTED ──────┐
    │                               │ (authentication)
    └─ FAILURE ──> backoff retry    │ (subscribe to streams)
                                    │
                          AUTHENTICATED
                            │ (ready for events)
                            ▼
                        RECEIVING EVENTS
                            │
                    (network error/timeout)
                            │
                            ▼
                    RECONNECTING (backoff)
                            │
                    (user stops bot)
                            │
                            ▼
                        DISCONNECTED
```

## Interface Definitions

### IOrderFillListener
Implemented by strategy classes to receive fill notifications.

```typescript
interface IOrderFillListener {
  // Called when an order is completely filled
  onOrderFilled(order: TradeOrder): Promise<void>;
  
  // Called when an order is partially filled (useful for large orders)
  onOrderPartiallyFilled(order: TradeOrder): Promise<void>;
  
  // Called when an order is cancelled
  onOrderCancelled(orderId: string, pair: string): Promise<void>;
  
  // Connection lifecycle callbacks
  onWebSocketConnected(exchange: string): Promise<void>;
  onWebSocketDisconnected(exchange: string): Promise<void>;
  onWebSocketError(exchange: string, error: Error): Promise<void>;
}
```

### IExchangeConnector Extensions
Added WebSocket subscription methods to existing interface.

```typescript
interface IExchangeConnector {
  // Existing methods...
  
  // New WebSocket subscription methods
  subscribeToOrderFills(
    pair: string, 
    listener: IOrderFillListener
  ): Promise<void>;
  
  unsubscribeFromOrderFills(
    pair: string, 
    listener: IOrderFillListener
  ): Promise<void>;
  
  // WebSocket status queries
  isWebSocketConnected(exchange?: string): boolean;
  getWebSocketStatus(): {
    isConnected: boolean;
    exchange: string;
    subscriptionCount: number;
    lastEventTime?: number;
    connectionUptime?: number;
  };
}
```

## Configuration

```json
{
  "websocket": {
    "enabled": true,
    "reconnect": {
      "maxRetries": 10,
      "initialDelayMs": 100,
      "maxDelayMs": 30000,
      "backoffMultiplier": 1.5
    },
    "connectionTimeout": 10000,
    "heartbeatIntervalMs": 30000,
    "fallbackToPolling": false,
    "pollIntervalMs": 5000
  },
  "exchanges": {
    "binance": {
      "websocketEnabled": true,
      "websocketUrl": "wss://stream.binance.com:9443/ws"
    },
    "coinbase": {
      "websocketEnabled": true,
      "websocketUrl": "wss://ws-feed.exchange.coinbase.com"
    }
  }
}
```

## Error Handling

### Connection Errors
- Exponential backoff with max retry limit
- Log all reconnection attempts
- Alert user if persistent connection loss
- Fallback to polling if configured

### Message Parsing Errors
- Skip malformed messages (log warning)
- Validate order ID and pair against active orders
- Quarantine suspicious messages for review
- Continue processing other valid messages

### Listener Errors
- Wrap strategy callbacks in try-catch
- Log strategy errors without stopping WebSocket
- Retry failed operations with exponential backoff
- Persist failed operations for later retry

## Security Considerations

1. **API Key Handling**: WebSocket connections use authenticated endpoints
2. **Message Validation**: All messages validated against schema
3. **User Isolation**: Each user gets separate WebSocket connection
4. **Rate Limiting**: Respect exchange rate limits on connections
5. **Connection Security**: Use WSS (secure WebSocket) only

## Performance Metrics

- **Latency**: Sub-100ms from exchange emit to strategy notification (typical)
- **Throughput**: Handles 1000+ fills/second per connection
- **Memory**: ~5MB per active WebSocket connection
- **CPU**: Minimal overhead per additional listener

## Monitoring & Observability

- Track connection uptime per exchange
- Measure fill event latency
- Count reconnection attempts and successes
- Monitor listener callback durations
- Alert on persistent connection issues

## Future Enhancements

1. **Multi-region WebSocket pools**: Distribute load across regions
2. **Circuit breaker pattern**: Disable temporarily failing connections
3. **Message batching**: Group small orders for efficiency
4. **Dead letter queue**: Capture and replay missed fills

# BTD Strategy Code Review Report
**Date**: January 2, 2026  
**Reviewer**: Principal Software Engineer  
**Scope**: Uncommitted changes in BTDStrategy.ts

---

## Executive Summary

The BTD strategy refactoring introduces important improvements: base-funded initialization, asymmetric grid support, and proper profit tracking in base currency. However, several critical issues around metadata lifecycle, validation, and documentation need attention before production deployment.

**Overall Rating**: 6.8/10

---

## 1. Design & Architecture (6.5/10)

### Issue 1.1: Configuration Mutation Anti-Pattern
**Location**: BTDStrategy.ts

```typescript
if (explicitDown !== undefined && explicitUp !== undefined) {
    this.currentLowPrice = anchorPrice - levelsDown * step;
    this.currentHighPrice = anchorPrice + levelsUp * step;
}
```

**Problem**: Mutates user-configured price bounds when explicit levels are provided, potentially violating user expectations and breaking stop-loss/take-profit triggers that reference these bounds.

**Recommendation**: The levelsDown and levelsUp are optional for users. If users provide them they don't provide low and high price they will be auto-calcaulated. 


### Issue 1.2: Missing Configuration Validation
**Location**: BTDStrategy.ts

**Problem**: No validation that required config combinations are present. Users can provide `levelsDown/levelsUp` without `gridStep`, resulting in silent fallback to range-based calculation.

**Recommendation**: Add early validation:
```typescript
protected async calculateAsymmetricGrid(anchorPrice: number): Promise<void> {
    const { gridLevels, gridStep, levelsDown, levelsUp, lowPrice, highPrice } = this.config;
    
    // Validate configuration combinations
    if ((levelsDown !== undefined || levelsUp !== undefined) && !gridStep) {
        throw new Error('[BTD] levelsDown/levelsUp require gridStep% to be specified');
    }
    if (!gridStep && (!lowPrice || !highPrice)) {
        throw new Error('[BTD] Either (low/high prices) or (gridStep + levels) must be provided');
    }
    
    // ... rest of logic
}
```

---

## 2. Code Quality & Patterns (6/10)

### Issue 2.1: Metadata Leak in Trailing Operations
**Location**: BTDStrategy.ts

**Problem**: `handleTrailingDown` cancels sell orders but doesn't clean up `orderMetadata`, causing memory leak and stale data. Same issue exists in `handleTrailingUp`.

**Impact**: Over time, metadata map grows unbounded; future sells won't find matching buy context.

**Recommendation**:
```typescript
private async handleTrailingDown(): Promise<void> {
    try {
        const topLevel = this.gridLevels[this.gridLevels.length - 1];
        for (const [id, order] of this.activeOrders.entries()) {
            if (order.side === 'sell' && Math.abs(order.price - topLevel) / topLevel < PRICE_TOLERANCE) {
                await this.exchange.cancelOrder(id, this.bot.pair).catch(() => { });
                this.activeOrders.delete(id);
                this.orderMetadata.delete(id); // ← ADD THIS
            }
        }
        // ... rest
    }
}
```

### Issue 2.2: Inconsistent Amount Calculation
**Location**: Multiple locations

**Problem**: Amount per level calculated as `investment / gridLevels` assumes investment is in base currency, but config doesn't specify currency denomination clearly.

**Example**:
- BTDStrategy.ts: `const amountPerLevel = this.config.investment / this.config.gridLevels;`
- BTDStrategy.ts: Same calculation repeated

**Recommendation**: Extract to helper method with clear semantics:
```typescript
private getBaseCurrencyPerLevel(): number {
    // investment is expected to be in base currency for BTD
    // If quote-funded, caller must convert before calling start()
    return this.config.investment / this.config.gridLevels;
}
```

Then document in BTDConfig interface that `investment` is base-denominated for BTD.

### Issue 2.3: Silent Error Handling
**Location**: BTDStrategy.ts

```typescript
} catch (error) {
    await this.handleStrategyError(error as Error, `placeOrder(${side} @ ${price})`);
}
```

**Problem**: `placeOrder` doesn't return `undefined` explicitly in catch block, but TypeScript expects `TradeOrder | undefined`. Caller assumes success if no exception.

**Recommendation**:
```typescript
} catch (error) {
    await this.handleStrategyError(error as Error, `placeOrder(${side} @ ${price})`);
    return undefined; // ← ADD THIS
}
```

---

## 3. Naming Conventions (8/10)

### Issue 3.1: Method Name Mismatch
**Location**: BTDStrategy.ts

**Problem**: `calculateAsymmetricGrid` now handles both symmetric (uniform step) and asymmetric (explicit levels) modes, but name implies only asymmetric.

**Recommendation**: Rename to `calculateGrid` or add inline comment clarifying dual modes:
```typescript
/**
 * Calculate grid levels
 * 
 * Supports two configuration modes:
 * 1) Range-driven: low/high prices + optional gridStep%
 * 2) Count-driven: levelsDown/levelsUp + gridStep% (derives low/high)
 */
protected async calculateGrid(anchorPrice: number): Promise<void>
```

---

## 4. Code Duplication & Reuse (7/10)

### Issue 4.1: Repeated Grid Recalculation Pattern
**Location**: BTDStrategy.ts, BTDStrategy.ts

**Problem**: Identical pattern in `start()` and `increaseInvestment()`:
```typescript
await this.calculateAsymmetricGrid(ticker.lastPrice);
await this.placeInitialSellOrders(ticker.lastPrice);
```

**Recommendation**: Extract to private method:
```typescript
private async initializeGrid(currentPrice: number): Promise<void> {
    await this.calculateAsymmetricGrid(currentPrice);
    await this.placeInitialSellOrders(currentPrice);
}

async start(): Promise<void> {
    await this.updateBotStatus('running');
    const ticker = await this.exchange.getTicker(this.bot.pair);
    this.lastPrice = ticker.lastPrice;
    await this.initializeGrid(ticker.lastPrice);
}
```

### Issue 4.2: Duplicated Order Cancellation Logic
**Location**: BTDStrategy.ts, BTDStrategy.ts

**Problem**: Similar cancel-and-delete pattern in both trailing methods.

**Recommendation**: Extract helper:
```typescript
private async cancelOrdersAtLevel(targetLevel: number, side?: 'buy' | 'sell'): Promise<void> {
    for (const [id, order] of this.activeOrders.entries()) {
        if (side && order.side !== side) continue;
        if (Math.abs(order.price - targetLevel) / targetLevel < PRICE_TOLERANCE) {
            await this.exchange.cancelOrder(id, this.bot.pair).catch(() => { });
            this.activeOrders.delete(id);
            this.orderMetadata.delete(id);
        }
    }
}
```

---

## 5. Object-Oriented Principles (7/10)

### Issue 5.1: Single Responsibility Violation
**Location**: `calculateAsymmetricGrid` method

**Problem**: Method does three distinct things:
1. Determines level split (distribution logic)
2. Calculates step sizes
3. Generates grid arrays

**Recommendation**: Split into focused methods:
```typescript
private determineLevelSplit(): { levelsDown: number; levelsUp: number } {
    // Distribution logic
}

private calculateStepSizes(anchorPrice: number, levelsDown: number, levelsUp: number): void {
    // Step calculation
}

protected async calculateAsymmetricGrid(anchorPrice: number): Promise<void> {
    const { levelsDown, levelsUp } = this.determineLevelSplit();
    this.calculateStepSizes(anchorPrice, levelsDown, levelsUp);
    this.gridLevels = this.generateGridLevels(anchorPrice, levelsDown, levelsUp);
}
```

### Issue 5.2: Protected State Mutation
**Location**: Multiple properties mutated across methods

**Problem**: `currentLowPrice`, `currentHighPrice` mutated in grid calculation, violating encapsulation when config provides explicit values.

**Recommendation**: Use separate computed range vs configured range, or make mutation explicit through dedicated setter with validation.

---

## 6. Performance & Scalability (8/10)

### Issue 6.1: Unbounded Metadata Growth
**Location**: `orderMetadata` Map

**Problem**: Already identified in section 2.1, but emphasizing performance impact: In long-running bots with frequent trailing, this grows linearly with cancelled orders.

**Quantified Impact**: With 100 trailing events/day, ~3,000 stale entries/month.

**Recommendation**: Implement periodic cleanup or use WeakMap if order lifecycle permits.

### Issue 6.2: Grid Sorting on Every Price Update
**Location**: BTDStrategy.ts, BTDStrategy.ts

**Problem**: `this.gridLevels.sort((a, b) => a - b)` called in every trailing event, but grid is already sorted after construction.

**Recommendation**: Remove redundant sorts; rely on construction-time sort at BTDStrategy.ts.

---

## 7. Readability & Maintainability (6/10)

### Issue 7.1: Stale Documentation
**Location**: BTDStrategy.ts

**Problem**: Comment says "Place new buy order at new lowest level" but code places sell order at highest level.

```typescript
/**
 * Handle trailing down mechanism
 * 
 * When price falls below grid range:
 * 1. Cancel order at highest price level
 * 2. Shift grid down by one step
 * 3. Place new buy order at new lowest level  ← WRONG
 * 
 * This allows bot to "follow" price downward to catch deeper dips.
 */
```

**Recommendation**:
```typescript
/**
 * Handle trailing down mechanism
 * 
 * When price falls below grid range:
 * 1. Cancel highest sell order
 * 2. Shift entire grid down by one step
 * 3. Place new sell order at new highest level (maintains grid count)
 * 
 * This allows bot to "follow" price downward to catch deeper dips.
 */
```

### Issue 7.2: Magic Number in Grid Construction
**Location**: BTDStrategy.ts

```typescript
const totalSteps = Math.max(gridLevels - 1, 1);
```

**Problem**: `- 1` and `1` are unexplained; unclear why steps = levels - 1.

**Recommendation**: Add inline comment:
```typescript
// Steps = levels - 1 because grid includes both endpoints (n levels = n-1 gaps)
const totalSteps = Math.max(gridLevels - 1, 1);
```

### Issue 7.3: Unclear Profit Calculation Formula
**Location**: BTDStrategy.ts

```typescript
const grossQuoteProfit = (order.price - buyContext.buyPrice) * order.amount;
const feeCost = (order.price + buyContext.buyPrice) * order.amount * this.feeBuffer;
const netQuoteProfit = grossQuoteProfit - feeCost;
const baseProfit = netQuoteProfit / order.price;
```

**Problem**: Formula converts quote profit to base without explanation. Why divide by sell price?

**Recommendation**: Add detailed comment:
```typescript
// Calculate profit in base currency:
// 1. Gross quote profit = (sellPrice - buyPrice) × amount
// 2. Fee cost ≈ (sellPrice + buyPrice) × amount × feeRate (round-trip approximation)
// 3. Net quote profit = gross - fees
// 4. Base profit = netQuoteProfit / sellPrice (converts USD profit to ZRX equivalent)
const grossQuoteProfit = (order.price - buyContext.buyPrice) * order.amount;
const feeCost = (order.price + buyContext.buyPrice) * order.amount * this.feeBuffer;
const netQuoteProfit = grossQuoteProfit - feeCost;
const baseProfit = netQuoteProfit / order.price;
```

---

## 8. Testing & Error Handling (5/10)

### Issue 8.1: Missing Edge Case Validation
**Location**: BTDStrategy.ts

**Problem**: No validation for:
- `gridLevels < 2` (needs at least 2 levels for buy+sell)
- `levelsDown = 0` and `levelsUp = 0` simultaneously
- `anchorPrice` outside configured range

**Recommendation**: Add guards:
```typescript
if (gridLevels < 2) {
    throw new Error(`[BTD] gridLevels must be >= 2, got ${gridLevels}`);
}

if (levelsDown === 0 && levelsUp === 0) {
    throw new Error('[BTD] Cannot have zero levels on both sides');
}

if (anchorPrice < this.currentLowPrice || anchorPrice > this.currentHighPrice) {
    console.warn(`[BTD] Anchor ${anchorPrice} outside range [${this.currentLowPrice}, ${this.currentHighPrice}]`);
}
```

### Issue 8.2: Silent GridIndex Failure
**Location**: BTDStrategy.ts

```typescript
if (gridIndex === -1) return;
```

**Problem**: When order price doesn't match any grid level (due to trailing or precision), silently returns without logging. Debugging impossible.

**Recommendation**:
```typescript
if (gridIndex === -1) {
    console.warn(`[BTD Bot ${this.bot.id}] Order ${order.id} price ${order.price} not found in grid (likely trailing)`);
    return;
}
```

---

## Summary of Ratings

| Dimension | Rating | Key Issues |
|-----------|--------|------------|
| Design & Architecture | 6.5/10 | Config mutation, missing validation |
| Code Quality & Patterns | 6/10 | Metadata leak, inconsistent calculations |
| Naming Conventions | 8/10 | Method name mismatch |
| Code Duplication | 7/10 | Repeated patterns extractable |
| OOP Principles | 7/10 | SRP violations, state encapsulation |
| Performance | 8/10 | Metadata growth, redundant sorts |
| Readability | 6/10 | Stale comments, magic numbers |
| Testing & Error Handling | 5/10 | Missing edge cases, silent failures |

**Overall**: 6.8/10

---

## Priority Fixes (P0 - Must Fix Before Merge)

1. ✅ **Fix metadata leak** in `handleTrailingDown/Up` (add `this.orderMetadata.delete(id)`)
2. ✅ **Add config validation** for required combinations
3. ✅ **Update stale documentation** to match trailing behavior
4. ✅ **Add explicit return** in `placeOrder` catch block

---

## Recommended Improvements (P1 - Should Fix Soon)

1. Extract repeated grid initialization pattern
2. Extract order cancellation helper
3. Add edge case validation (gridLevels < 2, etc.)
4. Remove redundant sorts
5. Add detailed profit calculation comments

---

## Nice-to-Have Enhancements (P2)

1. Split `calculateAsymmetricGrid` into focused methods
2. Use separate derived vs configured range properties
3. Add periodic metadata cleanup
4. Improve logging for debugging trailing events

---

**Conclusion**: The refactoring delivers critical functionality but needs surgical fixes around metadata lifecycle and validation before production. With P0 fixes applied, the code reaches 7.5+/10 quality suitable for principal-level standards.
# Bicep Infrastructure Review - Principal Engineer Assessment

## Executive Summary
Overall architecture is **solid** with good separation of concerns. However, there are **7 critical issues** and **12 improvements** needed before production deployment.

---

## 🔴 CRITICAL ISSUES (Must Fix)

### 1. **Missing Identity in Functions Module**
**File:** `infra/modules/functions.bicep` (Line 23-46)  
**Issue:** Function App outputs `identity.principalId` but never defines the identity property.  
**Impact:** Deployment will fail with "property principalId does not exist".

```bicep
// MISSING:
resource functionApp 'Microsoft.Web/sites@2022-09-01' = {
  identity: {
    type: 'SystemAssigned'
  }
  // ... rest
}
```

**Fix:** Add `identity` block to functionApp resource.

---

### 2. **Container Apps Missing Output**
**File:** `infra/modules/containerapp.bicep` (Line 106)  
**Issue:** File ends abruptly without output declarations that `main.bicep` expects.

```bicep
// MISSING at end of file:
output apiPrincipalId string = apiApp.identity.principalId
output botPrincipalId string = botApp.identity.principalId
```

**Fix:** Add the output variables.

---

### 3. **Cosmos DB Missing Throughput Configuration**
**File:** `infra/modules/cosmos.bicep` (Lines 44-58)  
**Issue:** Containers created without explicit throughput mode. Will default to Manual 400 RU/s per container = **2400 RU/s total cost**.  
**Impact:** $140/month baseline cost vs $25/month with shared throughput.

**Fix:**
```bicep
resource database 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2023-11-15' = {
  properties: {
    resource: { id: 'TradingPlatformDB' }
    options: {
      throughput: 400  // Shared across all containers
    }
  }
}

// Then remove throughput from individual containers
```

---

### 4. **Storage Account Naming Collision Risk**
**File:** `infra/modules/functions.bicep` (Line 6)  
**Issue:** `uniqueString(appName)` is NOT unique across environments/regions.  
**Impact:** Redeploy to different region = name collision = deployment failure.

**Fix:**
```bicep
name: toLower('${take(appName, 15)}${uniqueString(resourceGroup().id)}')
```

---

### 5. **Key Vault Name Length Violation**
**File:** `infra/main.bicep` (Line 17, 45)  
**Issue:** `take(names.keyvault, 24)` applied AFTER generation. If generated name is 30 chars, it truncates to invalid format.  
**Impact:** Name like `trading-platform-kv-dev-abc123` (30) → `trading-platform-kv-dev-` (24, trailing dash = invalid).

**Fix:**
```bicep
keyvault: take('${appName}-kv-${environment}-${uniqueSuffix}', 24)
// OR better:
keyvault: '${take(appName, 10)}-kv-${take(uniqueSuffix, 8)}'
```

---

### 6. **Missing Soft Delete Protection on Key Vault**
**File:** `infra/modules/keyvault.bicep` (Lines 4-16)  
**Issue:** No purge protection or soft delete configuration.  
**Impact:** Accidental deletion = permanent loss of all user API keys = catastrophic.

**Fix:**
```bicep
properties: {
  enableSoftDelete: true
  softDeleteRetentionInDays: 90
  enablePurgeProtection: true  // Cannot be disabled once enabled
  // ... rest
}
```

---

### 7. **Log Analytics Retention Too Short**
**File:** `infra/modules/containerapp.bicep` (Line 13)  
**Issue:** 30-day retention insufficient for compliance/debugging.  
**Impact:** Trading logs deleted before potential SEC/compliance audits.

**Fix:**
```bicep
retentionInDays: 90  // Minimum for financial services
```

---

## 🟡 HIGH PRIORITY IMPROVEMENTS

### 8. **Missing Tags for Cost Management**
**All modules**  
**Issue:** No resource tagging.  
**Impact:** Cannot track costs by environment/team/project.

**Fix:** Add to every resource:
```bicep
tags: {
  Environment: environment
  Project: 'TradingPlatform'
  ManagedBy: 'Bicep'
  CostCenter: 'Engineering'
}
```

---

### 9. **Hardcoded Database Name**
**File:** `infra/modules/cosmos.bicep` (Line 26)  
**Issue:** `'TradingPlatformDB'` is hardcoded.  
**Impact:** Cannot deploy multiple instances for testing.

**Fix:**
```bicep
param databaseName string = 'TradingPlatformDB'
```

---

### 10. **Missing Container Indexing Policies**
**File:** `infra/modules/cosmos.bicep` (Lines 44-58)  
**Issue:** Default indexing = all properties indexed = wasted RU/s.  
**Impact:** 30-40% higher query costs.

**Fix:**
```bicep
resource containerResources '...' = [for name in containers: {
  properties: {
    resource: {
      indexingPolicy: {
        automatic: true
        indexingMode: 'consistent'
        includedPaths: [
          { path: '/userId/*' }
          { path: '/status/*' }  // Only index queried fields
        ]
        excludedPaths: [
          { path: '/*' }  // Exclude everything else
        ]
      }
    }
  }
}]
```

---

### 11. **No Diagnostic Settings**
**All resource modules**  
**Issue:** No logs sent to Log Analytics for monitoring.  
**Impact:** Cannot debug production issues.

**Fix:** Add to each module:
```bicep
resource diagnosticSettings 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: '${resourceName}-diagnostics'
  scope: resourceName
  properties: {
    workspaceId: logAnalyticsWorkspaceId
    logs: [{ category: 'allLogs', enabled: true }]
    metrics: [{ category: 'AllMetrics', enabled: true }]
  }
}
```

---

### 12. **Missing Network Security**
**File:** `infra/modules/webpubsub.bicep` (Lines 16-18)  
**Issue:** `defaultAction: 'Allow'` = public internet access.  
**Impact:** Potential DDoS attack vector.

**Fix:**
```bicep
networkACLs: {
  defaultAction: 'Deny'
  publicNetwork: {
    allow: ['ClientConnection']  // Only allow WebSocket clients
    deny: ['ServerConnection']   // Block direct API access
  }
}
```

---

### 13. **Container App Scaling Rules Missing**
**File:** `infra/modules/containerapp.bicep` (Lines 66-69, 99-102)  
**Issue:** Only min/max replicas defined. No rules.  
**Impact:** Won't auto-scale based on load.

**Fix:**
```bicep
scale: {
  minReplicas: 1
  maxReplicas: 10
  rules: [
    {
      name: 'http-rule'
      http: {
        metadata: {
          concurrentRequests: '50'
        }
      }
    }
  ]
}
```

---

### 14. **Missing Health Probes**
**File:** `infra/modules/containerapp.bicep`  
**Issue:** No liveness/readiness probes.  
**Impact:** Unhealthy containers remain in rotation.

**Fix:**
```bicep
template: {
  containers: [{
    probes: [
      {
        type: 'liveness'
        httpGet: {
          path: '/health'
          port: 3000
        }
        initialDelaySeconds: 10
        periodSeconds: 10
      }
    ]
  }]
}
```

---

### 15. **Cosmos DB Backup Not Configured**
**File:** `infra/modules/cosmos.bicep`  
**Issue:** Relies on default periodic backup (30-day retention).  
**Impact:** Limited point-in-time recovery.

**Fix:**
```bicep
properties: {
  backupPolicy: {
    type: 'Continuous'  // 7-day continuous backup
    continuousModeProperties: {
      tier: 'Continuous7Days'
    }
  }
}
```

---

### 16. **Missing Cosmos DB Geo-Replication**
**File:** `infra/modules/cosmos.bicep` (Lines 10-15)  
**Issue:** Single region deployment.  
**Impact:** Regional outage = complete downtime.

**Fix:**
```bicep
locations: [
  { locationName: location, failoverPriority: 0, isZoneRedundant: true }
  { locationName: 'westus2', failoverPriority: 1, isZoneRedundant: false }
]
```

---

### 17. **Function App Missing Runtime Version**
**File:** `infra/modules/functions.bicep` (Line 36-37)  
**Issue:** `FUNCTIONS_WORKER_RUNTIME: 'node'` without version.  
**Impact:** Will use latest (potentially breaking changes).

**Fix:**
```bicep
{ name: 'FUNCTIONS_EXTENSION_VERSION', value: '~4' }
{ name: 'WEBSITE_NODE_DEFAULT_VERSION', value: '~20' }
```

---

### 18. **Missing CORS Configuration**
**File:** `infra/modules/containerapp.bicep`  
**Issue:** API Gateway has no CORS policy.  
**Impact:** Frontend in different domain = blocked requests.

**Fix:**
```bicep
configuration: {
  ingress: {
    corsPolicy: {
      allowedOrigins: ['https://yourdomain.com']
      allowedMethods: ['GET', 'POST', 'PUT', 'DELETE']
      allowCredentials: true
    }
  }
}
```

---

### 19. **No Parameter Validation**
**All modules**  
**Issue:** Missing `@minLength`, `@maxLength`, `@allowed` decorators.  
**Impact:** Invalid values cause cryptic deployment errors.

**Fix:**
```bicep
@minLength(3)
@maxLength(24)
param accountName string

@allowed(['dev', 'staging', 'prod'])
param environment string
```

---

## 🟢 BEST PRACTICE ENHANCEMENTS

### 20. **Add Deployment Scripts**
Create `infra/scripts/deploy.ps1`:
```powershell
az group create --name rg-trading-platform-prod --location eastus
az deployment group create \
  --resource-group rg-trading-platform-prod \
  --template-file main.bicep \
  --parameters environment=prod
```

---

### 21. **Add What-If Validation**
Update GitHub Actions workflow:
```yaml
- name: What-If
  run: |
    az deployment group what-if \
      --resource-group rg-trading-platform-prod \
      --template-file infra/main.bicep
```

---

### 22. **Extract Common Variables**
Create `infra/parameters/prod.bicepparam`:
```bicep
using './main.bicep'
param environment = 'prod'
param location = 'eastus'
```

---

## Priority Fix Order

1. **Fix #1-#2** (Identity/Output bugs) - Blocks deployment
2. **Fix #5** (Key Vault naming) - Production blocker
3. **Fix #6** (Soft delete) - Data loss risk
4. **Fix #3** (Cosmos throughput) - Cost optimization
5. **Fix #8** (Tags) - Governance requirement
6. **Fixes #11-#14** (Monitoring/Health) - Operational readiness

---

## Conclusion

**Overall Grade: B-** (70/100)
- Architecture: Excellent ✅
- Security: Good (after fixes) ✅
- Cost Optimization: Needs work ⚠️
- Operational Readiness: Poor ❌

Estimated time to address all issues: **4-6 hours**

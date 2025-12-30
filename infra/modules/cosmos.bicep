param accountName string
param location string
param tags object = {}

resource account 'Microsoft.DocumentDB/databaseAccounts@2023-11-15' = {
  name: accountName
  location: location
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    locations: [
      {
        locationName: location
        failoverPriority: 0
        isZoneRedundant: false
      }
    ]
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    disableLocalAuth: true
    backupPolicy: {
      type: 'Continuous'
      continuousModeProperties: {
         tier: 'Continuous7Days'
      }
    }
  }
  tags: tags
}

resource database 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2023-11-15' = {
  parent: account
  name: 'TradingPlatformDB'
  properties: {
    resource: {
      id: 'TradingPlatformDB'
    }
    options: {
      throughput: 400 // Shared throughput for cost optimization ($140 -> $25/mo)
    }
  }
  tags: tags
}

// Reusable container definition
var containers = [
  'Users'
  'Bots'
  'Orders'
  'MarketData'
  'Signals'
  'Metrics'
]

resource containerResources 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2023-11-15' = [for name in containers: {
  parent: database
  name: name
  properties: {
    resource: {
      id: name
        kind: 'Hash'
      }
      indexingPolicy: {
        automatic: true
        indexingMode: 'consistent'
        includedPaths: [
          { path: '/userId/?' }
          { path: '/status/?' }
        ]
        excludedPaths: [
          { path: '/*' }
        ]
      }
    }
  }
}]

output endpoint string = account.properties.documentEndpoint
output accountName string = account.name

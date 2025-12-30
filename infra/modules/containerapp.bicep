param environmentName string
param location string
param appConfigEndpoint string
param keyVaultName string
param tags object = {}

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: '${environmentName}-logs'
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 90 // Compliance requirement
  }
}

resource managedEnvironment 'Microsoft.App/managedEnvironments@2023-05-01' = {
  name: environmentName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
}

// API Gateway Container App
resource apiApp 'Microsoft.App/containerApps@2023-05-01' = {
  name: 'api-gateway'
  location: location
  tags: tags
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    managedEnvironmentId: managedEnvironment.id
    configuration: {
      ingress: {
        external: true
        targetPort: 3000
        corsPolicy: {
          allowedOrigins: ['*'] // Restrict in production
          allowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
          allowCredentials: true
        }
      }
      secrets: [
        // Secrets would be mounted here
      ]
    }
    template: {
      containers: [
        {
          name: 'api-gateway'
          image: 'mcr.microsoft.com/k8se/quickstart:latest' // Placeholder
          env: [
            {
              name: 'APP_CONFIG_ENDPOINT'
              value: appConfigEndpoint
            }
          ]
          resources: {
            cpu: json('0.5')
            memory: '1.0Gi'
          }
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 10
        rules: [
          {
            name: 'http-scaling-rule'
            http: {
              metadata: {
                concurrentRequests: '50'
              }
            }
          }
        ]
      }
    }
  }
}

// Bot Engine Container App
resource botApp 'Microsoft.App/containerApps@2023-05-01' = {
  name: 'bot-engine'
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    managedEnvironmentId: managedEnvironment.id
    configuration: {
      ingress: {
        external: false // Internal only
      }
    }
    template: {
      containers: [
        {
          name: 'bot-engine'
          image: 'mcr.microsoft.com/k8se/quickstart:latest' // Placeholder
          env: [
             {
               name: 'APP_CONFIG_ENDPOINT'
               value: appConfigEndpoint
             }
          ]
          resources: {
            cpu: json('1.0')
            memory: '2.0Gi'
          }
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 5
        rules: [
            {
                name: 'cpu-scaling-rule'
                custom: {
                    type: 'cpu'
                    metadata: {
                        type: 'Utilization'
                        value: '75'
                    }
                }
            }
        ]
      }
    }
  }
}
  }
}

output apiPrincipalId string = apiApp.identity.principalId
output botPrincipalId string = botApp.identity.principalId

targetScope = 'resourceGroup'

@description('Environment name (dev, prod)')
param environment string = 'dev'

@description('Azure region')
param location string = resourceGroup().location

@description('Application name prefix')
param appName string = 'trading-platform'

// Resource Naming Convention: {resourceType}-{app}-{env}-{region}-{instance}
// Example: cosmos-trading-platform-prod-eastus-001
var uniqueSuffix = uniqueString(resourceGroup().id)
var sanitizedAppName = toLower(appName)
var shortAppName = take(sanitizedAppName, 10) // Shorten for length-constrained resources

var names = {
  cosmos: 'cosmos-${sanitizedAppName}-${environment}-${uniqueSuffix}'
  webpubsub: 'wps-${sanitizedAppName}-${environment}-${uniqueSuffix}'
  servicebus: 'sb-${sanitizedAppName}-${environment}-${uniqueSuffix}'
  containerAppEnv: 'cae-${sanitizedAppName}-${environment}-${uniqueSuffix}'
  // KV limit is 24 chars: kv-{10chars}-{4chars}-{6chars} = 24
  keyvault: 'kv-${shortAppName}-${environment}-${take(uniqueSuffix, 6)}'
  appconfig: 'appcs-${sanitizedAppName}-${environment}-${uniqueSuffix}'
  functionApp: 'func-${sanitizedAppName}-${environment}-${uniqueSuffix}'
  monitoring: 'ai-${sanitizedAppName}-${environment}-${uniqueSuffix}'
}

var defaultTags = {
  Project: 'TradingTower'
  Environment: environment
  ManagedBy: 'Bicep'
  CostCenter: 'Engineering'
}

// 1. Cosmos DB (Core Persistence)
module cosmos 'modules/cosmos.bicep' = {
  name: 'cosmos-deploy'
  params: {
    accountName: names.cosmos
    location: location
    tags: defaultTags
  }
}

// 2. Web PubSub (Real-Time)
module webpubsub 'modules/webpubsub.bicep' = {
  name: 'webpubsub-deploy'
  params: {
    serviceName: names.webpubsub
    location: location
    sku: environment == 'prod' ? 'Standard_S1' : 'Free_F1'
    tags: defaultTags
  }
}

// 2.5. Service Bus (Event-Driven Entry Signals)
module servicebus 'modules/servicebus.bicep' = {
  name: 'servicebus-deploy'
  params: {
    namespaceName: names.servicebus
    location: location
    skuName: environment == 'prod' ? 'Standard' : 'Basic'
    tags: defaultTags
  }
}

// 3. Key Vault (Secrets)
module keyvault 'modules/keyvault.bicep' = {
  name: 'keyvault-deploy'
  params: {
    vaultName: names.keyvault
    location: location
    tags: defaultTags
  }
}

// 4. App Configuration (Dynamic Config)
module appconfig 'modules/appconfig.bicep' = {
  name: 'appconfig-deploy'
  params: {
    configStoreName: names.appconfig
    tags: defaultTags
  }
}

// 4.5. Monitoring (Application Insights)
module monitoring 'modules/monitoring.bicep' = {
  name: 'monitoring-deploy'
  params: {
    appName: names.monitoring
    location: location
    tags: defaultTags
  }
}

// 5. Container Apps Environment (Hosting Backend)
module containerApps 'modules/containerapp.bicep' = {
  name: 'containerapps-deploy'
  params: {
    environmentName: names.containerAppEnv
    location: location
    appConfigEndpoint: appconfig.outputs.endpoint
    keyVaultName: keyvault.outputs.name
    serviceBusConnectionString: servicebus.outputs.subscriberConnectionString
    tags: defaultTags
  }
}

// 6. Azure Functions (Webhooks)
module functions 'modules/functions.bicep' = {
  name: 'functions-deploy'
  params: {
    appName: names.functionApp
    location: location
    cosmosAccountName: cosmos.outputs.accountName
    serviceBusConnectionString: servicebus.outputs.publisherConnectionString
    tags: defaultTags
  }
}

// 7. Role Assignments (Connecting Identities to Permissions)
module roleAssignments 'modules/roles.bicep' = {
  name: 'roles-deploy'
  params: {
    apiPrincipalId: containerApps.outputs.apiPrincipalId
    botPrincipalId: containerApps.outputs.botPrincipalId
    functionPrincipalId: functions.outputs.functionPrincipalId
    cosmosAccountName: cosmos.outputs.accountName
    appConfigName: names.appconfig // using variable directly as resource already exists in same deployment
    keyVaultName: keyvault.outputs.name
    webPubSubName: names.webpubsub
    serviceBusNamespaceName: servicebus.outputs.namespaceName
  }
  dependsOn: [
    cosmos
    appconfig
    keyvault
    webpubsub
    servicebus
    containerApps
    functions
  ]
}

output cosmosEndpoint string = cosmos.outputs.endpoint
output webPubSubHostName string = webpubsub.outputs.hostName
output serviceBusNamespace string = servicebus.outputs.namespaceName

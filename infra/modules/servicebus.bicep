/**
 * Azure Service Bus Module
 * 
 * Creates a Service Bus namespace and topics for bot event streaming:
 * - trading-view-signals: TV signals from Azure Function
 * - indicator-signals: Indicator evaluation results
 */

@description('Azure region for Service Bus namespace')
param location string

@description('SKU name (Basic, Standard, Premium)')
param skuName string = 'Standard'

@description('Service Bus namespace name')
param namespaceName string

@description('Resource tags')
param tags object = {}

// Service Bus Namespace
resource serviceBusNs 'Microsoft.ServiceBus/namespaces@2021-11-01' = {
  name: namespaceName
  location: location
  sku: {
    name: skuName
    tier: skuName
  }
  tags: tags
  properties: {
    minimumTlsVersion: '1.2'
  }
}

// Topic: TradingView Signals
// Published by: Azure Function (receives TV webhook)
// Subscribed by: BotEngine (triggers entry)
resource tvSignalsTopic 'Microsoft.ServiceBus/namespaces/topics@2021-11-01' = {
  parent: serviceBusNs
  name: 'trading-view-signals'
  properties: {
    defaultMessageTimeToLive: 'PT5M'  // 5 minute TTL for signals
    maxMessageSizeInKilobytes: 256
    enablePartitioning: false
    enableExpress: false
  }
}

// Subscription: Bot Engine listens to TV signals
resource tvSignalsSubscription 'Microsoft.ServiceBus/namespaces/topics/subscriptions@2021-11-01' = {
  parent: tvSignalsTopic
  name: 'bot-engine'
  properties: {
    lockDuration: 'PT30S'
    requiresSession: false
    deadLetterOnMessageExpiration: true
    defaultMessageTimeToLive: 'PT5M'
  }
}

// Topic: Indicator Signals
// Published by: Indicator Service (evaluates conditions)
// Subscribed by: BotEngine (triggers entry)
resource indicatorSignalsTopic 'Microsoft.ServiceBus/namespaces/topics@2021-11-01' = {
  parent: serviceBusNs
  name: 'indicator-signals'
  properties: {
    defaultMessageTimeToLive: 'PT5M'  // 5 minute TTL for signals
    maxMessageSizeInKilobytes: 256
    enablePartitioning: false
    enableExpress: false
  }
}

// Subscription: Bot Engine listens to indicator signals
resource indicatorSignalsSubscription 'Microsoft.ServiceBus/namespaces/topics/subscriptions@2021-11-01' = {
  parent: indicatorSignalsTopic
  name: 'bot-engine'
  properties: {
    lockDuration: 'PT30S'
    requiresSession: false
    deadLetterOnMessageExpiration: true
    defaultMessageTimeToLive: 'PT5M'
  }
}

// Authorization Rule: Shared Access Policy for publishers (Azure Function, Indicator Service)
resource publisherAuthRule 'Microsoft.ServiceBus/namespaces/authorizationRules@2021-11-01' = {
  parent: serviceBusNs
  name: 'signal-publisher'
  properties: {
    rights: [
      'Send'
    ]
  }
}

// Authorization Rule: Shared Access Policy for subscribers (BotEngine)
resource subscriberAuthRule 'Microsoft.ServiceBus/namespaces/authorizationRules@2021-11-01' = {
  parent: serviceBusNs
  name: 'signal-subscriber'
  properties: {
    rights: [
      'Listen'
      'Manage'
    ]
  }
}

// Authorization Rule: Admin (for development/operations)
resource adminAuthRule 'Microsoft.ServiceBus/namespaces/authorizationRules@2021-11-01' = {
  parent: serviceBusNs
  name: 'admin'
  properties: {
    rights: [
      'Listen'
      'Manage'
      'Send'
    ]
  }
}

// Get connection strings for use in applications
output serviceBusNamespace string = serviceBusNs.name
output serviceBusHostname string = '${serviceBusNs.name}.servicebus.windows.net'

// Publisher connection string (for Azure Function and Indicator Service)
output publisherConnectionString string = listKeys(publisherAuthRule.id, '2021-11-01').primaryConnectionString

// Subscriber connection string (for BotEngine)
output subscriberConnectionString string = listKeys(subscriberAuthRule.id, '2021-11-01').primaryConnectionString

// Admin connection string (for operations/debugging)
output adminConnectionString string = listKeys(adminAuthRule.id, '2021-11-01').primaryConnectionString

// Topic names
output tvSignalsTopicName string = tvSignalsTopic.name
output indicatorSignalsTopicName string = indicatorSignalsTopic.name

param apiPrincipalId string
param botPrincipalId string
param functionPrincipalId string

// Resource Names used to scope the assignments
param cosmosAccountName string
param appConfigName string
param keyVaultName string
param webPubSubName string

// ------------------------------------------------------------------
// 1. Cosmos DB Role Assignments
// ------------------------------------------------------------------
resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2023-11-15' existing = {
  name: cosmosAccountName
}

// Built-in Role: 'Cosmos DB Built-in Data Contributor'
// ID: 00000000-0000-0000-0000-000000000002
var cosmosDataContributorRole = '00000000-0000-0000-0000-000000000002'

resource cosmosRoleDefinition 'Microsoft.DocumentDB/databaseAccounts/sqlRoleDefinitions@2023-11-15' existing = {
  parent: cosmosAccount
  name: cosmosDataContributorRole
}

// Assign to API Gateway
resource apiCosmosRole 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2023-11-15' = {
  parent: cosmosAccount
  name: guid(cosmosAccount.id, apiPrincipalId, cosmosDataContributorRole)
  properties: {
    roleDefinitionId: cosmosRoleDefinition.id
    principalId: apiPrincipalId
    scope: cosmosAccount.id
  }
}

// Assign to Bot Engine
resource botCosmosRole 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2023-11-15' = {
  parent: cosmosAccount
  name: guid(cosmosAccount.id, botPrincipalId, cosmosDataContributorRole)
  properties: {
    roleDefinitionId: cosmosRoleDefinition.id
    principalId: botPrincipalId
    scope: cosmosAccount.id
  }
}

// Assign to Functions
resource funcCosmosRole 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2023-11-15' = {
  parent: cosmosAccount
  name: guid(cosmosAccount.id, functionPrincipalId, cosmosDataContributorRole)
  properties: {
    roleDefinitionId: cosmosRoleDefinition.id
    principalId: functionPrincipalId
    scope: cosmosAccount.id
  }
}

// ------------------------------------------------------------------
// 2. App Configuration Role Assignments
// ------------------------------------------------------------------
resource appConfig 'Microsoft.AppConfiguration/configurationStores@2023-03-01' existing = {
  name: appConfigName
}

// Built-in Role: 'App Configuration Data Reader'
// ID: 516239f1-63e1-4d78-a4de-a74fb236a071
var appConfigDataReaderRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '516239f1-63e1-4d78-a4de-a74fb236a071')

resource apiConfigRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(appConfig.id, apiPrincipalId, 'AppConfigDataReader')
  scope: appConfig
  properties: {
    roleDefinitionId: appConfigDataReaderRole
    principalId: apiPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource botConfigRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(appConfig.id, botPrincipalId, 'AppConfigDataReader')
  scope: appConfig
  properties: {
    roleDefinitionId: appConfigDataReaderRole
    principalId: botPrincipalId
    principalType: 'ServicePrincipal'
  }
}

// ------------------------------------------------------------------
// 3. Key Vault Role Assignments
// ------------------------------------------------------------------
resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

// Built-in Role: 'Key Vault Secrets User' (Read-only access to secrets)
// ID: 4633458b-17de-408a-b874-0445c86b69e6
var keyVaultSecretsUserRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')

// Built-in Role: 'Key Vault Secrets Officer' (Read/Write/Delete/Manage secrets)
// ID: b86a8fe4-44ce-4948-aee5-eccb2c155cd7
var keyVaultSecretsOfficerRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7')

// API Gateway needs WRITE access to store user API keys
resource apiKeyVaultRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, apiPrincipalId, 'KeyVaultSecretsOfficer')
  scope: keyVault
  properties: {
    roleDefinitionId: keyVaultSecretsOfficerRole
    principalId: apiPrincipalId
    principalType: 'ServicePrincipal'
  }
}

// Bot Engine only needs READ access to use the keys
resource botKeyVaultRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, botPrincipalId, 'KeyVaultSecretsUser')
  scope: keyVault
  properties: {
    roleDefinitionId: keyVaultSecretsUserRole
    principalId: botPrincipalId
    principalType: 'ServicePrincipal'
  }
}

// ------------------------------------------------------------------
// 4. Web PubSub Role Assignments
// ------------------------------------------------------------------
resource webPubSub 'Microsoft.SignalRService/webPubSub@2023-02-01' existing = {
  name: webPubSubName
}

// Built-in Role: 'Web PubSub Service Owner' (Full access to service, including publish)
// ID: 12cf5a90-567b-43ae-8102-51f42277f6a9
var webPubSubOwnerRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '12cf5a90-567b-43ae-8102-51f42277f6a9')

resource apiWebPubSubRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(webPubSub.id, apiPrincipalId, 'WebPubSubOwner')
  scope: webPubSub
  properties: {
    roleDefinitionId: webPubSubOwnerRole
    principalId: apiPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource botWebPubSubRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(webPubSub.id, botPrincipalId, 'WebPubSubOwner')
  scope: webPubSub
  properties: {
    roleDefinitionId: webPubSubOwnerRole
    principalId: botPrincipalId
    principalType: 'ServicePrincipal'
  }
}

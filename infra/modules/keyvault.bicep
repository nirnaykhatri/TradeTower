@minLength(3)
@maxLength(24)
param vaultName string
param location string
param tags object = {}

resource keyvault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: vaultName
  location: location
  properties: {
    sku: {
      family: 'A'
      name: 'standard'
    }
    tenantId: subscription().tenantId
    accessPolicies: [] // Access policies managed by application identity in real deployment
    enableRbacAuthorization: true // Modern approach
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    enablePurgeProtection: true
  }
  tags: tags
}

output name string = keyvault.name
output vaultUri string = keyvault.properties.vaultUri

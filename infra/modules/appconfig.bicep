param configStoreName string
param location string
param tags object = {}

resource configStore 'Microsoft.AppConfiguration/configurationStores@2023-03-01' = {
  name: configStoreName
  location: location
  sku: {
    name: 'free'
  }
  properties: {
    disableLocalAuth: true
  }
  tags: tags
}

output endpoint string = configStore.properties.endpoint

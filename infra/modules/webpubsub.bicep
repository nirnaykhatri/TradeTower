param serviceName string
param location string
param sku string = 'Free_F1'
param tags object = {}

resource webpubsub 'Microsoft.SignalRService/webPubSub@2023-02-01' = {
  name: serviceName
  location: location
  sku: {
    name: sku
    capacity: 1
  }
  properties: {
    tls: {
      clientCertEnabled: false
    }
    networkACLs: {
      defaultAction: 'Deny'
      publicNetwork: {
        allow: ['ClientConnection'] // Only allow websocket clients
        deny: ['ServerConnection', 'RESTAPI'] // Block direct API access via public internet
      }
    }
    publicNetworkAccess: 'Enabled'
    disableLocalAuth: true
    disableAadAuth: false
  }
  tags: tags
}

output hostName string = webpubsub.properties.hostName

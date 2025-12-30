$ErrorActionPreference = "Stop"

Write-Host "🚀 Automating Secretless Azure AD App Registration: $AppName" -ForegroundColor Cyan

# Check for Azure CLI
if (-not (Get-Command "az" -ErrorAction SilentlyContinue)) {
    Write-Error "Azure CLI ('az') is required."
}

# 1. Create App Registration as a Public Client (SPA)
# Using --public-client-redirect-uris instead of --web-redirect-uris for secretless PKCE flow
Write-Host "1. Creating SPA App Registration..." -NoNewline
$app = az ad app create --display-name $AppName `
    --public-client-redirect-uris $ReplyUrl `
    --sign-in-audience AzureADandPersonalMicrosoftAccount `
    --query "{appId:appId, objectId:id}" -o json | ConvertFrom-Json

Write-Host "Done. (App ID: $($app.appId))" -ForegroundColor Green

# 2. Config App URI
Write-Host "2. Setting App URI..." -NoNewline
$appUri = "api://$($app.appId)"
az ad app update --id $app.objectId --identifier-uris $appUri
Write-Host "Done" -ForegroundColor Green

# 3. Enable Access & ID Tokens for SPA
Write-Host "3. Enabling Implicit/Hybrid flows for development ease..." -NoNewline
az ad app update --id $app.objectId --set "web={implicitGrantSettings={accessTokenIssuanceEnabled=true,idTokenIssuanceEnabled=true}}"
Write-Host "Done" -ForegroundColor Green

# 4. Create Service Principal
Write-Host "4. Creating Service Principal..." -NoNewline
az ad sp create --id $app.appId 2>$null | Out-Null
Write-Host "Done" -ForegroundColor Green

Write-Host "`n✅ Secretless Authentication Setup Complete!" -ForegroundColor Green
Write-Host "`n--------------------------------------------------" -ForegroundColor Yellow
Write-Host "   COPY THESE VALUES TO YOUR .env FILE" -ForegroundColor Yellow
Write-Host "--------------------------------------------------" -ForegroundColor Yellow
Write-Host "Note: No Client Secret is required for SPA/PKCE flow."
Write-Host "AZURE_AD_B2C_CLIENT_ID=$($app.appId)"
Write-Host "AZURE_AD_B2C_TENANT_ID=$(az account show --query tenantId -o tsv)"
Write-Host "NEXTAUTH_URL=http://localhost:3000"
Write-Host "NEXTAUTH_SECRET=$(New-Guid)"
Write-Host "--------------------------------------------------" -ForegroundColor Yellow

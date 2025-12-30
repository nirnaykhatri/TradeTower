param(
    [Parameter(Mandatory = $true)]
    [string]$SubscriptionId,

    [Parameter(Mandatory = $false)]
    [string]$Location = 'eastus',

    [Parameter(Mandatory = $false)]
    [string]$Environment = 'dev'
)

$ErrorActionPreference = "Stop"

# Configuration
$resourceGroupName = "rg-trading-platform-$Environment"
$deploymentName = "trading-platform-deploy-$(Get-Date -Format 'yyyyMMdd-HHmm')"

Write-Host "🚀 Starting deployment to Subscription: $SubscriptionId | RG: $resourceGroupName ($Location)..." -ForegroundColor Cyan

# 0. Dependencies Check
Write-Host "0. Checking Dependencies..." -NoNewline
# Check for Azure CLI
if (-not (Get-Command "az" -ErrorAction SilentlyContinue)) {
    Write-Error "`nAzure CLI ('az') is not installed. Please install it from https://aka.ms/installazurecliwindows"
}

# Check and Install Az Module
if (-not (Get-Module -ListAvailable -Name Az.Accounts)) {
    Write-Host "`nInstalling Azure PowerShell module (Az)..." -ForegroundColor Yellow
    Install-Module -Name Az -Scope CurrentUser -Repository PSGallery -Force -AllowClobber
}
Write-Host "Done" -ForegroundColor Green

# 0.5. Set Context
Write-Host "0.5. Setting Azure Subscription Context..." -NoNewline
try {
    Set-AzContext -SubscriptionId $SubscriptionId -ErrorAction Stop | Out-Null
    Write-Host "Done" -ForegroundColor Green
}
catch {
    Write-Error "Failed to set subscription context. Please ensure you are logged in (Connect-AzAccount) and have access to subscription $SubscriptionId."
}

# 1. Create Resource Group
Write-Host "1. Creating Resource Group..." -NoNewline
az group create --name $resourceGroupName --location $Location --subscription $SubscriptionId | Out-Null
Write-Host "Done" -ForegroundColor Green

# 2. Validate Template
Write-Host "2. Validating Bicep Template..." -NoNewline
$validation = az deployment group validate `
    --resource-group $resourceGroupName `
    --subscription $SubscriptionId `
    --template-file "../main.bicep" `
    --parameters environment=$Environment location=$Location `
    --query "error" -o json | ConvertFrom-Json

if ($validation) {
    Write-Error "Validation Failed: $($validation.message)"
}
Write-Host "Valid" -ForegroundColor Green

# 3. Deploy
Write-Host "3. Deploying Infrastructure (this may take 10-15 mins)..."
az deployment group create `
    --name $deploymentName `
    --resource-group $resourceGroupName `
    --subscription $SubscriptionId `
    --template-file "../main.bicep" `
    --parameters environment=$Environment location=$Location `
    --output table

Write-Host "✅ Deployment Complete!" -ForegroundColor Green

# 3.5. Setup Authentication (Automated App Registration)
Write-Host "`n3.5. Configuring Authentication..." -ForegroundColor Cyan
try {
    & "$PSScriptRoot/setup-auth.ps1" -AppName "TradingTower-$Environment"
}
catch {
    Write-Warning "Authentication setup encountered issues. You may need to run setup-auth.ps1 manually."
}

# 4. Display Outputs
$outputs = az deployment group show `
    --name $deploymentName `
    --resource-group $resourceGroupName `
    --subscription $SubscriptionId `
    --query "properties.outputs" -o json | ConvertFrom-Json

Write-Host "`n---------- DEPLOYMENT OUTPUTS ----------" -ForegroundColor Yellow
Write-Host "Cosmos Endpoint: $($outputs.cosmosEndpoint.value)"
Write-Host "Web PubSub Host: $($outputs.webPubSubHostName.value)"
Write-Host "----------------------------------------"

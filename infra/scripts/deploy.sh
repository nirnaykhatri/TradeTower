#!/bin/bash
set -e

# Default values
LOCATION="eastus"
ENVIRONMENT="dev"
SUBSCRIPTION_ID=""

# Parse arguments
while getopts "s:l:e:" opt; do
  case $opt in
    s) SUBSCRIPTION_ID="$OPTARG"
    ;;
    l) LOCATION="$OPTARG"
    ;;
    e) ENVIRONMENT="$OPTARG"
    ;;
    \?) echo "Invalid option -$OPTARG" >&2
    exit 1
    ;;
  esac
done

if [ -z "$SUBSCRIPTION_ID" ]; then
    echo "Error: Subscription ID (-s) is required."
    echo "Usage: ./deploy.sh -s <subscription_id> [-l <location>] [-e <environment>]"
    exit 1
fi

# Configuration
RESOURCE_GROUP="rg-trading-platform-$ENVIRONMENT"
DEPLOYMENT_NAME="trading-platform-deploy-$(date +%Y%m%d-%H%M)"

echo "🚀 Starting deployment to Subscription: $SUBSCRIPTION_ID | RG: $RESOURCE_GROUP ($LOCATION)..."

# 0. Set Context
echo "0. Setting Azure Subscription Context..."
az account set --subscription $SUBSCRIPTION_ID

# 1. Create Resource Group
echo -n "1. Creating Resource Group... "
az group create --name $RESOURCE_GROUP --location $LOCATION --subscription $SUBSCRIPTION_ID > /dev/null
echo "Done"

# 2. Validate Template
echo -n "2. Validating Bicep Template... "
az deployment group validate \
    --resource-group $RESOURCE_GROUP \
    --subscription $SUBSCRIPTION_ID \
    --template-file "../main.bicep" \
    --parameters environment=$ENVIRONMENT location=$LOCATION > /dev/null
echo "Valid"

# 3. Deploy
echo "3. Deploying Infrastructure (this may take 10-15 mins)..."
az deployment group create \
    --name $DEPLOYMENT_NAME \
    --resource-group $RESOURCE_GROUP \
    --subscription $SUBSCRIPTION_ID \
    --template-file "../main.bicep" \
    --parameters environment=$ENVIRONMENT location=$LOCATION \
    --output table

echo "✅ Infrastructure Deployment Complete!"

# 3.5 Setup Authentication
echo "3.5. Configuring Authentication..."
if command -v pwsh &> /dev/null; then
    pwsh -File "./infra/scripts/setup-auth.ps1" -AppName "TradingTower-$ENVIRONMENT"
else
    echo "WARNING: PowerShell (pwsh) not found. Skipping auth setup. Please run setup-auth.ps1 manually."
fi

# 4. Display Outputs
echo ""
echo "---------- DEPLOYMENT OUTPUTS ----------"
az deployment group show \
    --name $DEPLOYMENT_NAME \
    --resource-group $RESOURCE_GROUP \
    --query "properties.outputs" -o table
echo "----------------------------------------"

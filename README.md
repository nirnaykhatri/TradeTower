# Multi-Tenant Trading Bot Platform 🤖📈

An enterprise-grade, Azure-native trading bot platform that allows users to run automated trading strategies (Grid, DCA, BTD, Combo, Loop, Futures) on multiple exchanges simultaneously.

## 🏗 Architecture

The platform is designed as a microservices architecture on Azure, ensuring scalability, security, and logical user isolation.

### Core Components

*   **API Gateway** (`/api`): Node.js/Express service handling REST requests, authentication (Azure AD B2C), and user context.
*   **Bot Engine** (`/bots`): Background worker executing trading strategies in parallel.
*   **Real-Time Layer** (`/real-time`): Powered by Azure Web PubSub for instant frontend updates.
*   **Frontend** (`/frontend`): Next.js 14 application with real-time dashboards.
*   **Database** (`/db`): Azure Cosmos DB (NoSQL) with strict `/userId` partitioning.

### 🌐 Infrastructure (Azure Native)

*   **Compute**: Azure Container Apps (API + Bot Engine) & Azure Functions (Webhooks)
*   **Storage**: Azure Cosmos DB
*   **Security**: Azure Key Vault (API Keys) & Azure AD B2C (Identity)
*   **Config**: Azure App Configuration
*   **Real-Time**: Azure Web PubSub

## 🚀 Strategies Supported

1.  **Grid Trading**: Profiting from volatility in sideways markets.
2.  **DCA (Dollar Cost Averaging)**: Accumulating assets at better average prices.
3.  **BTD (Buy The Dip)**: Optimized entry during market pullbacks.
4.  **Combo**: Advanced hybrid strategies.
5.  **Loop**: Continuous high-frequency loops.
6.  **DCA Futures**: Leveraged DCA strategies.

## 🛠 Project Structure

```bash
├── api/            # API Gateway Service
├── bots/           # Bot Engine & Strategy Logic
├── connectors/     # Exchange Integration Factory
├── db/             # Cosmos DB Data Access Layer
├── frontend/       # Next.js Web Application
├── infra/          # Azure Bicep Infrastructure Templates
├── realtime/       # Web PubSub Handlers
├── services/       # Microservices (Market Data, Analytics)
└── webhook/        # TradingView Webhook Receiver (Azure Function)
```

## 🔒 Security & Isolation

*   **Logical Isolation**: All data in Cosmos DB is partitioned by `userId`.
*   **Secret Management**: User exchange API keys are encrypted and stored in Azure Key Vault, never in the DB.
*   **Authentication**: Secure JWT flow via Azure AD B2C.

## 📦 Getting Started

1.  **Prerequisites**: Azure Subscription, Node.js 20+, Docker.
2.  **Deployment**: Infrastructure is defined in `infra/` using Bicep. Deploy via GitHub Actions.
3.  **Local Dev**: See individual folder READMEs for local startup instructions.

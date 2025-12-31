import express, { Express, Router } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { Server as HttpServer } from 'http';
import { config } from './config/env';
import { logger } from './services/logger';
import { requireUserContext } from './middleware/userContext';
import { errorHandler } from './middleware/errorHandler';
import { AppError } from './utils/error';
import exchangeRoutes from './routes/exchangeRoutes';
import authRoutes from './routes/authRoutes';
import botRoutes from './routes/botRoutes';
import orderRoutes from './routes/orderRoutes';
import performanceRoutes from './routes/performanceRoutes';
import { appConfigManager } from './config/appConfig';
import { dbService } from './services/db/CosmosService';

export class App {
    public app: Express;
    private server?: HttpServer;

    constructor() {
        this.app = express();
        this.setupMiddleware();
        this.setupRoutes();
        this.setupErrorHandling();
    }

    private setupMiddleware() {
        this.app.use(helmet());
        this.app.use(cors({ origin: config.get('NEXTAUTH_URL') || '*' }));
        this.app.use(morgan('tiny')); // TODO: Connect to LoggerService stream
        this.app.use(express.json({ limit: '10mb' })); // Fix High Issue 8
    }

    private setupRoutes() {
        // Public
        this.app.get('/health', (req, res) => {
            res.status(200).json({ status: 'healthy', version: '1.0.0' });
        });

        // Protected API Routes
        const apiRouter = Router();
        apiRouter.use(requireUserContext);

        // Mount Domain Routes
        apiRouter.use('/v1/auth', authRoutes);
        apiRouter.use('/v1/exchanges', exchangeRoutes);
        apiRouter.use('/v1/bots', botRoutes);
        apiRouter.use('/v1/orders', orderRoutes);
        apiRouter.use('/v1/metrics', performanceRoutes);

        this.app.use('/api', apiRouter);

        // 404 Handler (Fix High Issue 6)
        this.app.all('*', (req, res, next) => {
            next(new AppError(404, `Route ${req.originalUrl} not found`));
        });
    }

    private setupErrorHandling() {
        this.app.use(errorHandler);
    }

    public async start(): Promise<void> {
        // 1. Load Dynamic Config from Azure
        const azureConfig = await appConfigManager.loadConfiguration();
        config.reload(azureConfig);

        // 2. Initialize Database Connection (Fix P0 Issue: Fail early if DB is down)
        await dbService.connect();

        // 3. Validate Env (Re-run validation now that we have potential Azure values)

        const port = config.get('PORT');
        this.server = this.app.listen(port, () => {
            logger.info(`🚀 Server running on port ${port}`);
        });

        this.setupGracefulShutdown();
    }

    private setupGracefulShutdown() {
        // Fix High Issue 7
        const shutdown = async (signal: string) => {
            logger.info(`${signal} received. Shutting down gracefully...`);
            this.server?.close(() => {
                logger.info('HTTP server closed.');
                process.exit(0);
            });

            // Force close after 10s
            setTimeout(() => {
                logger.error('Could not close connections in time, forcefully shutting down');
                process.exit(1);
            }, 10000);
        };

        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));

        // Unhandled Rejections (Fix High Issue 5)
        process.on('unhandledRejection', (err: Error) => {
            logger.error('UNHANDLED REJECTION! 💥 Shutting down...', err);
            shutdown('UNHANDLED_REJECTION');
        });
    }
}

// Start instance
if (require.main === module) {
    const app = new App();
    app.start();
}

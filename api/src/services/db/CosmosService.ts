import { CosmosClient, Database } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';
import { config } from '../../config/env';
import { logger } from '../logger';
import { AppError } from '../../utils/error';

export class DatabaseService {
    private static instance: DatabaseService;
    private client: CosmosClient;
    private database: Database | null = null;
    private dbName: string;

    private constructor() {
        const endpoint = config.get('COSMOS_DB_ENDPOINT');
        this.dbName = config.get('COSMOS_DB_NAME') || 'TradingTowerDB';

        if (!endpoint) {
            throw new AppError(500, 'COSMOS_DB_ENDPOINT is not configured');
        }

        try {
            const credential = new DefaultAzureCredential();
            this.client = new CosmosClient({ endpoint, aadCredentials: credential });
            logger.info(`🌌 DatabaseService initialized with endpoint: ${endpoint}`);
        } catch (error) {
            logger.error('Failed to initialize DatabaseService', error);
            throw new AppError(500, 'Failed to connect to Database');
        }
    }

    public static getInstance(): DatabaseService {
        if (!DatabaseService.instance) {
            DatabaseService.instance = new DatabaseService();
        }
        return DatabaseService.instance;
    }

    /**
     * Initializes the database connection and ensures the DB exists.
     */
    public async connect(): Promise<void> {
        try {
            const { database } = await this.client.databases.createIfNotExists({ id: this.dbName });
            this.database = database;
            logger.info(`✅ Successfully connected to Cosmos DB: ${this.dbName}`);
        } catch (error) {
            logger.error(`Failed to connect to database ${this.dbName}`, error);
            throw new AppError(500, 'Database connection failed');
        }
    }

    /**
     * Returns a handle to a specific container, ensuring it exists.
     */
    public async getContainer(containerName: string, partitionKeyPath: string = '/userId') {
        if (!this.database) {
            await this.connect();
        }

        try {
            const { container } = await this.database!.containers.createIfNotExists({
                id: containerName,
                partitionKey: { paths: [partitionKeyPath] }
            });
            return container;
        } catch (error) {
            logger.error(`Failed to get/create container: ${containerName}`, error);
            throw new AppError(500, `Database container error: ${containerName}`);
        }
    }
}

export const dbService = DatabaseService.getInstance();

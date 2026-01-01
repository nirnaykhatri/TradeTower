import { CosmosClient, Database, Container } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';
import { DatabaseError, withRetry, DEFAULT_RETRY_POLICIES } from '../errors';
import { validateRequired } from '../utils/validation';

/**
 * Database configuration interface
 */
export interface DatabaseConfig {
    endpoint: string;
    databaseName: string;
    maxRetries?: number;
    retryIntervalMs?: number;
}

/**
 * Database service for Cosmos DB operations
 * Uses dependency injection pattern instead of singleton
 */
export class DatabaseService {
    private client: CosmosClient | null = null;
    private database: Database | null = null;
    private readonly config: DatabaseConfig;

    /**
     * Creates a new DatabaseService instance
     * @param config Database configuration
     */
    constructor(config?: Partial<DatabaseConfig>) {
        this.config = {
            endpoint: config?.endpoint || process.env.COSMOS_DB_ENDPOINT || '',
            databaseName: config?.databaseName || process.env.COSMOS_DB_NAME || 'TradingTowerDB',
            maxRetries: config?.maxRetries || 3,
            retryIntervalMs: config?.retryIntervalMs || 1000
        };
    }

    /**
     * Establishes connection to Cosmos DB
     * @throws {DatabaseError} If connection fails after retries
     */
    public async connect(): Promise<void> {
        if (this.database) return;

        validateRequired(this.config.endpoint, 'COSMOS_DB_ENDPOINT');

        try {
            await withRetry(
                async () => {
                    const credential = new DefaultAzureCredential();
                    this.client = new CosmosClient({
                        endpoint: this.config.endpoint,
                        aadCredentials: credential,
                        connectionPolicy: {
                            requestTimeout: 10000,
                            enableEndpointDiscovery: true,
                            retryOptions: {
                                maxRetryAttemptCount: this.config.maxRetries!,
                                fixedRetryIntervalInMilliseconds: this.config.retryIntervalMs
                            }
                        }
                    });

                    const { database } = await this.client.databases.createIfNotExists({
                        id: this.config.databaseName
                    });
                    this.database = database;
                    console.log(`[DatabaseService] Connected to ${this.config.databaseName}`);
                },
                DEFAULT_RETRY_POLICIES.DATABASE_ERROR,
                'Database connection'
            );
        } catch (error) {
            const dbError = new DatabaseError(
                'Failed to connect to database after retries',
                error as Error
            );
            console.error('[DatabaseService] Connection failed:', dbError);
            throw dbError;
        }
    }

    /**
     * Gets or creates a container in the database
     * @param containerName Name of the container
     * @param partitionKeyPath Partition key path (default: '/userId')
     * @returns Container instance
     * @throws {DatabaseError} If container creation fails
     */
    public async getContainer(
        containerName: string,
        partitionKeyPath: string = '/userId'
    ): Promise<Container> {
        validateRequired(containerName, 'containerName');

        if (!this.database) {
            await this.connect();
        }

        if (!this.database) {
            throw new DatabaseError('Database not connected');
        }

        try {
            return await withRetry(
                async () => {
                    const { container } = await this.database!.containers.createIfNotExists({
                        id: containerName,
                        partitionKey: { paths: [partitionKeyPath] }
                    });
                    return container;
                },
                DEFAULT_RETRY_POLICIES.DATABASE_ERROR,
                `Get container: ${containerName}`
            );
        } catch (error) {
            throw new DatabaseError(
                `Failed to get container: ${containerName}`,
                error as Error
            );
        }
    }

    /**
     * Disconnects from the database
     */
    public async disconnect(): Promise<void> {
        if (this.client) {
            this.client.dispose();
            this.client = null;
            this.database = null;
            console.log('[DatabaseService] Disconnected');
        }
    }

    /**
     * Checks if the service is connected
     */
    public isConnected(): boolean {
        return this.database !== null;
    }
}

/**
 * Default database service instance
 * Can be replaced with custom configuration via dependency injection
 */
export const dbService = new DatabaseService();

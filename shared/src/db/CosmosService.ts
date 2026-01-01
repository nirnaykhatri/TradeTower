import { CosmosClient, Database } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';

export class DatabaseService {
    private static instance: DatabaseService;
    private client: CosmosClient | null = null;
    private database: Database | null = null;
    private dbName: string = process.env.COSMOS_DB_NAME || 'TradingTowerDB';

    private constructor() { }

    public static getInstance(): DatabaseService {
        if (!DatabaseService.instance) {
            DatabaseService.instance = new DatabaseService();
        }
        return DatabaseService.instance;
    }

    public async connect(): Promise<void> {
        if (this.database) return;

        const endpoint = process.env.COSMOS_DB_ENDPOINT;
        if (!endpoint) {
            console.warn('[DatabaseService] COSMOS_DB_ENDPOINT not found. DB features will be disabled.');
            return;
        }

        try {
            const credential = new DefaultAzureCredential();
            this.client = new CosmosClient({ endpoint, aadCredentials: credential });
            const { database } = await this.client.databases.createIfNotExists({ id: this.dbName });
            this.database = database;
            console.log(`[DatabaseService] Connected to ${this.dbName}`);
        } catch (error) {
            console.error('[DatabaseService] Connection failed:', error);
        }
    }

    public async getContainer(containerName: string, partitionKeyPath: string = '/userId') {
        if (!this.database) {
            await this.connect();
        }

        if (!this.database) {
            throw new Error('Database not connected');
        }

        const { container } = await this.database.containers.createIfNotExists({
            id: containerName,
            partitionKey: { paths: [partitionKeyPath] }
        });
        return container;
    }
}

export const dbService = DatabaseService.getInstance();

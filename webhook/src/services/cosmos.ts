import { CosmosClient, Container } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';

export class CosmosService {
    private static instance: CosmosService;
    private client: CosmosClient;
    private dbName: string;

    private containers: Map<string, Container> = new Map();

    private constructor() {
        const endpoint = process.env.COSMOS_DB_ENDPOINT;
        this.dbName = process.env.COSMOS_DB_NAME || 'TradingTowerDB';

        if (!endpoint) {
            throw new Error('COSMOS_DB_ENDPOINT is not configured');
        }

        const credential = new DefaultAzureCredential();
        this.client = new CosmosClient({ endpoint, aadCredentials: credential });
    }

    public static getInstance(): CosmosService {
        if (!CosmosService.instance) {
            CosmosService.instance = new CosmosService();
        }
        return CosmosService.instance;
    }

    public getContainer(containerName: string): Container {
        let container = this.containers.get(containerName);
        if (!container) {
            container = this.client.database(this.dbName).container(containerName);
            this.containers.set(containerName, container);
        }
        return container;
    }
}

export const dbService = CosmosService.getInstance();

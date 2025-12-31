import { Container, ItemDefinition } from '@azure/cosmos';
import { dbService } from './CosmosService';

export class BaseRepository<T extends ItemDefinition> {
    protected containerPromise: Promise<Container>;

    constructor(containerName: string) {
        this.containerPromise = dbService.getContainer(containerName);
    }

    public async upsert(item: T): Promise<T> {
        const container = await this.containerPromise;
        const { resource } = await container.items.upsert(item);
        return resource as unknown as T;
    }

    public async getById(id: string, userId: string): Promise<T | null> {
        const container = await this.containerPromise;
        try {
            const { resource } = await container.item(id, userId).read();
            return (resource as unknown as T) || null;
        } catch (error: any) {
            if (error.code === 404) return null;
            throw error;
        }
    }

    public async delete(id: string, userId: string): Promise<void> {
        const container = await this.containerPromise;
        await container.item(id, userId).delete();
    }

    public async query(querySpec: string | { query: string; parameters?: any[] }, options?: any): Promise<T[]> {
        const container = await this.containerPromise;
        // fetchAll() is fine for small results, but for pagination we might want to return the iterator or handle tokens
        const { resources } = await container.items.query<T>(querySpec, options).fetchAll();
        return resources;
    }

    public async getAllByUserId(userId: string): Promise<T[]> {
        return this.query({
            query: 'SELECT * FROM c WHERE c.userId = @userId',
            parameters: [{ name: '@userId', value: userId }]
        });
    }
}

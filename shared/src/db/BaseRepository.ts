import { Container, ItemDefinition } from '@azure/cosmos';
import { DatabaseService } from './CosmosService';
import { validateRequired, validateQueryParams } from '../utils/validation';
import { DatabaseError, NotFoundError, withRetry, DEFAULT_RETRY_POLICIES } from '../errors';

/**
 * Base repository providing generic CRUD operations for Cosmos DB
 * @template T The type of entity managed by this repository
 */
export class BaseRepository<T extends ItemDefinition> {
    protected containerPromise: Promise<Container>;

    /**
     * Creates a new repository instance
     * @param containerName Name of the Cosmos DB container
     * @param dbService Optional database service (for dependency injection)
     */
    constructor(
        protected containerName: string,
        private dbService: DatabaseService
    ) {
        validateRequired(containerName, 'containerName');
        validateRequired(dbService, 'dbService');
        this.containerPromise = dbService.getContainer(containerName);
    }

    /**
     * Insert or update an item
     * @param item The item to upsert
     * @returns The upserted item
     * @throws {DatabaseError} If the operation fails
     */
    public async upsert(item: T): Promise<T> {
        validateRequired(item, 'item');
        validateRequired((item as any).id, 'item.id');

        try {
            return await withRetry(
                async () => {
                    const container = await this.containerPromise;
                    const { resource } = await container.items.upsert(item);
                    return resource as unknown as T;
                },
                DEFAULT_RETRY_POLICIES.DATABASE_ERROR,
                `Upsert item in ${this.containerName}`
            );
        } catch (error) {
            throw new DatabaseError(
                `Failed to upsert item in ${this.containerName}`,
                error as Error
            );
        }
    }

    /**
     * Get an item by ID
     * @param id The item ID
     * @param userId The partition key (userId)
     * @returns The item or null if not found
     * @throws {DatabaseError} If the operation fails (other than not found)
     */
    public async getById(id: string, userId: string): Promise<T | null> {
        validateRequired(id, 'id');
        validateRequired(userId, 'userId');

        try {
            return await withRetry(
                async () => {
                    const container = await this.containerPromise;
                    try {
                        const { resource } = await container.item(id, userId).read();
                        return (resource as unknown as T) || null;
                    } catch (error: any) {
                        if (error.code === 404) return null;
                        throw error;
                    }
                },
                DEFAULT_RETRY_POLICIES.DATABASE_ERROR,
                `Get item ${id} from ${this.containerName}`
            );
        } catch (error) {
            throw new DatabaseError(
                `Failed to get item ${id} from ${this.containerName}`,
                error as Error
            );
        }
    }

    /**
     * Delete an item
     * @param id The item ID
     * @param userId The partition key (userId)
     * @throws {NotFoundError} If the item doesn't exist
     * @throws {DatabaseError} If the operation fails
     */
    public async delete(id: string, userId: string): Promise<void> {
        validateRequired(id, 'id');
        validateRequired(userId, 'userId');

        try {
            await withRetry(
                async () => {
                    const container = await this.containerPromise;
                    await container.item(id, userId).delete();
                },
                DEFAULT_RETRY_POLICIES.DATABASE_ERROR,
                `Delete item ${id} from ${this.containerName}`
            );
        } catch (error: any) {
            if (error.code === 404) {
                throw new NotFoundError(this.containerName, id);
            }
            throw new DatabaseError(
                `Failed to delete item ${id} from ${this.containerName}`,
                error as Error
            );
        }
    }

    /**
     * Execute a query
     * @param querySpec SQL query string or query specification
     * @param options Query options
     * @returns Array of matching items
     * @throws {DatabaseError} If the query fails
     */
    public async query(
        querySpec: string | { query: string; parameters?: any[] },
        options?: any
    ): Promise<T[]> {
        validateRequired(querySpec, 'querySpec');

        // Validate query parameters if provided
        if (typeof querySpec === 'object' && querySpec.parameters) {
            const params: { [key: string]: any } = {};
            querySpec.parameters.forEach(p => params[p.name] = p.value);
            validateQueryParams(params);
        }

        try {
            return await withRetry(
                async () => {
                    const container = await this.containerPromise;
                    const { resources } = await container.items.query<T>(querySpec, options).fetchAll();
                    return resources;
                },
                DEFAULT_RETRY_POLICIES.DATABASE_ERROR,
                `Query ${this.containerName}`
            );
        } catch (error) {
            throw new DatabaseError(
                `Failed to query ${this.containerName}`,
                error as Error
            );
        }
    }

    /**
     * Get all items for a specific user
     * @param userId The user ID (partition key)
     * @returns Array of user's items
     */
    public async getAllByUserId(userId: string): Promise<T[]> {
        validateRequired(userId, 'userId');

        return this.query({
            query: 'SELECT * FROM c WHERE c.userId = @userId',
            parameters: [{ name: '@userId', value: userId }]
        });
    }

    /**
     * Update an existing item
     * @param id The item ID
     * @param userId The partition key (userId)
     * @param patch Partial update object
     * @returns The updated item
     * @throws {NotFoundError} If the item doesn't exist
     * @throws {DatabaseError} If the operation fails
     */
    public async update(id: string, userId: string, patch: Partial<T>): Promise<T> {
        validateRequired(id, 'id');
        validateRequired(userId, 'userId');
        validateRequired(patch, 'patch');

        const existing = await this.getById(id, userId);
        if (!existing) {
            throw new NotFoundError(this.containerName, id);
        }

        const updated = { ...existing, ...patch };
        return this.upsert(updated);
    }

    /**
     * Find items by a specific field value
     * @param field Field name to search
     * @param value Value to match
     * @returns Array of matching items
     */
    public async findBy(field: string, value: any): Promise<T[]> {
        validateRequired(field, 'field');
        validateRequired(value, 'value');

        return this.query({
            query: `SELECT * FROM c WHERE c.${field} = @value`,
            parameters: [{ name: '@value', value }]
        });
    }
}

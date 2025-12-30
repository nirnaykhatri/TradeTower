import { SecretClient } from '@azure/keyvault-secrets';
import { DefaultAzureCredential } from '@azure/identity';
import { ISecretManager } from './ISecretManager';
import { config } from '../../config/env';
import { logger } from '../logger';
import { AppError } from '../../utils/error';

export class KeyVaultService implements ISecretManager {
    private client: SecretClient;
    private static instance: KeyVaultService;

    // Supports Dependency Injection for testing
    constructor(client?: SecretClient) {
        this.client = client ?? this.createDefaultClient();
    }

    private createDefaultClient(): SecretClient {
        const vaultUrl = config.get('KEY_VAULT_URL');
        if (!vaultUrl) {
            throw new AppError(500, 'KEY_VAULT_URL is not configured');
        }
        try {
            const credential = new DefaultAzureCredential();
            const client = new SecretClient(vaultUrl, credential);
            logger.info(`🔐 KeyVaultService initialized with URL: ${vaultUrl}`);
            return client;
        } catch (error) {
            logger.error('Failed to initialize KeyVaultService', error);
            throw new AppError(500, 'Failed to connect to Key Vault');
        }
    }

    public static getInstance(): KeyVaultService {
        if (!KeyVaultService.instance) {
            KeyVaultService.instance = new KeyVaultService();
        }
        return KeyVaultService.instance;
    }

    /**
     * Sets a secret in Key Vault.
     * Enforces naming conventions and handles errors.
     */
    public async setSecret(name: string, value: string): Promise<void> {
        try {
            await this.client.setSecret(name, value);
            logger.info(`Secret set successfully: ${name}`);
        } catch (error: any) {
            logger.error(`Failed to set secret: ${name}`, error);
            throw new AppError(500, 'Failed to save exchange keys to secure storage');
        }
    }

    /**
     * Retrieves a secret.
     * Returns null if not found (instead of throwing).
     */
    public async getSecret(name: string): Promise<string | null> {
        try {
            const secret = await this.client.getSecret(name);
            return secret.value || null;
        } catch (error: any) {
            if (error.code === 'SecretNotFound') {
                logger.warn(`Secret not found: ${name}`);
                return null;
            }
            logger.error(`Failed to retrieve secret: ${name}`, error);
            // We don't throw here to avoid exposing system details, unless critical
            return null;
        }
    }

    /**
     * Deletes a secret (Soft Delete enabled in Infrastructure).
     */
    public async deleteSecret(name: string): Promise<void> {
        try {
            const deletePoller = await this.client.beginDeleteSecret(name);
            await deletePoller.pollUntilDone();
            logger.info(`Secret deleted: ${name}`);
        } catch (error: any) {
            if (error.code === 'SecretNotFound') {
                return; // Idempotent
            }
            logger.error(`Failed to delete secret: ${name}`, error);
            throw new AppError(500, 'Failed to remove exchange keys');
        }
    }
}

export const secretManager = KeyVaultService.getInstance();

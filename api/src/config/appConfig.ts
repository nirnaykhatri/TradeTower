import { AppConfigurationClient } from '@azure/app-configuration';
import { DefaultAzureCredential } from '@azure/identity';

import { logger } from '../services/logger';

export class AppConfigService {
    private client: AppConfigurationClient | null = null;
    private static instance: AppConfigService;

    private constructor() {
        // FIX: Use process.env directly to avoid circular dependency on env.ts
        const endpoint = process.env.APP_CONFIG_ENDPOINT;

        if (endpoint) {
            try {
                const credential = new DefaultAzureCredential();
                this.client = new AppConfigurationClient(endpoint, credential);
                logger.info(`🌐 AppConfigService initialized with endpoint: ${endpoint}`);
            } catch (error) {
                logger.error('Failed to initialize AppConfigService', error);
            }
        } else {
            logger.warn('APP_CONFIG_ENDPOINT not set. Using local environment variables only.');
        }
    }

    public static getInstance(): AppConfigService {
        if (!AppConfigService.instance) {
            AppConfigService.instance = new AppConfigService();
        }
        return AppConfigService.instance;
    }

    /**
     * Loads configuration settings from Azure App Configuration with retry logic.
     * Returns a map of key-values to be merged into the config.
     */
    public async loadConfiguration(retries = 3): Promise<Record<string, string>> {
        if (!this.client) {
            logger.warn('App Config Client not initialized, returning empty config.');
            return {};
        }

        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                return await this.fetchConfiguration();
            } catch (error) {
                logger.warn(`Failed to fetch Azure App Config (Attempt ${attempt}/${retries})`);
                if (attempt === retries) {
                    logger.error('Azure App Config failed after retries', error);
                    return {}; // Fail open => use defaults
                }
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // Exponential backoff-ish
            }
        }
        return {};
    }

    private async fetchConfiguration(): Promise<Record<string, string>> {
        if (!this.client) return {};

        const configOverrides: Record<string, string> = {};
        const settings = this.client.listConfigurationSettings({ keyFilter: '*' });

        logger.info('Fetching configuration from Azure...');
        for await (const setting of settings) {
            if (setting.key && setting.value) {
                configOverrides[setting.key] = setting.value;
                logger.debug(`Loaded config: ${setting.key}`);
            }
        }
        logger.info('Azure App Configuration loaded successfully.');
        return configOverrides;
    }
}

export const appConfigManager = AppConfigService.getInstance();

import { z } from 'zod';
import dotenv from 'dotenv';
import { AppError } from '../utils/error';

dotenv.config();

const configSchema = z.object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.string().transform(Number).default('3000'),
    AZURE_AD_B2C_TENANT_ID: z.string().min(1, 'Tenant ID is required'),
    AZURE_AD_B2C_CLIENT_ID: z.string().min(1, 'Client ID is required'),
    LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
    NEXTAUTH_URL: z.string().url().default('http://localhost:3000'),
    // Application Insights
    APPINSIGHTS_CONNECTION_STRING: z.string().optional(),
});

class ConfigService {
    private static instance: ConfigService;
    public readonly values: z.infer<typeof configSchema>;

    private constructor() {
        try {
            this.values = configSchema.parse(process.env);
        } catch (error) {
            if (error instanceof z.ZodError) {
                throw new AppError(
                    500,
                    `Configuration Validation Failed: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`
                );
            }
            throw error;
        }
    }

    public static getInstance(): ConfigService {
        if (!ConfigService.instance) {
            ConfigService.instance = new ConfigService();
        }
        return ConfigService.instance;
    }

    public get<K extends keyof z.infer<typeof configSchema>>(key: K): z.infer<typeof configSchema>[K] {
        return this.values[key];
    }
}

export const config = ConfigService.getInstance();

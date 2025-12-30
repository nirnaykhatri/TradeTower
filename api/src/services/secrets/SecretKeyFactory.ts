/**
 * Centralized logic for naming secrets in Key Vault.
 * Ensures consistent naming conventions across the application.
 * Pattern: user-{userId}-{exchange}-{keyType}
 */
export class SecretKeyFactory {
    /**
     * Generates the secret name for an API Key.
     */
    public static apiKey(userId: string, exchange: string): string {
        return this.buildKeyName(userId, exchange, 'apikey');
    }

    /**
     * Generates the secret name for an API Secret.
     */
    public static apiSecret(userId: string, exchange: string): string {
        return this.buildKeyName(userId, exchange, 'apisecret');
    }

    /**
     * Generates the secret name for a Passphrase.
     */
    public static passphrase(userId: string, exchange: string): string {
        return this.buildKeyName(userId, exchange, 'passphrase');
    }

    private static buildKeyName(userId: string, exchange: string, type: string): string {
        if (!userId || !exchange) {
            throw new Error('SecretKeyValidation: userId and exchange are required');
        }
        const safeUserId = userId.replace(/[^a-z0-9-]/gi, '');
        const safeExchange = exchange.toLowerCase().replace(/[^a-z0-9]/g, '');
        return `user-${safeUserId}-${safeExchange}-${type}`;
    }
}

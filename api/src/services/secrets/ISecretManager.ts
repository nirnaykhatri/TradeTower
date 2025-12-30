export interface ISecretManager {
    /**
     * Sets a secret in the secure storage.
     * @param name - The name of the secret (will be normalized)
     * @param value - The secret value
     */
    setSecret(name: string, value: string): Promise<void>;

    /**
     * Retrieves a secret from the secure storage.
     * @param name - The name of the secret
     * @returns The secret value or null if not found
     */
    getSecret(name: string): Promise<string | null>;

    /**
     * Deletes a secret from the secure storage.
     * @param name - The name of the secret
     */
    deleteSecret(name: string): Promise<void>;
}

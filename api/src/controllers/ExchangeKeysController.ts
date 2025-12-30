import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { secretManager } from '../services/secrets/KeyVaultService';
import { SecretKeyFactory } from '../services/secrets/SecretKeyFactory';
import { AppError } from '../utils/error';
import { logger } from '../services/logger';

// Validation Schema for API Keys
const exchangeKeysSchema = z.object({
    apiKey: z.string().min(10, 'API Key is too short'),
    apiSecret: z.string().min(10, 'API Secret is too short'),
    passphrase: z.string().optional(), // For KuCoin etc.
});

/**
 * Controller for managing user exchange API keys securely.
 */
export class ExchangeKeysController {

    /**
     * Save (Encrypt) Exchange Keys
     * POST /api/v1/exchanges/:exchangeId/keys
     */
    public async saveKeys(req: Request, res: Response, next: NextFunction) {
        try {
            const { exchangeId } = req.params;
            const userId = req.user.userId;

            // 1. Validate Input
            const keys = exchangeKeysSchema.parse(req.body);

            // 2. Validate Exchange Support (TODO: Validate against supported exchanges enum)
            if (!exchangeId) {
                throw new AppError(400, 'Exchange ID is required');
            }

            // 3. Construct Secure Key Names using Factory
            // 4. Save to Key Vault with Rollback mechanism (Fix P0 Issue 4)
            try {
                await secretManager.setSecret(SecretKeyFactory.apiKey(userId, exchangeId), keys.apiKey);
                await secretManager.setSecret(SecretKeyFactory.apiSecret(userId, exchangeId), keys.apiSecret);
                if (keys.passphrase) {
                    await secretManager.setSecret(SecretKeyFactory.passphrase(userId, exchangeId), keys.passphrase);
                }
            } catch (err: any) {
                logger.error(`Failed to save exchange keys, rolling back user ${userId} exchange ${exchangeId}`, err);

                // Best-effort rollback
                await Promise.allSettled([
                    secretManager.deleteSecret(SecretKeyFactory.apiKey(userId, exchangeId)),
                    secretManager.deleteSecret(SecretKeyFactory.apiSecret(userId, exchangeId)),
                    keys.passphrase ? secretManager.deleteSecret(SecretKeyFactory.passphrase(userId, exchangeId)) : Promise.resolve()
                ]);

                throw err; // Re-throw to global error handler
            }

            logger.info(`Exchange keys saved for user ${userId} on ${exchangeId}`);

            res.status(200).json({
                status: 'success',
                message: `API Keys for ${exchangeId} have been securely encrypted and stored.`,
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Delete Exchange Keys
     * DELETE /api/v1/exchanges/:exchangeId/keys
     */
    public async deleteKeys(req: Request, res: Response, next: NextFunction) {
        try {
            const { exchangeId } = req.params;
            const userId = req.user.userId;

            if (!exchangeId) throw new AppError(400, 'Exchange ID is required');

            // Best effort delete all potential keys
            await Promise.all([
                secretManager.deleteSecret(SecretKeyFactory.apiKey(userId, exchangeId)),
                secretManager.deleteSecret(SecretKeyFactory.apiSecret(userId, exchangeId)),
                secretManager.deleteSecret(SecretKeyFactory.passphrase(userId, exchangeId))
            ]);

            logger.info(`Exchange keys deleted for user ${userId} on ${exchangeId}`);

            res.status(200).json({
                status: 'success',
                message: `Keys for ${exchangeId} have been removed.`,
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Check if keys exist (Does NOT return actual keys)
     * GET /api/v1/exchanges/:exchangeId/status
     */
    public async getKeyStatus(req: Request, res: Response, next: NextFunction) {
        try {
            const { exchangeId } = req.params;
            const userId = req.user.userId;

            // Check if API Key exists
            const apiKey = await secretManager.getSecret(SecretKeyFactory.apiKey(userId, exchangeId));

            res.status(200).json({
                status: 'success',
                exchange: exchangeId,
                isConfigured: !!apiKey,
            });

        } catch (error) {
            next(error);
        }
    }
}



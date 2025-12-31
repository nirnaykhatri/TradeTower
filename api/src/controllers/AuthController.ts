import { Request, Response, NextFunction } from 'express';
import { logger } from '../services/logger';
import { userRepository } from '../services/db/UserRepository';

/**
 * Controller for handling User Authentication & Profile metadata.
 */
export class AuthController {
    /**
     * Get current user profile (from validated token)
     * GET /api/v1/auth/me
     */
    public async getMe(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const user = req.user;

            // Fetch detailed profile from DB
            const profile = await userRepository.getById(user.userId, user.userId);

            res.status(200).json({
                status: 'success',
                data: {
                    user,
                    profile: profile || null
                }
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Optional: Sync user profile with Cosmos DB (Upsert)
     * POST /api/v1/auth/sync
     */
    public async syncUser(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const user = req.user;

            const profile = await userRepository.syncUser({
                userId: user.userId,
                email: user.email || '',
                name: user.name || ''
            });

            logger.info(`User profile synced for ${user.userId}`);

            res.status(200).json({
                status: 'success',
                message: 'User profile synchronized',
                data: { profile }
            });
        } catch (error) {
            next(error);
        }
    }
}

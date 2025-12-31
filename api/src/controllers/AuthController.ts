import { Request, Response, NextFunction } from 'express';
import { logger } from '../services/logger';

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
            // User context is already populated by requireUserContext middleware
            const user = req.user;

            res.status(200).json({
                status: 'success',
                data: {
                    user
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

            // TODO: Implement Cosmos DB upsert logic here
            // This ensures the user exists even if they haven't made any configuration changes yet

            logger.info(`User sync request received: ${user.userId} (${user.email})`);

            res.status(200).json({
                status: 'success',
                message: 'User profile sync request received',
                data: { user }
            });
        } catch (error) {
            next(error);
        }
    }
}

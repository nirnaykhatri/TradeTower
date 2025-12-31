import { Router } from 'express';
import { AuthController } from '../controllers/AuthController';
import { requireUserContext } from '../middleware/userContext';

const router = Router();
const controller = new AuthController();

/**
 * All auth routes require valid Bearer token
 * This ensures the frontend has successfully authenticated with Azure AD B2C
 */
router.use(requireUserContext);

// GET /api/v1/auth/me - Return current user session context
router.get('/me', controller.getMe.bind(controller));

// POST /api/v1/auth/sync - Sync user profile with persistence layer
router.post('/sync', controller.syncUser.bind(controller));

export default router;

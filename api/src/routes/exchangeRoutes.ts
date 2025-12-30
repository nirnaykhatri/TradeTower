import { Router } from 'express';
import { ExchangeKeysController } from '../controllers/ExchangeKeysController';

const router = Router();
const controller = new ExchangeKeysController();

// Key Management Routes
// POST /api/v1/exchanges/:exchangeId/keys
router.post(
    '/:exchangeId/keys',
    controller.saveKeys.bind(controller)
);

// DELETE /api/v1/exchanges/:exchangeId/keys
router.delete(
    '/:exchangeId/keys',
    controller.deleteKeys.bind(controller)
);

// GET /api/v1/exchanges/:exchangeId/status (Is Configured?)
router.get(
    '/:exchangeId/status',
    controller.getKeyStatus.bind(controller)
);

export default router;

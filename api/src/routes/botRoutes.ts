import { Router } from 'express';
import { BotController } from '../controllers/BotController';
import { requireUserContext } from '../middleware/userContext';

const router = Router();
const controller = new BotController();

// All bot routes require authentication
router.use(requireUserContext);

// GET /api/v1/bots - List all bots
router.get('/', controller.getBots.bind(controller));

// POST /api/v1/bots - Create a new bot
router.post('/', controller.createBot.bind(controller));

// GET /api/v1/bots/:id - Get specific bot
router.get('/:id', controller.getBotById.bind(controller));

// PATCH /api/v1/bots/:id - Update bot config
router.patch('/:id', controller.updateBot.bind(controller));

// DELETE /api/v1/bots/:id - Delete bot
router.delete('/:id', controller.deleteBot.bind(controller));

// POST /api/v1/bots/:id/toggle - Start/Stop bot
router.post('/:id/toggle', controller.toggleBot.bind(controller));

export default router;

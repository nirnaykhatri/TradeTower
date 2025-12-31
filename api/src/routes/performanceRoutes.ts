import { Router } from 'express';
import { PerformanceController } from '../controllers/PerformanceController';
import { requireUserContext } from '../middleware/userContext';

const router = Router();
const controller = new PerformanceController();

router.use(requireUserContext);

router.get('/', controller.getGlobalMetrics.bind(controller));
router.get('/bot/:botId', controller.getBotPerformance.bind(controller));

export default router;

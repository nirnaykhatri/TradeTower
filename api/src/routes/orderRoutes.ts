import { Router } from 'express';
import { OrderController } from '../controllers/OrderController';
import { requireUserContext } from '../middleware/userContext';

const router = Router();
const controller = new OrderController();

router.use(requireUserContext);

router.get('/', controller.getOrders.bind(controller));
router.get('/:id', controller.getOrderById.bind(controller));

export default router;

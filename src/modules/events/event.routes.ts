import { Router } from 'express';
import type { EventController } from './event.controller';

/** Mounted at /v1 because the paths span /tasks/:taskId/events and /deliveries. */
export function createEventRouter(controller: EventController): Router {
  const router = Router();
  router.get('/tasks/:taskId/events', (req, res) => controller.listForTask(req, res));
  router.get('/deliveries', (req, res) => controller.listDeliveries(req, res));
  router.post('/deliveries/:eventId/retry', (req, res) => controller.retryDelivery(req, res));
  return router;
}

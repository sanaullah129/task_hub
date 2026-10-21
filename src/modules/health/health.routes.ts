import { Router } from 'express';
import type { HealthController } from './health.controller';

export function createHealthRouter(controller: HealthController): Router {
  const router = Router();
  router.get('/', (req, res) => controller.check(req, res));
  return router;
}

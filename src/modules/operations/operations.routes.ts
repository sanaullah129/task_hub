import { Router } from 'express';
import type { OperationsService } from './operations.service';

export function createOperationsRouter(service: OperationsService): Router {
  const router = Router();
  router.get('/ops/tasks/:taskId/investigation', async (req, res) => {
    res.json(await service.investigate(req.params.taskId));
  });
  return router;
}

import { Router } from 'express';
import type { TaskController } from './task.controller';

export function createTaskRouter(controller: TaskController): Router {
  const router = Router();
  router.post('/', (req, res) => controller.submit(req, res));
  router.get('/:taskId', (req, res) => controller.getById(req, res));
  return router;
}

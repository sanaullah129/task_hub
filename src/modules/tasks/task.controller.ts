import type { Request, Response } from 'express';
import type { Config } from '../../config/config';
import { getRequestContext } from '../../shared/http/requestContext';
import type { TaskService } from './task.service';
import { parseSubmitRequest, parseTaskListQuery } from './task.validation';
import { toTaskView } from './task.view';

export interface TaskController {
  submit(req: Request, res: Response): Promise<void>;
  getById(req: Request<{ taskId: string }>, res: Response): Promise<void>;
  list(req: Request, res: Response): Promise<void>;
}

export function createTaskController(deps: {
  service: TaskService;
  config: Pick<Config, 'demoMode'>;
}): TaskController {
  return {
    async submit(req, res) {
      const input = parseSubmitRequest(req.body, { demoMode: deps.config.demoMode });
      const { correlationId } = getRequestContext(req);
      const { task, created } = await deps.service.submit({ ...input, correlationId });
      res.status(created ? 202 : 200).json(toTaskView(task));
    },

    async getById(req, res) {
      const task = await deps.service.get(req.params.taskId);
      res.json(toTaskView(task));
    },

    async list(req, res) {
      const page = await deps.service.list(parseTaskListQuery(req.query));
      res.json({ items: page.items.map(toTaskView), nextCursor: page.nextCursor });
    },
  };
}

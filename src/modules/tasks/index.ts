import type { Router } from 'express';
import type { Config } from '../../config/config';
import type { Logger } from '../../observability/logger';
import { createTaskController } from './task.controller';
import type { TaskRepository } from './task.repository';
import { createTaskRouter } from './task.routes';
import { TaskService } from './task.service';

export interface TasksModule {
  service: TaskService;
  router: Router;
}

export function createTasksModule(deps: {
  repository: TaskRepository;
  config: Pick<Config, 'task' | 'demoMode'>;
  logger: Logger;
}): TasksModule {
  const service = new TaskService(deps);
  const router = createTaskRouter(createTaskController({ service, config: deps.config }));
  return { service, router };
}

export { TaskService } from './task.service';
export { MongooseTaskRepository, type TaskListQuery, type TaskPage, type TaskRepository } from './task.repository';
export { MongooseTaskRecoveryRepository, type TaskRecoveryRepository } from './task.recovery.repository';
export {
  MongooseTaskExecutionRepository,
  type AttemptCompletion,
  type AttemptKey,
  type ClaimOptions,
  type TaskExecutionRepository,
} from './task.execution.repository';
export { taskSchema } from './task.model';
export type { TaskDocument } from './task.types';

import express, { type Express } from 'express';
import type { Config } from './config/config';
import { createHealthModule, type HealthCheck } from './modules/health';
import { createTasksModule } from './modules/tasks';
import type { TaskRepository } from './modules/tasks';
import type { Logger } from './observability/logger';
import { correlationMiddleware } from './shared/http/correlation.middleware';
import { errorHandler, notFoundHandler } from './shared/http/error.middleware';
import { requestLogger } from './shared/http/requestLogger.middleware';

export interface AppDeps {
  config: Pick<Config, 'task' | 'demoMode'>;
  logger: Logger;
  taskRepository: TaskRepository;
  isHealthy: HealthCheck;
}

export function createApp({ config, logger, taskRepository, isHealthy }: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');

  app.use(correlationMiddleware);
  app.use(requestLogger(logger));
  app.use(express.json({ limit: config.task.maxPayloadBytes }));

  app.use('/healthz', createHealthModule(isHealthy).router);
  app.use('/v1/tasks', createTasksModule({ repository: taskRepository, config, logger }).router);

  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}

import type { Config } from '../../config/config';
import type { Logger } from '../../observability/logger';
import type { Metrics } from '../../observability/metrics';
import type { TaskDocument } from '../tasks/task.types';
import type { TaskExecutionRepository } from '../tasks/task.execution.repository';
import { TaskExecutor } from './execution.executor';
import { createSimulatedHandlers } from './execution.handlers';
import type { HandlerRegistry } from './execution.types';
import { newWorkerId, TaskWorker } from './execution.worker';

export function createExecutionModule(deps: {
  repository: TaskExecutionRepository;
  config: Pick<Config, 'task'>;
  logger: Logger;
  workerId?: string;
  handlers?: HandlerRegistry;
  onTerminal?: (task: TaskDocument) => Promise<unknown>;
  metrics?: Metrics;
}): { worker: TaskWorker } {
  const workerId = deps.workerId ?? newWorkerId();
  const logger = deps.logger.child({ workerId });
  const executor = new TaskExecutor({
    repository: deps.repository,
    handlers: deps.handlers ?? createSimulatedHandlers(),
    config: deps.config,
    logger,
    workerId,
    ...(deps.onTerminal === undefined ? {} : { onTerminal: deps.onTerminal }),
    ...(deps.metrics === undefined ? {} : { metrics: deps.metrics }),
  });
  const worker = new TaskWorker({ repository: deps.repository, executor, config: deps.config, logger, workerId });
  return { worker };
}

export { HandlerError } from './execution.errors';
export type { HandlerContext, HandlerRegistry, TaskHandler } from './execution.types';
export { TaskWorker } from './execution.worker';

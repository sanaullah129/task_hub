import type { Config } from '../../config/config';
import type { Logger } from '../../observability/logger';
import type { TaskExecutionRepository } from '../tasks/task.execution.repository';
import type { TaskRecoveryRepository } from '../tasks/task.recovery.repository';
import type { TaskDocument } from '../tasks/task.types';
import { ReconcilerRunner } from './reconciler.runner';
import { ReconcilerService } from './reconciler.service';

export function createReconcilerModule(deps: {
  recovery: TaskRecoveryRepository;
  execution: Pick<TaskExecutionRepository, 'completeAttempt'>;
  emitEvent: (task: TaskDocument) => Promise<unknown>;
  config: Pick<Config, 'task' | 'reconcilerIntervalMs'>;
  logger: Logger;
}): { service: ReconcilerService; runner: ReconcilerRunner } {
  const service = new ReconcilerService(deps);
  const runner = new ReconcilerRunner({
    service,
    intervalMs: deps.config.reconcilerIntervalMs,
    logger: deps.logger,
  });
  return { service, runner };
}

export { ReconcilerRunner } from './reconciler.runner';
export { ReconcilerService, type ReconcileSummary } from './reconciler.service';
export { decideAbandoned } from './reconciler.outcome';

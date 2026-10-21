import type { Config } from '../../config/config';
import type { Logger } from '../../observability/logger';
import { newWorkerId as sharedWorkerId } from '../../shared/utils/ids';
import { PollingWorker } from '../../shared/workers/pollingWorker';
import type { TaskExecutionRepository } from '../tasks/task.execution.repository';
import type { TaskDocument } from '../tasks/task.types';
import type { TaskExecutor } from './execution.executor';

export const newWorkerId = (): string => sharedWorkerId('wrk');

export interface TaskWorkerDeps {
  repository: TaskExecutionRepository;
  executor: Pick<TaskExecutor, 'execute'>;
  config: Pick<Config, 'task'>;
  logger: Logger;
  workerId: string;
  now?: () => Date;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
}

export class TaskWorker {
  private readonly worker: PollingWorker<TaskDocument>;

  constructor(deps: TaskWorkerDeps) {
    const now = deps.now ?? (() => new Date());
    const { task } = deps.config;
    this.worker = new PollingWorker<TaskDocument>({
      name: 'task worker',
      workerId: deps.workerId,
      logger: deps.logger,
      claim: () =>
        deps.repository.claimNext({ workerId: deps.workerId, now: now(), leaseGraceMs: task.leaseGraceMs }),
      process: (item) => deps.executor.execute(item),
      describe: (item) => ({ taskId: item._id, attempt: item.attempts }),
      concurrency: task.concurrency,
      pollIntervalMs: task.pollIntervalMs,
      shutdownTimeoutMs: task.shutdownTimeoutMs,
      claimErrorMessage: 'failed to claim task',
      processErrorMessage: 'attempt could not be recorded',
      sleep: deps.sleep,
      random: deps.random,
    });
  }

  get activeCount(): number {
    return this.worker.activeCount;
  }

  start(): void {
    this.worker.start();
  }

  stop(): Promise<void> {
    return this.worker.stop();
  }
}

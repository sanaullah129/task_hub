import type { Config } from '../../config/config';
import type { Logger } from '../../observability/logger';
import { taskLog } from '../../observability/logContext';
import type { RandomSource } from '../../shared/utils/backoff';
import type { TaskExecutionRepository } from '../tasks/task.execution.repository';
import type { TaskRecoveryRepository } from '../tasks/task.recovery.repository';
import { isTerminalStatus } from '../tasks/task.stateMachine';
import type { TaskDocument } from '../tasks/task.types';
import { decideAbandoned } from './reconciler.outcome';

export interface ReconcileSummary {
  leasesRecovered: number;
  /** Leases another process already handled between the scan and the update. */
  leasesSkipped: number;
  eventsEmitted: number;
  eventFailures: number;
}

export interface ReconcilerServiceDeps {
  recovery: TaskRecoveryRepository;
  execution: Pick<TaskExecutionRepository, 'completeAttempt'>;
  /** Creates the event for a terminal task; must be idempotent. */
  emitEvent: (task: TaskDocument) => Promise<unknown>;
  config: Pick<Config, 'task'>;
  logger: Logger;
  batchSize?: number;
  now?: () => Date;
  random?: RandomSource;
}

const DEFAULT_BATCH_SIZE = 100;

export class ReconcilerService {
  private readonly now: () => Date;
  private readonly batchSize: number;

  constructor(private readonly deps: ReconcilerServiceDeps) {
    this.now = deps.now ?? (() => new Date());
    this.batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE;
  }

  async runOnce(): Promise<ReconcileSummary> {
    const summary: ReconcileSummary = { leasesRecovered: 0, leasesSkipped: 0, eventsEmitted: 0, eventFailures: 0 };
    await this.recoverExpiredLeases(summary);
    await this.emitPendingEvents(summary);
    return summary;
  }

  private async recoverExpiredLeases(summary: ReconcileSummary): Promise<void> {
    const { recovery, execution, config, logger, random } = this.deps;
    const now = this.now();
    const expired = await recovery.findLeaseExpired(now, this.batchSize);

    for (const task of expired) {
      if (task.lease === null) continue;
      const completion = decideAbandoned({ task, retry: config.task.retry, now, random });
      const updated = await execution.completeAttempt(
        { taskId: task._id, attempt: task.attempts, workerId: task.lease.workerId, leaseExpiredBefore: now },
        completion,
        now,
      );
      if (updated === null) {
        summary.leasesSkipped += 1;
        continue;
      }
      summary.leasesRecovered += 1;
      taskLog(logger, task).warn('task attempt abandoned, lease expired and recovered by reconciler', {
        attempt: task.attempts,
        abandonedWorker: task.lease.workerId,
        next: updated.status,
      });
      if (isTerminalStatus(updated.status)) await this.emit(updated, summary);
    }
  }

  private async emitPendingEvents(summary: ReconcileSummary): Promise<void> {
    const pending = await this.deps.recovery.findEventPending(this.batchSize);
    for (const task of pending) await this.emit(task, summary);
  }

  private async emit(task: TaskDocument, summary: ReconcileSummary): Promise<void> {
    try {
      await this.deps.emitEvent(task);
      summary.eventsEmitted += 1;
    } catch (error) {
      summary.eventFailures += 1;
      taskLog(this.deps.logger, task).error('failed to create webhook event for terminal task', { status: task.status, error });
    }
  }
}

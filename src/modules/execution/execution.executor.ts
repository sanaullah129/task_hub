import { performance } from 'node:perf_hooks';
import type { Config } from '../../config/config';
import type { Logger } from '../../observability/logger';
import { taskLog } from '../../observability/logContext';
import { noopMetrics, type Metrics } from '../../observability/metrics';
import type { RandomSource } from '../../shared/utils/backoff';
import type { TaskExecutionRepository } from '../tasks/task.execution.repository';
import { isTerminalStatus } from '../tasks/task.stateMachine';
import type { TaskDocument } from '../tasks/task.types';
import { decideCompletion, type AttemptResult } from './execution.outcome';
import type { HandlerRegistry } from './execution.types';

export interface TaskExecutorDeps {
  repository: TaskExecutionRepository;
  handlers: HandlerRegistry;
  config: Pick<Config, 'task'>;
  logger: Logger;
  workerId: string;
  /** Called after a task reaches a terminal state, e.g. to create its event. Failures are left to the reconciler. */
  onTerminal?: (task: TaskDocument) => Promise<unknown>;
  metrics?: Metrics;
  now?: () => Date;
  random?: RandomSource;
}

export class TaskExecutor {
  private readonly now: () => Date;

  constructor(private readonly deps: TaskExecutorDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /** Runs one claimed attempt and records its outcome. Never rejects on handler failures. */
  async execute(task: TaskDocument): Promise<void> {
    const { repository, handlers, config, workerId } = this.deps;
    const log = taskLog(this.deps.logger, task).child({ attempt: task.attempts });
    const startedAt = performance.now();
    log.info('task attempt started', { taskType: task.taskType, maxAttempts: task.maxAttempts, timeoutMs: task.timeoutMs });

    const result = await this.runWithTimeout(task, handlers);
    const durationMs = Math.round(performance.now() - startedAt);

    const completion = decideCompletion({
      task,
      result,
      retry: config.task.retry,
      now: this.now(),
      random: this.deps.random,
    });
    const updated = await repository.completeAttempt(
      { taskId: task._id, attempt: task.attempts, workerId },
      completion,
      this.now(),
    );

    if (updated === null) {
      log.warn('task attempt result discarded: task is no longer owned by this attempt', { durationMs });
      return;
    }
    log.info('task attempt finished', { durationMs, result: result.kind, next: updated.status, reason: completion.reason });
    (this.deps.metrics ?? noopMetrics).recordAttempt({
      taskType: task.taskType,
      outcome: result.kind,
      durationMs,
    });

    if (isTerminalStatus(updated.status)) {
      const turnaroundMs = (updated.finishedAt ?? this.now()).getTime() - updated.createdAt.getTime();
      log.info('task finished, webhook event will be created', { status: updated.status, attempts: updated.attempts, turnaroundMs, errorCode: updated.error?.code });
    }
    if (this.deps.onTerminal !== undefined && isTerminalStatus(updated.status)) {
      try {
        await this.deps.onTerminal(updated);
      } catch (error) {
        log.warn('event creation failed; the reconciler will retry', { error });
      }
    }
  }

  private async runWithTimeout(task: TaskDocument, handlers: HandlerRegistry): Promise<AttemptResult> {
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<AttemptResult>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve({ kind: 'timeout' });
      }, task.timeoutMs);
    });
    // A handler that ignores the abort signal still cannot hold the attempt past its timeout.
    const run = handlers[task.taskType]({
      taskId: task._id,
      taskType: task.taskType,
      payload: task.payload,
      attempt: task.attempts,
      signal: controller.signal,
    }).then<AttemptResult, AttemptResult>(
      (result) => ({ kind: 'success', result }),
      (error: unknown) => ({ kind: 'error', error }),
    );
    try {
      return await Promise.race([run, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}

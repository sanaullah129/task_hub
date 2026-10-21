import type {
  AttemptCompletion,
  AttemptKey,
  ClaimOptions,
  TaskExecutionRepository,
} from '../../../src/modules/tasks/task.execution.repository';
import type { TaskRecoveryRepository } from '../../../src/modules/tasks/task.recovery.repository';
import type { TaskDocument } from '../../../src/modules/tasks/task.types';

/** Mirrors the claim and compare-and-set semantics of the Mongoose repositories. */
export class InMemoryExecutionRepository implements TaskExecutionRepository, TaskRecoveryRepository {
  readonly tasks = new Map<string, TaskDocument>();
  readonly completions: Array<{ key: AttemptKey; completion: AttemptCompletion }> = [];

  add(task: TaskDocument): TaskDocument {
    this.tasks.set(task._id, task);
    return task;
  }

  claimNext({ workerId, now, leaseGraceMs }: ClaimOptions): Promise<TaskDocument | null> {
    const due = [...this.tasks.values()]
      .filter((task) => task.status === 'Pending' && task.nextRunAt <= now)
      .sort((a, b) => a.nextRunAt.getTime() - b.nextRunAt.getTime())[0];
    if (due === undefined) return Promise.resolve(null);

    const attempt = due.attempts + 1;
    const claimed: TaskDocument = {
      ...due,
      status: 'Running',
      attempts: attempt,
      lease: { workerId, expiresAt: new Date(now.getTime() + due.timeoutMs + leaseGraceMs) },
      firstStartedAt: due.firstStartedAt ?? now,
      updatedAt: now,
      attemptLog: [...due.attemptLog, { n: attempt, workerId, startedAt: now, finishedAt: null, outcome: null }],
      history: [
        ...due.history,
        { from: 'Pending', to: 'Running', at: now, reason: `claimed by ${workerId} (attempt ${attempt})` },
      ],
    };
    this.tasks.set(claimed._id, claimed);
    return Promise.resolve(claimed);
  }

  completeAttempt(key: AttemptKey, completion: AttemptCompletion, now: Date): Promise<TaskDocument | null> {
    this.completions.push({ key, completion });
    const task = this.tasks.get(key.taskId);
    if (
      task === undefined ||
      task.status !== 'Running' ||
      task.attempts !== key.attempt ||
      task.lease?.workerId !== key.workerId ||
      (key.leaseExpiredBefore !== undefined && (task.lease.expiresAt > key.leaseExpiredBefore))
    ) {
      return Promise.resolve(null);
    }
    const toStatus =
      completion.kind === 'completed' ? 'Completed' : completion.kind === 'retry' ? 'Pending' : completion.status;
    const outcome =
      completion.kind === 'completed'
        ? 'Completed'
        : completion.kind === 'retry'
          ? completion.outcome
          : (completion.attemptOutcome ?? completion.status);
    const error = completion.kind === 'completed' ? undefined : completion.error;
    const updated: TaskDocument = {
      ...task,
      status: toStatus,
      lease: null,
      updatedAt: now,
      attemptLog: task.attemptLog.map((entry) =>
        entry.n === key.attempt
          ? { ...entry, finishedAt: now, outcome, ...(error === undefined ? {} : { error }) }
          : entry,
      ),
      history: [...task.history, { from: 'Running', to: toStatus, at: now, reason: completion.reason }],
      ...(completion.kind === 'completed' ? { result: completion.result, finishedAt: now, eventPending: true } : {}),
      ...(completion.kind === 'retry' ? { nextRunAt: completion.nextRunAt } : {}),
      ...(completion.kind === 'terminal' ? { error: completion.error, finishedAt: now, eventPending: true } : {}),
    };
    this.tasks.set(updated._id, updated);
    return Promise.resolve(updated);
  }

  findLeaseExpired(now: Date, limit: number): Promise<TaskDocument[]> {
    return Promise.resolve(
      [...this.tasks.values()]
        .filter((task) => task.status === 'Running' && task.lease !== null && task.lease.expiresAt <= now)
        .slice(0, limit),
    );
  }

  findEventPending(limit: number): Promise<TaskDocument[]> {
    return Promise.resolve([...this.tasks.values()].filter((task) => task.eventPending).slice(0, limit));
  }

  markEventEmitted(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (task !== undefined) this.tasks.set(taskId, { ...task, eventPending: false });
    return Promise.resolve();
  }
}

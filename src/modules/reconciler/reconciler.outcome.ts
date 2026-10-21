import type { BackoffConfig } from '../../config/config';
import { computeBackoffMs, type RandomSource } from '../../shared/utils/backoff';
import type { AttemptCompletion } from '../tasks/task.execution.repository';
import type { TaskDocument, TaskError } from '../tasks/task.types';

export interface AbandonedInput {
  task: Pick<TaskDocument, 'attempts' | 'maxAttempts' | 'lease'>;
  retry: BackoffConfig;
  now: Date;
  random?: RandomSource;
}

/** Decides what happens to an attempt whose worker stopped renewing its lease (crash, restart, hang). */
export function decideAbandoned({ task, retry, now, random }: AbandonedInput): AttemptCompletion {
  const { attempts, maxAttempts } = task;
  const worker = task.lease?.workerId ?? 'unknown';
  const error: TaskError = {
    code: 'lease_expired',
    message: `Attempt ${attempts} was abandoned: worker ${worker} did not finish before its lease expired`,
    retryable: true,
  };

  if (attempts < maxAttempts) {
    const delayMs = computeBackoffMs(attempts, retry, random);
    return {
      kind: 'retry',
      outcome: 'Abandoned',
      error,
      nextRunAt: new Date(now.getTime() + delayMs),
      reason: `lease expired during attempt ${attempts}, recovered by reconciler, retry in ${delayMs} ms`,
    };
  }
  return {
    kind: 'terminal',
    status: 'Failed',
    attemptOutcome: 'Abandoned',
    error: { ...error, retryable: false },
    reason: `lease expired during attempt ${attempts}, attempts exhausted`,
  };
}

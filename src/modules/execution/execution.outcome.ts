import type { BackoffConfig } from '../../config/config';
import type { JsonObject } from '../../shared/types/json';
import { computeBackoffMs, type RandomSource } from '../../shared/utils/backoff';
import type { AttemptCompletion } from '../tasks/task.execution.repository';
import type { TaskDocument, TaskError } from '../tasks/task.types';
import { HandlerError } from './execution.errors';

export type AttemptResult =
  | { kind: 'success'; result: JsonObject }
  | { kind: 'error'; error: unknown }
  | { kind: 'timeout' };

const MAX_MESSAGE_LENGTH = 500;

export function toTaskError(error: unknown): TaskError {
  if (error instanceof HandlerError) {
    return { code: error.code, message: error.message, retryable: error.retryable };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { code: 'unexpected_error', message: message.slice(0, MAX_MESSAGE_LENGTH), retryable: true };
}

export interface OutcomeInput {
  task: Pick<TaskDocument, 'attempts' | 'maxAttempts' | 'timeoutMs'>;
  result: AttemptResult;
  retry: BackoffConfig;
  now: Date;
  random?: RandomSource;
}

/** Maps one finished attempt to the next task state: completed, retry with backoff, or terminal. */
export function decideCompletion({ task, result, retry, now, random }: OutcomeInput): AttemptCompletion {
  const { attempts, maxAttempts } = task;
  if (result.kind === 'success') {
    return { kind: 'completed', result: result.result, reason: `attempt ${attempts} succeeded` };
  }

  const timedOut = result.kind === 'timeout';
  const error: TaskError = timedOut
    ? { code: 'timeout', message: `Attempt ${attempts} exceeded ${task.timeoutMs} ms`, retryable: true }
    : toTaskError(result.error);
  const outcome = timedOut ? 'TimedOut' : 'Failed';
  const label = timedOut ? 'timed out' : 'failed';

  if (error.retryable && attempts < maxAttempts) {
    const delayMs = computeBackoffMs(attempts, retry, random);
    return {
      kind: 'retry',
      outcome,
      error,
      nextRunAt: new Date(now.getTime() + delayMs),
      reason: `attempt ${attempts} ${label} (${error.code}), retry in ${delayMs} ms`,
    };
  }
  const why = error.retryable ? 'attempts exhausted' : 'non-retryable error';
  return {
    kind: 'terminal',
    status: outcome,
    error,
    reason: `attempt ${attempts} ${label} (${error.code}), ${why}`,
  };
}

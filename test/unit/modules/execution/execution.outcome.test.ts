import { describe, expect, it } from 'vitest';
import { HandlerError } from '../../../../src/modules/execution/execution.errors';
import { decideCompletion, toTaskError } from '../../../../src/modules/execution/execution.outcome';
import { FIXED_NOW } from '../../../mocks/tasks/taskFixtures';

const retry = { baseMs: 1_000, capMs: 30_000 };
const noJitter = (): number => 0;
const task = (attempts: number, maxAttempts = 3): { attempts: number; maxAttempts: number; timeoutMs: number } => ({
  attempts,
  maxAttempts,
  timeoutMs: 30_000,
});

describe('toTaskError', () => {
  it('keeps the code and retryability of a HandlerError', () => {
    expect(toTaskError(new HandlerError('bad_input', 'nope', false))).toEqual({
      code: 'bad_input',
      message: 'nope',
      retryable: false,
    });
  });

  it('treats unexpected errors as retryable and truncates long messages', () => {
    const error = toTaskError(new Error('x'.repeat(900)));

    expect(error).toMatchObject({ code: 'unexpected_error', retryable: true });
    expect(error.message).toHaveLength(500);
  });

  it('stringifies non-Error values', () => {
    expect(toTaskError('boom')).toEqual({ code: 'unexpected_error', message: 'boom', retryable: true });
  });
});

describe('decideCompletion', () => {
  const decide = (attempts: number, result: Parameters<typeof decideCompletion>[0]['result'], max = 3) =>
    decideCompletion({ task: task(attempts, max), result, retry, now: FIXED_NOW, random: noJitter });

  it('completes on success and carries the result', () => {
    expect(decide(1, { kind: 'success', result: { ok: true } })).toEqual({
      kind: 'completed',
      result: { ok: true },
      reason: 'attempt 1 succeeded',
    });
  });

  it('retries a retryable error with exponential backoff while attempts remain', () => {
    const first = decide(1, { kind: 'error', error: new HandlerError('flaky', 'x', true) });
    const second = decide(2, { kind: 'error', error: new HandlerError('flaky', 'x', true) });

    expect(first).toMatchObject({ kind: 'retry', outcome: 'Failed', nextRunAt: new Date(FIXED_NOW.getTime() + 1_000) });
    expect(second).toMatchObject({ kind: 'retry', nextRunAt: new Date(FIXED_NOW.getTime() + 2_000) });
  });

  it('fails permanently on a non-retryable error even with attempts left', () => {
    expect(decide(1, { kind: 'error', error: new HandlerError('fatal', 'x', false) })).toMatchObject({
      kind: 'terminal',
      status: 'Failed',
      error: { code: 'fatal', retryable: false },
      reason: expect.stringContaining('non-retryable') as string,
    });
  });

  it('fails permanently when retries are exhausted', () => {
    expect(decide(3, { kind: 'error', error: new HandlerError('flaky', 'x', true) })).toMatchObject({
      kind: 'terminal',
      status: 'Failed',
      reason: expect.stringContaining('attempts exhausted') as string,
    });
  });

  it('retries a timeout while attempts remain and records the TimedOut outcome', () => {
    expect(decide(1, { kind: 'timeout' })).toMatchObject({
      kind: 'retry',
      outcome: 'TimedOut',
      error: { code: 'timeout', retryable: true, message: 'Attempt 1 exceeded 30000 ms' },
    });
  });

  it('ends in TimedOut when the final attempt times out', () => {
    expect(decide(3, { kind: 'timeout' })).toMatchObject({
      kind: 'terminal',
      status: 'TimedOut',
      error: { code: 'timeout' },
    });
  });

  it('never retries when maxAttempts is 1', () => {
    expect(decide(1, { kind: 'error', error: new Error('x') }, 1).kind).toBe('terminal');
  });

  it('applies jitter from the random source and the default source when none is given', () => {
    const jittered = decideCompletion({
      task: task(1),
      result: { kind: 'timeout' },
      retry,
      now: FIXED_NOW,
      random: () => 1,
    });
    const defaulted = decideCompletion({ task: task(1), result: { kind: 'timeout' }, retry, now: FIXED_NOW });

    expect(jittered).toMatchObject({ nextRunAt: new Date(FIXED_NOW.getTime() + 1_200) });
    expect(defaulted.kind).toBe('retry');
  });
});

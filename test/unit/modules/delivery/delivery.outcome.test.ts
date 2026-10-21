import { describe, expect, it } from 'vitest';
import { decideDelivery } from '../../../../src/modules/delivery/delivery.outcome';
import { FIXED_NOW } from '../../../mocks/tasks/taskFixtures';

const backoff = { baseMs: 1_000, capMs: 60_000 };
const decide = (
  response: Parameters<typeof decideDelivery>[0]['response'],
  attemptNumber = 1,
  maxAttempts = 3,
): ReturnType<typeof decideDelivery> =>
  decideDelivery({ response, attemptNumber, maxAttempts, now: FIXED_NOW, backoff, random: () => 0 });

describe('decideDelivery', () => {
  it.each([200, 201, 204, 299])('delivers on HTTP %i', (statusCode) => {
    expect(decide({ statusCode, durationMs: 5 })).toEqual({ kind: 'delivered', deliveredAt: FIXED_NOW });
  });

  it.each([500, 502, 503, 408, 429])('retries HTTP %i with backoff while attempts remain', (statusCode) => {
    expect(decide({ statusCode, durationMs: 5 })).toEqual({
      kind: 'retry',
      nextAttemptAt: new Date(FIXED_NOW.getTime() + 1_000),
      lastError: `HTTP ${statusCode}`,
    });
  });

  it('retries network errors and timeouts', () => {
    expect(decide({ error: 'ECONNREFUSED: connect failed', durationMs: 2 })).toMatchObject({
      kind: 'retry',
      lastError: 'ECONNREFUSED: connect failed',
    });
    expect(decide({ durationMs: 2 })).toMatchObject({ kind: 'retry', lastError: 'unknown error' });
  });

  it('doubles the delay on each attempt', () => {
    expect(decide({ statusCode: 500, durationMs: 1 }, 2)).toMatchObject({ nextAttemptAt: new Date(FIXED_NOW.getTime() + 2_000) });
    expect(decide({ statusCode: 500, durationMs: 1 }, 3, 6)).toMatchObject({ nextAttemptAt: new Date(FIXED_NOW.getTime() + 4_000) });
  });

  it('fails once attempts are exhausted', () => {
    expect(decide({ statusCode: 503, durationMs: 1 }, 3, 3)).toEqual({
      kind: 'failed',
      lastError: 'HTTP 503 (attempts exhausted)',
    });
    expect(decide({ error: 'timeout after 10000 ms', durationMs: 1 }, 3, 3)).toEqual({
      kind: 'failed',
      lastError: 'timeout after 10000 ms (attempts exhausted)',
    });
  });

  it.each([301, 302, 400, 401, 403, 404, 410, 422])('fails permanently on HTTP %i without retrying', (statusCode) => {
    expect(decide({ statusCode, durationMs: 1 })).toEqual({
      kind: 'failed',
      lastError: `HTTP ${statusCode} (permanent failure)`,
    });
  });

  it('uses the default random source when none is given', () => {
    const result = decideDelivery({ response: { statusCode: 500, durationMs: 1 }, attemptNumber: 1, maxAttempts: 3, now: FIXED_NOW, backoff });

    expect(result.kind).toBe('retry');
  });
});

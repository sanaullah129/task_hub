import { describe, expect, it } from 'vitest';
import { decideAbandoned } from '../../../../src/modules/reconciler/reconciler.outcome';
import { FIXED_NOW } from '../../../mocks/tasks/taskFixtures';

const retry = { baseMs: 1_000, capMs: 30_000 };
const lease = { workerId: 'wrk_dead', expiresAt: FIXED_NOW };

describe('decideAbandoned', () => {
  it('requeues with backoff and an Abandoned outcome while attempts remain', () => {
    const completion = decideAbandoned({
      task: { attempts: 1, maxAttempts: 3, lease },
      retry,
      now: FIXED_NOW,
      random: () => 0,
    });

    expect(completion).toMatchObject({
      kind: 'retry',
      outcome: 'Abandoned',
      nextRunAt: new Date(FIXED_NOW.getTime() + 1_000),
      error: { code: 'lease_expired', retryable: true },
    });
    expect(completion.reason).toContain('retry in 1000 ms');
    expect(completion.kind === 'retry' && completion.error.message).toContain('wrk_dead');
  });

  it('fails the task permanently when the abandoned attempt was the last one', () => {
    expect(
      decideAbandoned({ task: { attempts: 3, maxAttempts: 3, lease }, retry, now: FIXED_NOW }),
    ).toMatchObject({
      kind: 'terminal',
      status: 'Failed',
      attemptOutcome: 'Abandoned',
      error: { code: 'lease_expired', retryable: false },
      reason: expect.stringContaining('attempts exhausted') as string,
    });
  });

  it('names an unknown worker when the lease is missing', () => {
    const completion = decideAbandoned({ task: { attempts: 1, maxAttempts: 3, lease: null }, retry, now: FIXED_NOW });

    expect(completion.kind === 'retry' && completion.error.message).toContain('unknown');
  });
});

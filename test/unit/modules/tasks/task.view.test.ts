import { describe, expect, it } from 'vitest';
import { toTaskView } from '../../../../src/modules/tasks/task.view';
import { buildTaskDocument, FIXED_NOW } from '../../../mocks/tasks/taskFixtures';

describe('toTaskView', () => {
  it('exposes status, result and failure details but not internals', () => {
    const view = toTaskView(
      buildTaskDocument({
        status: 'Failed',
        attempts: 2,
        firstStartedAt: FIXED_NOW,
        finishedAt: FIXED_NOW,
        error: { code: 'handler_failed', message: 'boom', retryable: false },
      }),
    );

    expect(view).toMatchObject({
      taskId: 'tsk_00000000-0000-0000-0000-000000000001',
      status: 'Failed',
      attempts: 2,
      startedAt: FIXED_NOW,
      finishedAt: FIXED_NOW,
      error: { code: 'handler_failed', message: 'boom', retryable: false },
    });
    expect(view).not.toHaveProperty('payload');
    expect(view).not.toHaveProperty('lease');
  });

  it('maps attempts and normalises a missing attempt error to null', () => {
    const view = toTaskView(
      buildTaskDocument({
        attemptLog: [
          { n: 1, workerId: 'w1', startedAt: FIXED_NOW, finishedAt: FIXED_NOW, outcome: 'TimedOut' },
          {
            n: 2,
            workerId: 'w2',
            startedAt: FIXED_NOW,
            finishedAt: FIXED_NOW,
            outcome: 'Failed',
            error: { code: 'x', message: 'y', retryable: true },
          },
        ],
      }),
    );

    expect(view.attemptLog).toEqual([
      { n: 1, startedAt: FIXED_NOW, finishedAt: FIXED_NOW, outcome: 'TimedOut', error: null },
      {
        n: 2,
        startedAt: FIXED_NOW,
        finishedAt: FIXED_NOW,
        outcome: 'Failed',
        error: { code: 'x', message: 'y', retryable: true },
      },
    ]);
    expect(JSON.stringify(view)).not.toContain('w1');
  });
});

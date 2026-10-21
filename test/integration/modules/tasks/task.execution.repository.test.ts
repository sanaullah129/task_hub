import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../../../src/database/client';
import { MongooseTaskExecutionRepository } from '../../../../src/modules/tasks/task.execution.repository';
import { MongooseTaskRepository } from '../../../../src/modules/tasks/task.repository';
import type { TaskDocument } from '../../../../src/modules/tasks/task.types';
import { FIXED_NOW, buildTaskDocument } from '../../../mocks/tasks/taskFixtures';
import { setupTestDatabase, teardownTestDatabase } from '../../../mocks/testDatabase';

const GRACE_MS = 5_000;
const at = (offsetMs: number): Date => new Date(FIXED_NOW.getTime() + offsetMs);

describe('task execution repository against MongoDB', () => {
  let database: Database;
  let tasks: MongooseTaskRepository;
  let execution: MongooseTaskExecutionRepository;

  beforeAll(async () => {
    database = await setupTestDatabase();
    tasks = new MongooseTaskRepository(database.tasks);
    execution = new MongooseTaskExecutionRepository(database.tasks);
  });

  afterAll(() => teardownTestDatabase(database));

  beforeEach(async () => {
    await database.tasks.deleteMany({});
  });

  const seed = async (id: string, overrides: Partial<TaskDocument> = {}): Promise<TaskDocument> => {
    const task = buildTaskDocument({ _id: id, idempotencyKey: `idem_${id}`, ...overrides });
    await tasks.insertIdempotent(task);
    return task;
  };

  const claim = (workerId = 'wrk_1', now = FIXED_NOW): Promise<TaskDocument | null> =>
    execution.claimNext({ workerId, now, leaseGraceMs: GRACE_MS });

  const reload = async (id: string): Promise<TaskDocument> => {
    const task = await tasks.findById(id);
    if (task === null) throw new Error(`task ${id} missing`);
    return task;
  };

  describe('claimNext', () => {
    it('claims the oldest due task and records the attempt, lease and history', async () => {
      await seed('tsk_late', { nextRunAt: at(-1_000) });
      await seed('tsk_oldest', { nextRunAt: at(-3_000), timeoutMs: 20_000 });
      await seed('tsk_mid', { nextRunAt: at(-2_000) });

      const claimed = await claim();

      expect(claimed).toMatchObject({
        _id: 'tsk_oldest',
        status: 'Running',
        attempts: 1,
        firstStartedAt: FIXED_NOW,
        updatedAt: FIXED_NOW,
        lease: { workerId: 'wrk_1', expiresAt: at(20_000 + GRACE_MS) },
      });
      expect(claimed?.attemptLog).toEqual([
        { n: 1, workerId: 'wrk_1', startedAt: FIXED_NOW, finishedAt: null, outcome: null },
      ]);
      expect(claimed?.history.at(-1)).toEqual({
        from: 'Pending',
        to: 'Running',
        at: FIXED_NOW,
        reason: 'claimed by wrk_1 (attempt 1)',
      });
      expect((await reload('tsk_mid')).status).toBe('Pending');
    });

    it('returns null when nothing is due', async () => {
      await seed('tsk_future', { nextRunAt: at(60_000) });
      await seed('tsk_running', { status: 'Running' });
      await seed('tsk_done', { status: 'Completed' });

      await expect(claim()).resolves.toBeNull();
    });

    it('hands each task to exactly one of many racing workers', async () => {
      await Promise.all(Array.from({ length: 30 }, (_, i) => seed(`tsk_${i}`, { nextRunAt: at(-i) })));

      const drain = async (workerId: string): Promise<string[]> => {
        const ids: string[] = [];
        for (let task = await claim(workerId); task !== null; task = await claim(workerId)) ids.push(task._id);
        return ids;
      };
      const perWorker = await Promise.all(Array.from({ length: 8 }, (_, i) => drain(`wrk_${i}`)));
      const all = perWorker.flat();

      expect(all).toHaveLength(30);
      expect(new Set(all).size).toBe(30);
      expect(await database.tasks.countDocuments({ status: 'Running', attempts: 1 })).toBe(30);
    });
  });

  describe('completeAttempt', () => {
    const claimed = async (overrides: Partial<TaskDocument> = {}): Promise<TaskDocument> => {
      await seed('tsk_a', overrides);
      const task = await claim();
      if (task === null) throw new Error('expected a claim');
      return task;
    };
    const key = { taskId: 'tsk_a', attempt: 1, workerId: 'wrk_1' };

    it('marks the task Completed with its result and flags the pending event', async () => {
      await claimed();

      const done = await execution.completeAttempt(
        key,
        { kind: 'completed', result: { pages: 3 }, reason: 'attempt 1 succeeded' },
        at(500),
      );

      expect(done).toMatchObject({
        status: 'Completed',
        result: { pages: 3 },
        finishedAt: at(500),
        eventPending: true,
        lease: null,
      });
      expect(done?.attemptLog[0]).toMatchObject({ n: 1, finishedAt: at(500), outcome: 'Completed' });
      expect(done?.history.at(-1)).toMatchObject({ from: 'Running', to: 'Completed', reason: 'attempt 1 succeeded' });
    });

    it('returns the task to Pending with a backoff time on retry', async () => {
      await claimed();
      const error = { code: 'flaky', message: 'try again', retryable: true };

      const retried = await execution.completeAttempt(
        key,
        { kind: 'retry', outcome: 'Failed', error, nextRunAt: at(1_000), reason: 'attempt 1 failed' },
        at(500),
      );

      expect(retried).toMatchObject({ status: 'Pending', nextRunAt: at(1_000), lease: null, finishedAt: null, eventPending: false });
      expect(retried?.attemptLog[0]).toMatchObject({ outcome: 'Failed', finishedAt: at(500), error });
      await expect(claim('wrk_1', at(900))).resolves.toBeNull();
    });

    it('runs a second attempt after a retry and keeps the first start time', async () => {
      await claimed();
      await execution.completeAttempt(
        key,
        {
          kind: 'retry',
          outcome: 'TimedOut',
          error: { code: 'timeout', message: 'slow', retryable: true },
          nextRunAt: at(1_000),
          reason: 'attempt 1 timed out',
        },
        at(500),
      );

      const second = await claim('wrk_2', at(1_000));

      expect(second).toMatchObject({ status: 'Running', attempts: 2, firstStartedAt: FIXED_NOW, lease: { workerId: 'wrk_2' } });
      expect(second?.attemptLog.map((entry) => [entry.n, entry.outcome])).toEqual([
        [1, 'TimedOut'],
        [2, null],
      ]);
    });

    it.each(['Failed', 'TimedOut'] as const)('ends the task as %s with error details', async (status) => {
      await claimed();
      const error = { code: 'boom', message: 'no more retries', retryable: false };

      const done = await execution.completeAttempt(
        key,
        { kind: 'terminal', status, error, reason: 'attempts exhausted' },
        at(700),
      );

      expect(done).toMatchObject({ status, error, finishedAt: at(700), eventPending: true, lease: null });
      expect(done?.attemptLog[0]).toMatchObject({ outcome: status, error });
    });

    it('ignores completions from a different worker or a stale attempt number', async () => {
      await claimed();
      const completion = { kind: 'completed', result: {}, reason: 'late' } as const;

      await expect(execution.completeAttempt({ ...key, workerId: 'wrk_other' }, completion, at(1))).resolves.toBeNull();
      await expect(execution.completeAttempt({ ...key, attempt: 2 }, completion, at(1))).resolves.toBeNull();
      expect(await reload('tsk_a')).toMatchObject({ status: 'Running', lease: { workerId: 'wrk_1' } });
    });

    it('accepts only the first completion of an attempt', async () => {
      await claimed();
      const first = await execution.completeAttempt(key, { kind: 'completed', result: { n: 1 }, reason: 'first' }, at(1));
      const second = await execution.completeAttempt(key, { kind: 'completed', result: { n: 2 }, reason: 'second' }, at(2));

      expect(first).not.toBeNull();
      expect(second).toBeNull();
      expect((await reload('tsk_a')).result).toEqual({ n: 1 });
    });

    it('ignores a completion once the task has been reclaimed by a newer attempt', async () => {
      await claimed();
      await execution.completeAttempt(
        key,
        {
          kind: 'retry',
          outcome: 'TimedOut',
          error: { code: 'timeout', message: 'slow', retryable: true },
          nextRunAt: at(10),
          reason: 'retry',
        },
        at(5),
      );
      await claim('wrk_2', at(10));

      const lateFromFirstAttempt = await execution.completeAttempt(
        key,
        { kind: 'completed', result: {}, reason: 'late' },
        at(20),
      );

      expect(lateFromFirstAttempt).toBeNull();
      expect(await reload('tsk_a')).toMatchObject({ status: 'Running', attempts: 2 });
    });
  });
});

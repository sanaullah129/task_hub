import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../../../src/database/client';
import { MongooseCustomerRepository } from '../../../../src/modules/customers/customer.repository';
import { MongooseTaskExecutionRepository } from '../../../../src/modules/tasks/task.execution.repository';
import { MongooseTaskRecoveryRepository } from '../../../../src/modules/tasks/task.recovery.repository';
import { MongooseTaskRepository } from '../../../../src/modules/tasks/task.repository';
import type { TaskDocument } from '../../../../src/modules/tasks/task.types';
import { FIXED_NOW, buildTaskDocument } from '../../../mocks/tasks/taskFixtures';
import { setupTestDatabase, teardownTestDatabase } from '../../../mocks/testDatabase';

const at = (offsetMs: number): Date => new Date(FIXED_NOW.getTime() + offsetMs);

describe('task recovery, listing and customers against MongoDB', () => {
  let database: Database;
  let tasks: MongooseTaskRepository;
  let recovery: MongooseTaskRecoveryRepository;
  let execution: MongooseTaskExecutionRepository;
  let customers: MongooseCustomerRepository;

  beforeAll(async () => {
    database = await setupTestDatabase();
    tasks = new MongooseTaskRepository(database.tasks);
    recovery = new MongooseTaskRecoveryRepository(database.tasks);
    execution = new MongooseTaskExecutionRepository(database.tasks);
    customers = new MongooseCustomerRepository(database.customers);
  });

  afterAll(() => teardownTestDatabase(database));

  beforeEach(async () => {
    await Promise.all([database.tasks.deleteMany({}), database.customers.deleteMany({})]);
  });

  const seed = (id: string, overrides: Partial<TaskDocument> = {}) =>
    tasks.insertIdempotent(buildTaskDocument({ _id: id, idempotencyKey: `idem_${id}`, ...overrides }));

  const running = (id: string, expiresAt: Date, overrides: Partial<TaskDocument> = {}) =>
    seed(id, {
      status: 'Running',
      attempts: 1,
      lease: { workerId: 'wrk_dead', expiresAt },
      attemptLog: [{ n: 1, workerId: 'wrk_dead', startedAt: FIXED_NOW, finishedAt: null, outcome: null }],
      ...overrides,
    });

  describe('recovery queries', () => {
    it('finds Running tasks whose lease expired, oldest lease first, honouring the limit', async () => {
      await running('t_late', at(-1_000));
      await running('t_early', at(-5_000));
      await running('t_live', at(60_000));
      await seed('t_pending');

      const expired = await recovery.findLeaseExpired(FIXED_NOW, 10);

      expect(expired.map((task) => task._id)).toEqual(['t_early', 't_late']);
      expect(await recovery.findLeaseExpired(FIXED_NOW, 1)).toHaveLength(1);
    });

    it('finds terminal tasks waiting for their event and clears the flag once emitted', async () => {
      await seed('t_a', { status: 'Completed', finishedAt: at(2), eventPending: true });
      await seed('t_b', { status: 'Failed', finishedAt: at(1), eventPending: true });
      await seed('t_c', { status: 'Completed', finishedAt: at(3), eventPending: false });

      expect((await recovery.findEventPending(10)).map((task) => task._id)).toEqual(['t_b', 't_a']);

      await recovery.markEventEmitted('t_b');

      expect((await recovery.findEventPending(10)).map((task) => task._id)).toEqual(['t_a']);
      await expect(recovery.markEventEmitted('t_missing')).resolves.toBeUndefined();
    });
  });

  describe('lease recovery through completeAttempt', () => {
    const abandoned = {
      kind: 'retry',
      outcome: 'Abandoned',
      error: { code: 'lease_expired', message: 'worker vanished', retryable: true },
      nextRunAt: at(1_000),
      reason: 'lease expired',
    } as const;

    it('requeues an expired attempt and records it as Abandoned', async () => {
      await running('t_a', at(-1_000));

      const updated = await execution.completeAttempt(
        { taskId: 't_a', attempt: 1, workerId: 'wrk_dead', leaseExpiredBefore: FIXED_NOW },
        abandoned,
        FIXED_NOW,
      );

      expect(updated).toMatchObject({ status: 'Pending', lease: null, nextRunAt: at(1_000) });
      expect(updated?.attemptLog[0]).toMatchObject({ outcome: 'Abandoned', error: { code: 'lease_expired' } });
    });

    it('refuses to recover an attempt whose lease is still valid', async () => {
      await running('t_live', at(30_000));

      const updated = await execution.completeAttempt(
        { taskId: 't_live', attempt: 1, workerId: 'wrk_dead', leaseExpiredBefore: FIXED_NOW },
        abandoned,
        FIXED_NOW,
      );

      expect(updated).toBeNull();
      expect((await tasks.findById('t_live'))?.status).toBe('Running');
    });

    it('records the Abandoned outcome when the last attempt is abandoned and the task fails', async () => {
      await running('t_last', at(-1_000), { attempts: 3, attemptLog: [{ n: 3, workerId: 'wrk_dead', startedAt: FIXED_NOW, finishedAt: null, outcome: null }] });

      const updated = await execution.completeAttempt(
        { taskId: 't_last', attempt: 3, workerId: 'wrk_dead', leaseExpiredBefore: FIXED_NOW },
        {
          kind: 'terminal',
          status: 'Failed',
          attemptOutcome: 'Abandoned',
          error: { code: 'lease_expired', message: 'gone', retryable: false },
          reason: 'attempts exhausted',
        },
        FIXED_NOW,
      );

      expect(updated).toMatchObject({ status: 'Failed', eventPending: true });
      expect(updated?.attemptLog[0]?.outcome).toBe('Abandoned');
    });
  });

  describe('task listing', () => {
    it('lists newest first with filters and a stable cursor', async () => {
      for (let i = 1; i <= 5; i++) {
        await seed(`t${i}`, { customerId: i % 2 === 0 ? 'cust_b' : 'cust_a', createdAt: at(i * 1_000), status: i <= 3 ? 'Completed' : 'Pending' });
      }
      // Same timestamp as t5 to exercise the _id tiebreak.
      await seed('t5b', { customerId: 'cust_a', createdAt: at(5_000) });

      const first = await tasks.list({ limit: 3 });
      const second = await tasks.list({ limit: 3, cursor: first.nextCursor ?? '' });

      expect(first.items.map((task) => task._id)).toEqual(['t5b', 't5', 't4']);
      expect(second.items.map((task) => task._id)).toEqual(['t3', 't2', 't1']);
      expect(second.nextCursor).toBeNull();
      expect((await tasks.list({ customerId: 'cust_b', limit: 10 })).items.map((task) => task._id)).toEqual(['t4', 't2']);
      expect((await tasks.list({ status: 'Completed', limit: 10 })).items).toHaveLength(3);
    });
  });

  describe('customers', () => {
    it('upserts a webhook, keeping the creation time and replacing the configuration', async () => {
      expect(await customers.findById('cust_a')).toBeNull();

      const created = await customers.upsertWebhook('cust_a', { url: 'https://one.example.com/', secret: 's'.repeat(20) }, at(1));
      const updated = await customers.upsertWebhook('cust_a', { url: 'https://two.example.com/', secret: 't'.repeat(20) }, at(2));

      expect(created).toMatchObject({ _id: 'cust_a', createdAt: at(1), updatedAt: at(1) });
      expect(updated).toMatchObject({ createdAt: at(1), updatedAt: at(2), webhook: { url: 'https://two.example.com/', secret: 't'.repeat(20) } });
      expect(await database.customers.countDocuments()).toBe(1);
      expect(await customers.findById('cust_a')).toMatchObject({ webhook: { url: 'https://two.example.com/' } });
    });
  });
});

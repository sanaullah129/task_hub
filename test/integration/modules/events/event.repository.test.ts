import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../../../src/database/client';
import { MongooseEventRepository } from '../../../../src/modules/events/event.repository';
import { decodeCursor } from '../../../../src/shared/utils/pagination';
import { buildEventDocument } from '../../../mocks/events/eventFixtures';
import { FIXED_NOW } from '../../../mocks/tasks/taskFixtures';
import { setupTestDatabase, teardownTestDatabase } from '../../../mocks/testDatabase';

const at = (offsetMs: number): Date => new Date(FIXED_NOW.getTime() + offsetMs);

describe('event repository against MongoDB', () => {
  let database: Database;
  let events: MongooseEventRepository;

  beforeAll(async () => {
    database = await setupTestDatabase();
    events = new MongooseEventRepository(database.events);
  });

  afterAll(() => teardownTestDatabase(database));

  beforeEach(async () => {
    await database.events.deleteMany({});
  });

  const seed = (id: string, overrides: Parameters<typeof buildEventDocument>[0] = {}) =>
    events.insertIdempotent(buildEventDocument({ _id: id, taskId: `tsk_${id}`, ...overrides }));

  const claim = (workerId = 'dlv_1', now = FIXED_NOW) => events.claimNextDelivery({ workerId, now, leaseMs: 10_000 });

  describe('insertIdempotent', () => {
    it('stores one event per task outcome and returns the existing one on a duplicate', async () => {
      const first = await seed('a', { taskId: 'tsk_same' });
      const second = await events.insertIdempotent(buildEventDocument({ _id: 'evt_other', taskId: 'tsk_same' }));

      expect(first.created).toBe(true);
      expect(second).toMatchObject({ created: false, event: { _id: 'a' } });
      expect(await database.events.countDocuments()).toBe(1);
    });

    it('allows different outcomes for the same task and rethrows other duplicate-key errors', async () => {
      await seed('a', { taskId: 'tsk_same' });
      const other = await events.insertIdempotent(buildEventDocument({ _id: 'b', taskId: 'tsk_same', eventType: 'task.failed' }));

      expect(other.created).toBe(true);
      await expect(events.insertIdempotent(buildEventDocument({ _id: 'a', taskId: 'tsk_diff' }))).rejects.toMatchObject({ code: 11000 });
    });

    it('round-trips dates, delivery state and the body', async () => {
      await seed('a');

      const stored = await events.findById('a');

      expect(stored).toMatchObject({
        taskFinishedAt: FIXED_NOW,
        delivery: { status: 'Pending', lease: null, deliveredAt: null, attempts: [] },
        body: { eventId: 'a' },
      });
      expect(await events.findById('missing')).toBeNull();
    });
  });

  describe('claimNextDelivery', () => {
    it('leases the oldest due Pending delivery', async () => {
      const base = buildEventDocument();
      await seed('late', { delivery: { ...base.delivery, nextAttemptAt: at(-1_000) } });
      await seed('oldest', { delivery: { ...base.delivery, nextAttemptAt: at(-3_000) } });

      const claimed = await claim();

      expect(claimed).toMatchObject({ _id: 'oldest', delivery: { lease: { workerId: 'dlv_1', expiresAt: at(10_000) } } });
    });

    it('skips future, settled and currently leased deliveries', async () => {
      const base = buildEventDocument();
      await seed('future', { delivery: { ...base.delivery, nextAttemptAt: at(60_000) } });
      await seed('done', { delivery: { ...base.delivery, status: 'Delivered', nextAttemptAt: null } });
      await seed('skipped', { delivery: { ...base.delivery, status: 'Skipped', nextAttemptAt: null } });
      await seed('leased', { delivery: { ...base.delivery, lease: { workerId: 'dlv_other', expiresAt: at(5_000) } } });

      await expect(claim()).resolves.toBeNull();
    });

    it('takes over a delivery whose lease has expired', async () => {
      const base = buildEventDocument();
      await seed('stuck', { delivery: { ...base.delivery, lease: { workerId: 'dlv_dead', expiresAt: at(-1) } } });

      await expect(claim('dlv_2')).resolves.toMatchObject({ _id: 'stuck', delivery: { lease: { workerId: 'dlv_2' } } });
    });

    it('hands each delivery to exactly one of many racing workers', async () => {
      await Promise.all(Array.from({ length: 25 }, (_, i) => seed(`e${i}`)));

      const drain = async (workerId: string): Promise<string[]> => {
        const ids: string[] = [];
        for (let event = await claim(workerId); event !== null; event = await claim(workerId)) ids.push(event._id);
        return ids;
      };
      const all = (await Promise.all(Array.from({ length: 6 }, (_, i) => drain(`dlv_${i}`)))).flat();

      expect(all).toHaveLength(25);
      expect(new Set(all).size).toBe(25);
    });
  });

  describe('recordAttempt', () => {
    const attempt = (n: number, statusCode?: number) => ({ n, startedAt: at(n), durationMs: 20, ...(statusCode === undefined ? {} : { statusCode }) });

    it('marks the event Delivered and stores the attempt', async () => {
      await seed('a');
      await claim();

      const updated = await events.recordAttempt('a', 'dlv_1', attempt(1, 200), { kind: 'delivered', deliveredAt: at(50) });

      expect(updated?.delivery).toMatchObject({
        status: 'Delivered',
        attemptCount: 1,
        deliveredAt: at(50),
        nextAttemptAt: null,
        lease: null,
        lastError: null,
        attempts: [{ n: 1, statusCode: 200, durationMs: 20 }],
      });
    });

    it('keeps the event Pending with the next attempt time and error on retry', async () => {
      await seed('a');
      await claim();

      const updated = await events.recordAttempt('a', 'dlv_1', attempt(1, 500), {
        kind: 'retry',
        nextAttemptAt: at(2_000),
        lastError: 'HTTP 500',
      });

      expect(updated?.delivery).toMatchObject({ status: 'Pending', attemptCount: 1, nextAttemptAt: at(2_000), lastError: 'HTTP 500', lease: null });
      await expect(claim('dlv_1', at(1_000))).resolves.toBeNull();
      await expect(claim('dlv_1', at(2_000))).resolves.toMatchObject({ _id: 'a' });
    });

    it('accumulates attempts and ends Failed', async () => {
      await seed('a');
      await claim();
      await events.recordAttempt('a', 'dlv_1', attempt(1, 500), { kind: 'retry', nextAttemptAt: at(1), lastError: 'HTTP 500' });
      await claim('dlv_1', at(1));

      const updated = await events.recordAttempt('a', 'dlv_1', attempt(2, 410), { kind: 'failed', lastError: 'HTTP 410 (permanent failure)' });

      expect(updated?.delivery).toMatchObject({ status: 'Failed', attemptCount: 2, nextAttemptAt: null, lastError: 'HTTP 410 (permanent failure)' });
      expect(updated?.delivery.attempts.map((entry) => entry.n)).toEqual([1, 2]);
    });

    it('ignores results from a worker that no longer holds the lease or for settled events', async () => {
      await seed('a');
      await claim();

      expect(await events.recordAttempt('a', 'dlv_other', attempt(1, 200), { kind: 'delivered', deliveredAt: at(1) })).toBeNull();
      await events.recordAttempt('a', 'dlv_1', attempt(1, 200), { kind: 'delivered', deliveredAt: at(1) });
      expect(await events.recordAttempt('a', 'dlv_1', attempt(2, 200), { kind: 'delivered', deliveredAt: at(2) })).toBeNull();
      expect((await events.findById('a'))?.delivery.attemptCount).toBe(1);
    });
  });

  describe('requeueFailed', () => {
    const failed = async (id: string): Promise<void> => {
      const base = buildEventDocument();
      await seed(id, { delivery: { ...base.delivery, status: 'Failed', attemptCount: 6, nextAttemptAt: null, lastError: 'HTTP 500 (attempts exhausted)' } });
    };

    it('moves a Failed delivery back to Pending with a fresh attempt budget', async () => {
      await failed('a');

      const requeued = await events.requeueFailed('a', 6, at(100));

      expect(requeued?.delivery).toMatchObject({ status: 'Pending', nextAttemptAt: at(100), maxAttempts: 12, attemptCount: 6, lease: null });
      await expect(claim('dlv_1', at(100))).resolves.toMatchObject({ _id: 'a' });
    });

    it('does nothing for deliveries that are not Failed', async () => {
      await seed('p');

      expect(await events.requeueFailed('p', 6, at(1))).toBeNull();
      expect(await events.requeueFailed('missing', 6, at(1))).toBeNull();
    });
  });

  describe('queries', () => {
    it('finds the events of a task oldest first', async () => {
      await seed('a', { taskId: 'tsk_x', createdAt: at(2) });
      await seed('b', { taskId: 'tsk_x', eventType: 'task.failed', createdAt: at(1) });
      await seed('c', { taskId: 'tsk_y' });

      expect((await events.findByTaskId('tsk_x')).map((event) => event._id)).toEqual(['b', 'a']);
    });

    it('lists newest first with filters and cursor pagination', async () => {
      const base = buildEventDocument();
      for (let i = 1; i <= 5; i++) {
        await seed(`e${i}`, {
          customerId: i % 2 === 0 ? 'cust_b' : 'cust_a',
          createdAt: at(i * 1_000),
          delivery: { ...base.delivery, status: i <= 3 ? 'Failed' : 'Pending' },
        });
      }

      const first = await events.list({ status: 'Failed', limit: 2 });
      const second = await events.list({ status: 'Failed', limit: 2, cursor: first.nextCursor ?? '' });
      const byCustomer = await events.list({ customerId: 'cust_b', limit: 10 });

      expect(first.items.map((event) => event._id)).toEqual(['e3', 'e2']);
      expect(decodeCursor(first.nextCursor ?? '').id).toBe('e2');
      expect(second.items.map((event) => event._id)).toEqual(['e1']);
      expect(second.nextCursor).toBeNull();
      expect(byCustomer.items.map((event) => event._id)).toEqual(['e4', 'e2']);
    });
  });
});

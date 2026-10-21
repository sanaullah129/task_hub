import request, { type Response } from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildHarness, type Harness } from '../../../mocks/harness';
import { buildEventDocument } from '../../../mocks/events/eventFixtures';
import { FIXED_NOW } from '../../../mocks/tasks/taskFixtures';
import type { EventDocument } from '../../../../src/modules/events/event.types';

const bodyOf = (res: Response): Record<string, unknown> => res.body as Record<string, unknown>;
const itemsOf = (res: Response): Array<Record<string, unknown>> => bodyOf(res)['items'] as Array<Record<string, unknown>>;
const errorOf = (res: Response): Record<string, unknown> => bodyOf(res)['error'] as Record<string, unknown>;

const failed = (id: string, customerId: string, minute: number): EventDocument => {
  const base = buildEventDocument({ _id: id, customerId, createdAt: new Date(FIXED_NOW.getTime() + minute * 60_000) });
  return {
    ...base,
    delivery: {
      ...base.delivery,
      status: 'Failed',
      attemptCount: 2,
      nextAttemptAt: null,
      lastError: 'HTTP 500 (attempts exhausted)',
      lease: { workerId: 'wrk_secret', expiresAt: FIXED_NOW },
      attempts: [
        { n: 1, startedAt: FIXED_NOW, durationMs: 40, statusCode: 500, responseSnippet: 'oops' },
        { n: 2, startedAt: FIXED_NOW, durationMs: 5, error: 'ECONNREFUSED' },
      ],
    },
  };
};

describe('event routes', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = buildHarness();
  });

  describe('GET /v1/tasks/:taskId/events', () => {
    it('returns the events of a task with delivery attempts and no internal lease data', async () => {
      harness.events.add(failed('evt_1', 'cust_a', 1));
      harness.events.add(buildEventDocument({ _id: 'evt_other', taskId: 'tsk_other' }));

      const res = await request(harness.app).get('/v1/tasks/tsk_00000000-0000-0000-0000-000000000001/events');

      expect(res.status).toBe(200);
      expect(itemsOf(res)).toHaveLength(1);
      expect(itemsOf(res)[0]).toMatchObject({
        eventId: 'evt_1',
        eventType: 'task.completed',
        delivery: {
          status: 'Failed',
          attemptCount: 2,
          lastError: 'HTTP 500 (attempts exhausted)',
          attempts: [
            { n: 1, statusCode: 500, error: null, responseSnippet: 'oops', durationMs: 40 },
            { n: 2, statusCode: null, error: 'ECONNREFUSED', responseSnippet: null },
          ],
        },
      });
      expect(JSON.stringify(res.body)).not.toContain('wrk_secret');
    });

    it('returns an empty list for a task without events', async () => {
      const res = await request(harness.app).get('/v1/tasks/tsk_none/events');

      expect(res.status).toBe(200);
      expect(itemsOf(res)).toEqual([]);
    });
  });

  describe('GET /v1/deliveries', () => {
    beforeEach(() => {
      harness.events.add(failed('evt_1', 'cust_a', 1));
      harness.events.add(failed('evt_2', 'cust_b', 2));
      harness.events.add(failed('evt_3', 'cust_a', 3));
      harness.events.add(buildEventDocument({ _id: 'evt_4', customerId: 'cust_a', createdAt: new Date(FIXED_NOW.getTime() + 4 * 60_000) }));
    });

    it('filters by delivery status and customer, newest first', async () => {
      const failedOnly = await request(harness.app).get('/v1/deliveries?status=Failed');
      const forCustomer = await request(harness.app).get('/v1/deliveries?status=Failed&customerId=cust_a');

      expect(itemsOf(failedOnly).map((item) => item['eventId'])).toEqual(['evt_3', 'evt_2', 'evt_1']);
      expect(itemsOf(forCustomer).map((item) => item['eventId'])).toEqual(['evt_3', 'evt_1']);
    });

    it('paginates with a cursor', async () => {
      const first = await request(harness.app).get('/v1/deliveries?status=Failed&limit=2');
      const second = await request(harness.app).get(
        `/v1/deliveries?status=Failed&limit=2&cursor=${String(bodyOf(first)['nextCursor'])}`,
      );

      expect(itemsOf(first).map((item) => item['eventId'])).toEqual(['evt_3', 'evt_2']);
      expect(itemsOf(second).map((item) => item['eventId'])).toEqual(['evt_1']);
      expect(bodyOf(second)['nextCursor']).toBeNull();
    });

    it.each(['status=Nope', 'limit=0', 'limit=abc', 'cursor=garbage'])('rejects invalid query %s', async (query) => {
      const res = await request(harness.app).get(`/v1/deliveries?${query}`);

      expect(res.status).toBe(400);
      expect(errorOf(res)['code']).toBe('validation_error');
    });
  });

  describe('POST /v1/deliveries/:eventId/retry', () => {
    it('requeues a failed delivery and returns 202', async () => {
      harness.events.add(failed('evt_1', 'cust_a', 1));

      const res = await request(harness.app).post('/v1/deliveries/evt_1/retry');

      expect(res.status).toBe(202);
      expect(bodyOf(res)['delivery']).toMatchObject({ status: 'Pending', maxAttempts: 8 });
    });

    it('returns 404 for an unknown event and 409 when the delivery is not Failed', async () => {
      harness.events.add(buildEventDocument({ _id: 'evt_p' }));

      expect((await request(harness.app).post('/v1/deliveries/evt_missing/retry')).status).toBe(404);
      const conflict = await request(harness.app).post('/v1/deliveries/evt_p/retry');
      expect(conflict.status).toBe(409);
      expect(errorOf(conflict)['code']).toBe('delivery_not_retryable');
    });
  });
});

import request, { type Response } from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildHarness, type Harness } from '../../../mocks/harness';
import { FIXED_NOW, buildTaskDocument } from '../../../mocks/tasks/taskFixtures';

const bodyOf = (res: Response): Record<string, unknown> => res.body as Record<string, unknown>;
const idsOf = (res: Response): unknown[] =>
  (bodyOf(res)['items'] as Array<Record<string, unknown>>).map((item) => item['taskId']);

describe('GET /v1/tasks', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = buildHarness();
    const at = (minute: number): Date => new Date(FIXED_NOW.getTime() + minute * 60_000);
    harness.tasks.tasks.set('tsk_1', buildTaskDocument({ _id: 'tsk_1', idempotencyKey: 'k1', customerId: 'cust_a', createdAt: at(1) }));
    harness.tasks.tasks.set('tsk_2', buildTaskDocument({ _id: 'tsk_2', idempotencyKey: 'k2', customerId: 'cust_b', createdAt: at(2), status: 'Completed' }));
    harness.tasks.tasks.set('tsk_3', buildTaskDocument({ _id: 'tsk_3', idempotencyKey: 'k3', customerId: 'cust_a', createdAt: at(3), status: 'Completed' }));
    harness.tasks.tasks.set('tsk_4', buildTaskDocument({ _id: 'tsk_4', idempotencyKey: 'k4', customerId: 'cust_a', createdAt: at(4) }));
  });

  it('lists tasks newest first', async () => {
    const res = await request(harness.app).get('/v1/tasks');

    expect(res.status).toBe(200);
    expect(idsOf(res)).toEqual(['tsk_4', 'tsk_3', 'tsk_2', 'tsk_1']);
    expect(bodyOf(res)['nextCursor']).toBeNull();
  });

  it('filters by customer and status', async () => {
    expect(idsOf(await request(harness.app).get('/v1/tasks?customerId=cust_a'))).toEqual(['tsk_4', 'tsk_3', 'tsk_1']);
    expect(idsOf(await request(harness.app).get('/v1/tasks?customerId=cust_a&status=Completed'))).toEqual(['tsk_3']);
  });

  it('paginates with a cursor until the end', async () => {
    const first = await request(harness.app).get('/v1/tasks?limit=3');
    const second = await request(harness.app).get(`/v1/tasks?limit=3&cursor=${String(bodyOf(first)['nextCursor'])}`);

    expect(idsOf(first)).toEqual(['tsk_4', 'tsk_3', 'tsk_2']);
    expect(idsOf(second)).toEqual(['tsk_1']);
    expect(bodyOf(second)['nextCursor']).toBeNull();
  });

  it.each(['status=Retrying', 'customerId=bad%20id', 'limit=1000', 'cursor=bad'])('rejects %s with 400', async (query) => {
    expect((await request(harness.app).get(`/v1/tasks?${query}`)).status).toBe(400);
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../src/app';
import { createContainer, type Container } from '../../src/container';
import type { Database } from '../../src/database/client';
import { verifySignature } from '../../src/modules/delivery';
import { buildTaskDocument } from '../mocks/tasks/taskFixtures';
import { silentLogger, testConfig } from '../mocks/helpers';
import { setupTestDatabase, teardownTestDatabase } from '../mocks/testDatabase';
import { TestReceiver } from '../mocks/webhookReceiver';

const config = testConfig({
  DEMO_MODE: 'true',
  TASK_TIMEOUT_MS: '150',
  TASK_MAX_ATTEMPTS: '3',
  TASK_RETRY_BASE_MS: '10',
  TASK_RETRY_CAP_MS: '20',
  TASK_POLL_INTERVAL_MS: '10',
  TASK_LEASE_GRACE_MS: '50',
  TASK_SHUTDOWN_TIMEOUT_MS: '2000',
  DELIVERY_POLL_INTERVAL_MS: '10',
  DELIVERY_BACKOFF_BASE_MS: '10',
  DELIVERY_BACKOFF_CAP_MS: '20',
  DELIVERY_TIMEOUT_MS: '500',
  DELIVERY_MAX_ATTEMPTS: '4',
  RECONCILER_INTERVAL_MS: '50',
});

type Json = Record<string, unknown>;

describe('TaskHub end to end (API, worker, reconciler, delivery) against MongoDB', () => {
  let database: Database;
  let container: Container;
  let app: Express;
  let receiver: TestReceiver;
  let counter = 0;

  beforeAll(async () => {
    receiver = new TestReceiver();
    await receiver.start();
    database = await setupTestDatabase();
    container = createContainer({ config, logger: silentLogger(), database });
    app = createApp({ config, logger: silentLogger(), routes: container.routes, metrics: container.metrics });
    for (const lifecycle of container.lifecycles) lifecycle.start();
  });

  afterAll(async () => {
    await Promise.all(container.lifecycles.map((lifecycle) => lifecycle.stop()));
    await teardownTestDatabase(database);
    await receiver.stop();
  });

  beforeEach(async () => {
    await Promise.all([database.tasks.deleteMany({}), database.events.deleteMany({}), database.customers.deleteMany({})]);
  });

  const wait = <T>(check: () => Promise<T>): Promise<T> => vi.waitFor(check, { timeout: 10_000, interval: 25 });

  async function configureCustomer(name: string, hookPath = `/hook/${name}`): Promise<{ customerId: string; secret: string; path: string }> {
    const customerId = `cust_${name}`;
    const res = await request(app).put(`/v1/customers/${customerId}/webhook`).send({ url: receiver.url(hookPath) });
    expect(res.status).toBe(200);
    return { customerId, secret: String((res.body as Json)['secret']), path: hookPath };
  }

  async function submit(customerId: string, simulate: Json = {}, extra: Json = {}): Promise<string> {
    counter += 1;
    const res = await request(app)
      .post('/v1/tasks')
      .set('X-Correlation-Id', `e2e-${counter}`)
      .send({
        customerId,
        taskType: 'document_processing',
        payload: { documentId: `doc_${counter}`, simulate: { durationMs: 5, ...simulate } },
        idempotencyKey: `idem_${counter}`,
        ...extra,
      });
    expect(res.status).toBe(202);
    return String((res.body as Json)['taskId']);
  }

  const getTask = async (taskId: string): Promise<Json> => (await request(app).get(`/v1/tasks/${taskId}`)).body as Json;

  const taskEnded = (taskId: string): Promise<Json> =>
    wait(async () => {
      const task = await getTask(taskId);
      if (!['Completed', 'Failed', 'TimedOut'].includes(String(task['status']))) throw new Error(`task is ${String(task['status'])}`);
      return task;
    });

  const eventsOf = async (taskId: string): Promise<Json[]> =>
    ((await request(app).get(`/v1/tasks/${taskId}/events`)).body as { items: Json[] }).items;

  const deliveryEnded = (taskId: string, wanted: string[] = ['Delivered', 'Failed', 'Skipped']): Promise<Json> =>
    wait(async () => {
      const [event] = await eventsOf(taskId);
      const status = (event?.['delivery'] as Json | undefined)?.['status'];
      if (event === undefined || !wanted.includes(String(status))) throw new Error(`delivery is ${String(status)}`);
      return event;
    });

  it('normal task: accepted, executed, retrievable, and a signed webhook is delivered', async () => {
    const { customerId, secret, path } = await configureCustomer('normal');

    const taskId = await submit(customerId);
    const task = await taskEnded(taskId);
    const event = await deliveryEnded(taskId);

    expect(task).toMatchObject({ status: 'Completed', attempts: 1, correlationId: `e2e-${counter}` });
    expect(task['result']).toMatchObject({ status: 'processed' });
    expect(event).toMatchObject({ eventType: 'task.completed', delivery: { status: 'Delivered', attemptCount: 1 } });
    expect((event['delivery'] as { attempts: Json[] }).attempts[0]).toMatchObject({ n: 1, statusCode: 200 });

    const [webhook] = receiver.received(path);
    expect(receiver.received(path)).toHaveLength(1);
    expect(JSON.parse(webhook?.body ?? '{}')).toMatchObject({
      eventId: event['eventId'],
      eventType: 'task.completed',
      taskId,
      customerId,
      correlationId: `e2e-${counter}`,
      data: { status: 'Completed', attempts: 1 },
    });
    expect(webhook?.headers['x-taskhub-event-id']).toBe(event['eventId']);
    expect(webhook?.headers['x-taskhub-correlation-id']).toBe(`e2e-${counter}`);
    expect(verifySignature({ secret, header: String(webhook?.headers['x-taskhub-signature']), body: webhook?.body ?? '' })).toBe(true);
    expect((await database.tasks.findById(taskId).lean())?.eventPending).toBe(false);
  });

  it('failed task: failure details are recorded and a task.failed event is delivered', async () => {
    const { customerId, path } = await configureCustomer('failed');

    const taskId = await submit(customerId, { failure: 'fatal' });
    const task = await taskEnded(taskId);
    const event = await deliveryEnded(taskId);

    expect(task).toMatchObject({ status: 'Failed', attempts: 1, error: { code: 'simulated_fatal', retryable: false } });
    expect(event).toMatchObject({ eventType: 'task.failed', delivery: { status: 'Delivered' } });
    expect(JSON.parse(receiver.received(path)[0]?.body ?? '{}')).toMatchObject({ data: { status: 'Failed', error: { code: 'simulated_fatal' } } });
  });

  it('timed-out task: retried, ends TimedOut, and a task.timed_out event is delivered', async () => {
    const { customerId } = await configureCustomer('timeout');

    const taskId = await submit(customerId, { failure: 'hang' });
    const task = await taskEnded(taskId);
    const event = await deliveryEnded(taskId);

    expect(task).toMatchObject({ status: 'TimedOut', attempts: 3, error: { code: 'timeout' } });
    expect((task['attemptLog'] as Json[]).map((attempt) => attempt['outcome'])).toEqual(['TimedOut', 'TimedOut', 'TimedOut']);
    expect(event).toMatchObject({ eventType: 'task.timed_out', delivery: { status: 'Delivered' } });
  });

  it('duplicate submission: concurrent identical requests create one task and one notification', async () => {
    const { customerId, path } = await configureCustomer('dup');
    const body = {
      customerId,
      taskType: 'data_sync',
      payload: { source: 'a', target: 'b', simulate: { durationMs: 5 } },
      idempotencyKey: 'same-key',
    };

    const responses = await Promise.all(Array.from({ length: 12 }, () => request(app).post('/v1/tasks').send(body)));
    const ids = new Set(responses.map((res) => String((res.body as Json)['taskId'])));
    const conflict = await request(app).post('/v1/tasks').send({ ...body, payload: { source: 'x', target: 'y' } });

    expect(ids.size).toBe(1);
    expect(responses.filter((res) => res.status === 202)).toHaveLength(1);
    expect(responses.filter((res) => res.status === 200)).toHaveLength(11);
    expect(conflict.status).toBe(409);

    const [taskId] = [...ids];
    await taskEnded(String(taskId));
    await deliveryEnded(String(taskId));
    expect(await database.tasks.countDocuments({ customerId })).toBe(1);
    expect(await database.events.countDocuments({ customerId })).toBe(1);
    expect(receiver.received(path)).toHaveLength(1);
  });

  it('webhook endpoint failure: attempts are recorded, retried with backoff, and eventually delivered', async () => {
    const { customerId, path } = await configureCustomer('flaky');
    receiver.behave(path, { failFirst: 2, status: 503 });

    const taskId = await submit(customerId);
    const event = await deliveryEnded(taskId);

    const delivery = event['delivery'] as { status: string; attemptCount: number; attempts: Json[]; lastError: unknown };
    expect(delivery.status).toBe('Delivered');
    expect(delivery.attemptCount).toBe(3);
    expect(delivery.attempts.map((attempt) => attempt['statusCode'])).toEqual([503, 503, 200]);
    expect(delivery.lastError).toBeNull();
    expect(new Set(receiver.received(path).map((webhook) => webhook.headers['x-taskhub-event-id'])).size).toBe(1);
    expect(receiver.received(path).map((webhook) => webhook.headers['x-taskhub-delivery-attempt'])).toEqual(['1', '2', '3']);
  });

  it('endpoint that never recovers: delivery ends Failed, is visible to operators, and can be replayed', async () => {
    const { customerId, path } = await configureCustomer('dead');
    receiver.behave(path, { always: true, status: 500 });

    const taskId = await submit(customerId);
    const event = await deliveryEnded(taskId, ['Failed']);

    expect(event).toMatchObject({ delivery: { status: 'Failed', attemptCount: 4, lastError: 'HTTP 500 (attempts exhausted)' } });
    expect((await taskEnded(taskId))['status']).toBe('Completed');

    const failed = await request(app).get(`/v1/deliveries?status=Failed&customerId=${customerId}`);
    expect(((failed.body as { items: Json[] }).items).map((item) => item['eventId'])).toEqual([event['eventId']]);

    receiver.behave(path, {});
    const retried = await request(app).post(`/v1/deliveries/${String(event['eventId'])}/retry`);
    expect(retried.status).toBe(202);

    const redelivered = await deliveryEnded(taskId, ['Delivered']);
    expect(redelivered).toMatchObject({ delivery: { status: 'Delivered', attemptCount: 5 } });
    expect((await request(app).post(`/v1/deliveries/${String(event['eventId'])}/retry`)).status).toBe(409);
  });

  it('task-level webhook override is used instead of the customer default', async () => {
    const { customerId, path } = await configureCustomer('override');

    const taskId = await submit(customerId, {}, { webhookUrl: receiver.url('/hook/override-specific') });
    await deliveryEnded(taskId, ['Delivered']);

    expect(receiver.received('/hook/override-specific')).toHaveLength(1);
    expect(receiver.received(path)).toHaveLength(0);
  });

  it('customer without a webhook: the event is recorded as Skipped', async () => {
    const taskId = await submit('cust_nohook');

    const event = await deliveryEnded(taskId);

    expect(event).toMatchObject({ url: null, delivery: { status: 'Skipped', attemptCount: 0 } });
  });

  it('restart recovery: an attempt whose worker died is recovered and completed', async () => {
    const { customerId, path } = await configureCustomer('recover');
    const created = await database.tasks.create(
      buildTaskDocument({
        _id: 'tsk_recover_1',
        customerId,
        idempotencyKey: 'recover-1',
        payload: { documentId: 'doc_r', simulate: { durationMs: 5 } },
        status: 'Running',
        attempts: 1,
        timeoutMs: 150,
        nextRunAt: new Date(Date.now() - 5_000),
        createdAt: new Date(Date.now() - 5_000),
        lease: { workerId: 'wrk_crashed', expiresAt: new Date(Date.now() - 1_000) },
        attemptLog: [{ n: 1, workerId: 'wrk_crashed', startedAt: new Date(Date.now() - 4_000), finishedAt: null, outcome: null }],
        history: [
          { from: null, to: 'Pending', at: new Date(Date.now() - 5_000), reason: 'submitted' },
          { from: 'Pending', to: 'Running', at: new Date(Date.now() - 4_000), reason: 'claimed by wrk_crashed (attempt 1)' },
        ],
        firstStartedAt: new Date(Date.now() - 4_000),
      }),
    );

    const task = await taskEnded(created._id);
    await deliveryEnded(created._id);

    expect(task).toMatchObject({ status: 'Completed', attempts: 2 });
    expect((task['attemptLog'] as Json[]).map((attempt) => attempt['outcome'])).toEqual(['Abandoned', 'Completed']);
    expect(receiver.received(path)).toHaveLength(1);
    const investigation = (await request(app).get(`/v1/ops/tasks/${created._id}/investigation`)).body as Json;
    expect(JSON.stringify(investigation['timeline'])).toContain('lease expired during attempt 1');
  });

  it('missing events: a terminal task that lost its event gets one from the reconciler and it is delivered', async () => {
    const { customerId, path } = await configureCustomer('backfill');
    await database.tasks.create(
      buildTaskDocument({
        _id: 'tsk_backfill_1',
        customerId,
        idempotencyKey: 'backfill-1',
        status: 'Completed',
        attempts: 1,
        result: { ok: true },
        firstStartedAt: new Date(Date.now() - 2_000),
        finishedAt: new Date(Date.now() - 1_000),
        createdAt: new Date(Date.now() - 3_000),
        eventPending: true,
      }),
    );

    const event = await deliveryEnded('tsk_backfill_1');

    expect(event).toMatchObject({ eventType: 'task.completed', delivery: { status: 'Delivered' } });
    expect(receiver.received(path)).toHaveLength(1);
    expect((await database.tasks.findById('tsk_backfill_1').lean())?.eventPending).toBe(false);
  });

  it('metrics and investigation explain what happened', async () => {
    const { customerId } = await configureCustomer('metrics');
    receiver.behave('/hook/metrics', { failFirst: 1, status: 500 });
    const okId = await submit(customerId);
    const failedId = await submit(customerId, { failure: 'fatal' });
    await Promise.all([okId, failedId].map(async (id) => (await taskEnded(id), deliveryEnded(id))));

    const summary = (await request(app).get('/v1/ops/metrics/summary?window=5m')).body as {
      technical: Record<string, Json & { value?: number | null; p50?: number | null; count?: number }>;
      business: Record<string, Json & { value?: unknown; p96?: number | null; count?: number }>;
    };
    const prom = await request(app).get('/metrics');
    const investigation = (await request(app).get(`/v1/ops/tasks/${failedId}/investigation`)).body as Json;

    expect(summary.business['taskCompletionRate']?.value).toBe(50);
    expect(summary.business['taskTerminalFailureRate']?.value).toBe(50);
    expect(summary.business['taskTurnaround']?.count).toBe(2);
    expect(summary.business['webhookDeliverySuccessRate']?.value).toBe(100);
    expect(summary.business['notificationLatency']?.count).toBe(2);
    expect(summary.business['tasksPerCustomer']?.value).toEqual([{ customerId, total: 2, byStatus: { Completed: 1, Failed: 1 } }]);
    expect(summary.technical['queueWait']?.count).toBe(2);
    expect(summary.technical['executionDuration']?.count).toBe(2);
    expect(summary.technical['webhookAttemptLatency']?.count).toBeGreaterThanOrEqual(3);
    expect(summary.technical['webhookFailureRate']?.value).toBeGreaterThan(0);
    expect(summary.technical['apiLatency']?.count).toBeGreaterThan(0);
    expect(prom.text).toContain('taskhub_http_requests_total');
    expect(prom.text).toContain('taskhub_tasks_terminal_total{task_type="document_processing",status="Failed"}');
    expect(prom.text).toContain('taskhub_tasks_in_state{status="Pending"}');
    expect(String((investigation['summary'] as string[])[0])).toContain('Task Failed after 1 attempt');
    expect(JSON.stringify(investigation['timeline'])).toContain('event task.failed created');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebhookClient, WebhookRequest, WebhookResponse } from '../../../../src/modules/delivery/delivery.client';
import { DeliveryService } from '../../../../src/modules/delivery/delivery.service';
import { verifySignature } from '../../../../src/modules/delivery/delivery.signing';
import { createLogger } from '../../../../src/observability/logger';
import { createMetrics } from '../../../../src/observability/metrics';
import { buildEventDocument } from '../../../mocks/events/eventFixtures';
import { InMemoryCustomerRepository } from '../../../mocks/customers/inMemoryCustomerRepository';
import { InMemoryEventRepository } from '../../../mocks/events/inMemoryEventRepository';
import { testConfig } from '../../../mocks/helpers';
import { createLogCapture } from '../../../mocks/logCapture';
import { FIXED_NOW } from '../../../mocks/tasks/taskFixtures';

const WORKER = 'dlv_test';
const SECRET = 'whsec_service_test_secret';

describe('DeliveryService', () => {
  let events: InMemoryEventRepository;
  let customers: InMemoryCustomerRepository;
  let metrics: ReturnType<typeof createMetrics>;
  let capture: ReturnType<typeof createLogCapture>;
  let client: ReturnType<typeof vi.fn<WebhookClient>>;

  const service = (): DeliveryService =>
    new DeliveryService({
      events,
      customers,
      client,
      config: testConfig({ DELIVERY_TIMEOUT_MS: '1234' }),
      logger: createLogger({ logLevel: 'info' }, {}, [capture.transport]),
      workerId: WORKER,
      metrics,
      now: () => FIXED_NOW,
      random: () => 0,
    });

  const leased = async (overrides: Parameters<typeof buildEventDocument>[0] = {}) => {
    events.add(buildEventDocument(overrides));
    const claimed = await events.claimNextDelivery({ workerId: WORKER, now: FIXED_NOW, leaseMs: 10_000 });
    if (claimed === null) throw new Error('expected a claimable event');
    return claimed;
  };

  const respond = (response: WebhookResponse): void => {
    client.mockResolvedValue(response);
  };

  beforeEach(async () => {
    events = new InMemoryEventRepository();
    customers = new InMemoryCustomerRepository();
    metrics = createMetrics();
    capture = createLogCapture();
    client = vi.fn<WebhookClient>();
    await customers.upsertWebhook('cust_acme', { url: 'https://hooks.example.com/tasks', secret: SECRET }, FIXED_NOW);
  });

  it('sends the stored body with identifying headers and a verifiable signature', async () => {
    respond({ statusCode: 200, durationMs: 12, responseSnippet: 'ok' });
    const event = await leased();

    await service().deliver(event);

    const request = client.mock.calls[0]?.[0] as WebhookRequest;
    expect(request.url).toBe('https://hooks.example.com/tasks');
    expect(request.timeoutMs).toBe(1234);
    expect(request.body).toBe(JSON.stringify(event.body));
    expect(request.headers).toMatchObject({
      'Content-Type': 'application/json',
      'X-TaskHub-Event-Id': event._id,
      'X-TaskHub-Event-Type': 'task.completed',
      'X-TaskHub-Correlation-Id': 'cor_1',
      'X-TaskHub-Delivery-Attempt': '1',
      'X-TaskHub-Timestamp': String(Math.floor(FIXED_NOW.getTime() / 1000)),
    });
    expect(
      verifySignature({
        secret: SECRET,
        header: request.headers['X-TaskHub-Signature'] ?? '',
        body: request.body,
        nowSeconds: Math.floor(FIXED_NOW.getTime() / 1000),
      }),
    ).toBe(true);
  });

  it('marks the event Delivered and records the attempt on a 2xx response', async () => {
    respond({ statusCode: 204, durationMs: 15 });
    const event = await leased();

    await service().deliver(event);

    expect(events.events.get(event._id)?.delivery).toMatchObject({
      status: 'Delivered',
      attemptCount: 1,
      deliveredAt: FIXED_NOW,
      lease: null,
      attempts: [{ n: 1, startedAt: FIXED_NOW, durationMs: 15, statusCode: 204 }],
    });
  });

  it('schedules a retry after a non-success response and records the failure details', async () => {
    respond({ statusCode: 503, durationMs: 9, responseSnippet: 'maintenance' });
    const event = await leased();

    await service().deliver(event);

    expect(events.events.get(event._id)?.delivery).toMatchObject({
      status: 'Pending',
      attemptCount: 1,
      nextAttemptAt: new Date(FIXED_NOW.getTime() + 1_000),
      lastError: 'HTTP 503',
      attempts: [{ n: 1, statusCode: 503, responseSnippet: 'maintenance' }],
    });
  });

  it('records network errors without a status code', async () => {
    respond({ error: 'ECONNREFUSED: connect failed', durationMs: 3 });
    const event = await leased();

    await service().deliver(event);

    const attempt = events.events.get(event._id)?.delivery.attempts[0];
    expect(attempt).toMatchObject({ n: 1, error: 'ECONNREFUSED: connect failed' });
    expect(attempt).not.toHaveProperty('statusCode');
  });

  it('fails the event when attempts are exhausted and counts attempts across calls', async () => {
    respond({ statusCode: 500, durationMs: 1 });
    const base = buildEventDocument();
    const event = await leased({ delivery: { ...base.delivery, attemptCount: 5, maxAttempts: 6 } });

    await service().deliver(event);

    expect(events.events.get(event._id)?.delivery).toMatchObject({
      status: 'Failed',
      attemptCount: 6,
      lastError: 'HTTP 500 (attempts exhausted)',
    });
    expect(client.mock.calls[0]?.[0].headers['X-TaskHub-Delivery-Attempt']).toBe('6');
  });

  it('sends unsigned when the customer has no secret (task-level URL override)', async () => {
    respond({ statusCode: 200, durationMs: 1 });
    const event = await leased({ customerId: 'cust_other', url: 'https://override.example.com/' });

    await service().deliver(event);

    expect(client.mock.calls[0]?.[0].headers).not.toHaveProperty('X-TaskHub-Signature');
    expect(client.mock.calls[0]?.[0].url).toBe('https://override.example.com/');
  });

  it('fails permanently without calling the client when the event has no URL', async () => {
    const event = await leased({ url: null });

    await service().deliver(event);

    expect(client).not.toHaveBeenCalled();
    expect(events.events.get(event._id)?.delivery).toMatchObject({ status: 'Pending', lastError: 'no webhook URL is configured for this event' });
  });

  it('records webhook metrics for successes and failures', async () => {
    const delivered = await leased({ _id: 'evt_ok', taskId: 'tsk_ok' });
    respond({ statusCode: 200, durationMs: 20 });
    await service().deliver(delivered);

    const failing = await leased({ _id: 'evt_bad', taskId: 'tsk_bad' });
    respond({ statusCode: 500, durationMs: 30 });
    await service().deliver(failing);

    const text = await metrics.render();
    expect(text).toContain('taskhub_webhook_attempts_total{outcome="success"} 1');
    expect(text).toContain('taskhub_webhook_attempts_total{outcome="failure"} 1');
  });

  it('discards the result and warns when the lease was lost', async () => {
    respond({ statusCode: 200, durationMs: 5 });
    const event = await leased();
    events.add({ ...event, delivery: { ...event.delivery, lease: { workerId: 'dlv_other', expiresAt: FIXED_NOW } } });

    await service().deliver(event);

    expect(events.events.get(event._id)?.delivery.status).toBe('Pending');
    expect(capture.lines().some((line) => String(line['message']).includes('lease is no longer held'))).toBe(true);
  });

  it('logs each attempt with the correlation identifiers', async () => {
    respond({ statusCode: 200, durationMs: 7 });
    const event = await leased();

    await service().deliver(event);

    expect(capture.lines().find((line) => line['message'] === 'delivery attempt finished')).toMatchObject({
      eventId: event._id,
      taskId: event.taskId,
      customerId: 'cust_acme',
      correlationId: 'cor_1',
      attempt: 1,
      statusCode: 200,
      result: 'delivered',
      deliveryStatus: 'Delivered',
    });
  });

  it('works with the real clock and without metrics', async () => {
    respond({ statusCode: 200, durationMs: 1 });
    const event = await leased();
    const plain = new DeliveryService({
      events,
      customers,
      client,
      config: testConfig(),
      logger: createLogger({ logLevel: 'silent' }),
      workerId: WORKER,
    });

    await plain.deliver(event);

    expect(events.events.get(event._id)?.delivery.status).toBe('Delivered');
  });
});

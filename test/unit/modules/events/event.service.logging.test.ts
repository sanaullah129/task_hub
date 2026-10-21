import { describe, expect, it } from 'vitest';
import { EventService } from '../../../../src/modules/events/event.service';
import { createLogger } from '../../../../src/observability/logger';
import { noopMetrics } from '../../../../src/observability/metrics';
import { InMemoryCustomerRepository } from '../../../mocks/customers/inMemoryCustomerRepository';
import { InMemoryEventRepository } from '../../../mocks/events/inMemoryEventRepository';
import { buildEventDocument } from '../../../mocks/events/eventFixtures';
import { testConfig } from '../../../mocks/helpers';
import { createLogCapture } from '../../../mocks/logCapture';
import { FIXED_NOW, buildTaskDocument } from '../../../mocks/tasks/taskFixtures';

const FINISHED = new Date(FIXED_NOW.getTime() + 1_000);
const task = buildTaskDocument({ status: 'Completed', finishedAt: FINISHED, result: {}, correlationId: 'cor_log' });

function setup() {
  const capture = createLogCapture();
  const events = new InMemoryEventRepository();
  const customers = new InMemoryCustomerRepository();
  const service = new EventService({
    events,
    customers,
    taskMarker: { markEventEmitted: () => Promise.resolve() },
    config: testConfig(),
    logger: createLogger({ logLevel: 'info' }, {}, [capture.transport]),
    metrics: noopMetrics,
    now: () => FINISHED,
  });
  return { capture, events, customers, service };
}

describe('EventService logging', () => {
  it('logs that a webhook was queued with the destination type and host only', async () => {
    const { capture, customers, service } = setup();
    await customers.upsertWebhook('cust_acme', { url: 'https://hooks.example.com/secret-path?token=abc', secret: 's'.repeat(20) }, FIXED_NOW);

    const event = await service.emitForTask(task);

    const line = capture.lines().find((entry) => entry['message'] === 'webhook event created, delivery queued');
    expect(line).toMatchObject({
      eventId: event._id,
      taskId: task._id,
      customerId: 'cust_acme',
      correlationId: 'cor_log',
      eventType: 'task.completed',
      deliveryStatus: 'Pending',
      destination: 'customer default',
      host: 'hooks.example.com',
    });
    expect(JSON.stringify(capture.lines())).not.toContain('secret-path');
  });

  it('reports a task-level override as the destination', async () => {
    const { capture, service } = setup();

    await service.emitForTask({ ...task, webhookUrl: 'https://override.example.com/x' });

    expect(capture.lines().find((entry) => entry['message'] === 'webhook event created, delivery queued')).toMatchObject({
      destination: 'task override',
      host: 'override.example.com',
    });
  });

  it('logs that delivery is skipped when no URL is configured', async () => {
    const { capture, service } = setup();

    await service.emitForTask(task);

    expect(capture.lines().find((entry) => entry['message'] === 'webhook event created, no URL configured so delivery is skipped')).toMatchObject({
      destination: 'none',
      deliveryStatus: 'Skipped',
      host: null,
    });
  });

  it('does not log again when the event already exists', async () => {
    const { capture, service } = setup();

    await service.emitForTask(task);
    await service.emitForTask(task);

    expect(capture.lines().filter((entry) => String(entry['message']).startsWith('webhook event created'))).toHaveLength(1);
  });

  it('logs an operator replay with the previous attempt count', async () => {
    const { capture, events, service } = setup();
    const base = buildEventDocument({ _id: 'evt_f' });
    events.add(buildEventDocument({ _id: 'evt_f', delivery: { ...base.delivery, status: 'Failed', attemptCount: 6, nextAttemptAt: null } }));

    await service.retryDelivery('evt_f');

    expect(capture.lines().find((entry) => entry['message'] === 'webhook delivery requeued by operator')).toMatchObject({
      eventId: 'evt_f',
      taskId: base.taskId,
      customerId: 'cust_acme',
      previousAttempts: 6,
      maxAttempts: 12,
      host: 'hooks.example.com',
    });
  });
});

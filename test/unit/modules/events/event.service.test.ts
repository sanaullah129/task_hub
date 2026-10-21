import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError, NotFoundError } from '../../../../src/shared/errors/appErrors';
import { EventService } from '../../../../src/modules/events/event.service';
import { createMetrics } from '../../../../src/observability/metrics';
import { buildEventDocument } from '../../../mocks/events/eventFixtures';
import { InMemoryCustomerRepository } from '../../../mocks/customers/inMemoryCustomerRepository';
import { InMemoryEventRepository } from '../../../mocks/events/inMemoryEventRepository';
import { silentLogger, testConfig } from '../../../mocks/helpers';
import { FIXED_NOW, buildTaskDocument } from '../../../mocks/tasks/taskFixtures';
import type { TaskDocument } from '../../../../src/modules/tasks/task.types';

const FINISHED = new Date(FIXED_NOW.getTime() + 2_500);
const terminal = (overrides: Partial<TaskDocument> = {}): TaskDocument =>
  buildTaskDocument({
    status: 'Completed',
    attempts: 2,
    firstStartedAt: new Date(FIXED_NOW.getTime() + 500),
    finishedAt: FINISHED,
    result: { pages: 3 },
    eventPending: true,
    ...overrides,
  });

describe('EventService', () => {
  let events: InMemoryEventRepository;
  let customers: InMemoryCustomerRepository;
  let markEventEmitted: ReturnType<typeof vi.fn<(taskId: string) => Promise<void>>>;
  let metrics: ReturnType<typeof createMetrics>;
  let service: EventService;

  beforeEach(() => {
    events = new InMemoryEventRepository();
    customers = new InMemoryCustomerRepository();
    markEventEmitted = vi.fn<(taskId: string) => Promise<void>>().mockResolvedValue(undefined);
    metrics = createMetrics();
    service = new EventService({
      events,
      customers,
      taskMarker: { markEventEmitted },
      config: testConfig(),
      logger: silentLogger(),
      metrics,
      now: () => FINISHED,
    });
  });

  describe('emitForTask', () => {
    it('creates a Pending event addressed to the customer default webhook', async () => {
      await customers.upsertWebhook('cust_acme', { url: 'https://hooks.example.com/in', secret: 's'.repeat(20) }, FIXED_NOW);
      const task = terminal();

      const event = await service.emitForTask(task);

      expect(event).toMatchObject({
        taskId: task._id,
        customerId: 'cust_acme',
        eventType: 'task.completed',
        correlationId: 'cor_1',
        url: 'https://hooks.example.com/in',
        taskFinishedAt: FINISHED,
        createdAt: FINISHED,
        delivery: { status: 'Pending', attemptCount: 0, maxAttempts: 6, nextAttemptAt: FINISHED, lease: null, attempts: [] },
      });
      expect(event._id).toMatch(/^evt_/);
      expect(event.body).toEqual({
        eventId: event._id,
        eventType: 'task.completed',
        taskId: task._id,
        customerId: 'cust_acme',
        timestamp: FINISHED.toISOString(),
        correlationId: 'cor_1',
        data: {
          taskType: 'document_processing',
          status: 'Completed',
          attempts: 2,
          createdAt: FIXED_NOW.toISOString(),
          startedAt: new Date(FIXED_NOW.getTime() + 500).toISOString(),
          finishedAt: FINISHED.toISOString(),
          turnaroundMs: 2_500,
          result: { pages: 3 },
          error: null,
        },
      });
      expect(markEventEmitted).toHaveBeenCalledWith(task._id);
    });

    it('prefers the per-task webhook override over the customer default', async () => {
      await customers.upsertWebhook('cust_acme', { url: 'https://default.example.com/', secret: 's'.repeat(20) }, FIXED_NOW);

      const event = await service.emitForTask(terminal({ webhookUrl: 'https://override.example.com/' }));

      expect(event.url).toBe('https://override.example.com/');
    });

    it('records a Skipped delivery when no webhook is configured', async () => {
      const event = await service.emitForTask(terminal());

      expect(event.url).toBeNull();
      expect(event.delivery).toMatchObject({ status: 'Skipped', nextAttemptAt: null });
    });

    it('maps Failed and TimedOut tasks to their event types and includes error details', async () => {
      const failed = await service.emitForTask(
        terminal({ _id: 'tsk_f', idempotencyKey: 'f', status: 'Failed', result: null, error: { code: 'simulated_fatal', message: 'nope', retryable: false } }),
      );
      const timedOut = await service.emitForTask(
        terminal({ _id: 'tsk_t', idempotencyKey: 't', status: 'TimedOut', result: null, error: { code: 'timeout', message: 'slow', retryable: true }, firstStartedAt: null }),
      );

      expect(failed.eventType).toBe('task.failed');
      expect(failed.body.data).toMatchObject({ status: 'Failed', result: null, error: { code: 'simulated_fatal', message: 'nope' } });
      expect(timedOut.eventType).toBe('task.timed_out');
      expect(timedOut.body.data).toMatchObject({ startedAt: null, error: { code: 'timeout' } });
    });

    it('is idempotent per task outcome and records terminal metrics only once', async () => {
      const task = terminal();

      const first = await service.emitForTask(task);
      const second = await service.emitForTask(task);

      expect(second._id).toBe(first._id);
      expect(events.events.size).toBe(1);
      expect(markEventEmitted).toHaveBeenCalledTimes(2);
      expect(await metrics.render()).toContain('taskhub_tasks_terminal_total{task_type="document_processing",status="Completed"} 1');
    });

    it.each([
      ['a non-terminal task', buildTaskDocument({ status: 'Running' })],
      ['a terminal task without a finish time', buildTaskDocument({ status: 'Completed', finishedAt: null })],
    ])('refuses %s', async (_label, task) => {
      await expect(service.emitForTask(task)).rejects.toThrow(/only terminal tasks emit events/);
      expect(markEventEmitted).not.toHaveBeenCalled();
    });

    it('uses the real clock when none is injected', async () => {
      const real = new EventService({
        events,
        customers,
        taskMarker: { markEventEmitted },
        config: testConfig(),
        logger: silentLogger(),
        metrics,
      });
      const before = Date.now();

      const event = await real.emitForTask(terminal());

      expect(event.createdAt.getTime()).toBeGreaterThanOrEqual(before);
    });
  });

  describe('queries', () => {
    it('lists the events of a task and paginates deliveries by status', async () => {
      events.add(buildEventDocument({ _id: 'evt_a', taskId: 'tsk_1' }));
      events.add(buildEventDocument({ _id: 'evt_b', taskId: 'tsk_2', createdAt: new Date(FIXED_NOW.getTime() + 1) }));

      expect((await service.listForTask('tsk_1')).map((event) => event._id)).toEqual(['evt_a']);
      const page = await service.listDeliveries({ status: 'Pending', limit: 1 });
      expect(page.items.map((event) => event._id)).toEqual(['evt_b']);
      expect(page.nextCursor).not.toBeNull();
    });
  });

  describe('retryDelivery', () => {
    const failedEvent = (): ReturnType<typeof buildEventDocument> => {
      const base = buildEventDocument({ _id: 'evt_f' });
      return buildEventDocument({
        _id: 'evt_f',
        delivery: { ...base.delivery, status: 'Failed', attemptCount: 6, nextAttemptAt: null, lastError: 'HTTP 500 (attempts exhausted)' },
      });
    };

    it('requeues a Failed delivery with a fresh attempt budget', async () => {
      events.add(failedEvent());

      const event = await service.retryDelivery('evt_f');

      expect(event.delivery).toMatchObject({ status: 'Pending', nextAttemptAt: FINISHED, maxAttempts: 12, attemptCount: 6 });
    });

    it('throws NotFoundError for an unknown event', async () => {
      await expect(service.retryDelivery('evt_missing')).rejects.toBeInstanceOf(NotFoundError);
    });

    it('throws a 409 when the delivery is not Failed', async () => {
      events.add(buildEventDocument({ _id: 'evt_p' }));

      const error = await service.retryDelivery('evt_p').catch((e: unknown) => e);

      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ status: 409, code: 'delivery_not_retryable' });
    });
  });
});

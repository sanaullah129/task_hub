import type { Config } from '../../config/config';
import type { Logger } from '../../observability/logger';
import { eventLog, hostOf } from '../../observability/logContext';
import type { Metrics } from '../../observability/metrics';
import { AppError, NotFoundError } from '../../shared/errors/appErrors';
import type { CustomerRepository } from '../customers/customer.repository';
import { isTerminalStatus } from '../tasks/task.stateMachine';
import type { TaskDocument } from '../tasks/task.types';
import type { EventRepository, EventListQuery, EventPage } from './event.repository';
import type { EventBody, EventDocument } from './event.types';
import { eventTypeForStatus, newEventId } from './event.utils';

/** Clears the task's eventPending flag once its event is stored. */
export interface TaskEventMarker {
  markEventEmitted(taskId: string): Promise<void>;
}

export interface EventServiceDeps {
  events: EventRepository;
  customers: Pick<CustomerRepository, 'findById'>;
  taskMarker: TaskEventMarker;
  config: Pick<Config, 'delivery'>;
  logger: Logger;
  metrics: Metrics;
  now?: () => Date;
}

const iso = (date: Date | null): string | null => (date === null ? null : date.toISOString());

export class EventService {
  private readonly now: () => Date;

  constructor(private readonly deps: EventServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /** Creates the event for a terminal task (idempotent per task outcome) and clears eventPending. */
  async emitForTask(task: TaskDocument): Promise<EventDocument> {
    const { events, customers, taskMarker, config, logger, metrics } = this.deps;
    if (!isTerminalStatus(task.status) || task.finishedAt === null) {
      throw new Error(`task ${task._id} is ${task.status}, only terminal tasks emit events`);
    }
    const eventType = eventTypeForStatus(task.status);
    const customer = await customers.findById(task.customerId);
    const url = task.webhookUrl ?? customer?.webhook?.url ?? null;
    const now = this.now();
    const eventId = newEventId();

    const body: EventBody = {
      eventId,
      eventType,
      taskId: task._id,
      customerId: task.customerId,
      timestamp: now.toISOString(),
      correlationId: task.correlationId,
      data: {
        taskType: task.taskType,
        status: task.status,
        attempts: task.attempts,
        createdAt: task.createdAt.toISOString(),
        startedAt: iso(task.firstStartedAt),
        finishedAt: task.finishedAt.toISOString(),
        turnaroundMs: task.finishedAt.getTime() - task.createdAt.getTime(),
        result: task.result,
        error: task.error === null ? null : { code: task.error.code, message: task.error.message },
      },
    };

    const candidate: EventDocument = {
      _id: eventId,
      taskId: task._id,
      customerId: task.customerId,
      eventType,
      correlationId: task.correlationId,
      body,
      url,
      taskFinishedAt: task.finishedAt,
      createdAt: now,
      delivery: {
        status: url === null ? 'Skipped' : 'Pending',
        attemptCount: 0,
        maxAttempts: config.delivery.maxAttempts,
        nextAttemptAt: url === null ? null : now,
        lease: null,
        attempts: [],
        deliveredAt: null,
        lastError: null,
      },
    };

    const { created, event } = await events.insertIdempotent(candidate);
    await taskMarker.markEventEmitted(task._id);

    if (created) {
      metrics.recordTaskTerminal({ taskType: task.taskType, status: task.status });
      const destination = task.webhookUrl !== null ? 'task override' : url !== null ? 'customer default' : 'none';
      eventLog(logger, event, task.correlationId).info(
        url === null ? 'webhook event created, no URL configured so delivery is skipped' : 'webhook event created, delivery queued',
        { eventType, taskStatus: task.status, deliveryStatus: event.delivery.status, destination, host: hostOf(url), maxAttempts: event.delivery.maxAttempts },
      );
    }
    return event;
  }

  async listForTask(taskId: string): Promise<EventDocument[]> {
    return this.deps.events.findByTaskId(taskId);
  }

  listDeliveries(query: EventListQuery): Promise<EventPage> {
    return this.deps.events.list(query);
  }

  /** Operator replay of a delivery that ended Failed. */
  async retryDelivery(eventId: string): Promise<EventDocument> {
    const { events, config, logger } = this.deps;
    const requeued = await events.requeueFailed(eventId, config.delivery.maxAttempts, this.now());
    if (requeued !== null) {
      eventLog(logger, requeued).info('webhook delivery requeued by operator', {
        eventType: requeued.eventType,
        previousAttempts: requeued.delivery.attemptCount,
        maxAttempts: requeued.delivery.maxAttempts,
        host: hostOf(requeued.url),
      });
      return requeued;
    }
    const existing = await events.findById(eventId);
    if (existing === null) throw new NotFoundError('event', eventId);
    throw new AppError(
      409,
      'delivery_not_retryable',
      `Delivery is ${existing.delivery.status}; only Failed deliveries can be retried`,
    );
  }
}

import type {
  DeliveryClaimOptions,
  DeliveryResult,
  EventListQuery,
  EventPage,
  EventRepository,
} from '../../../src/modules/events/event.repository';
import type { DeliveryAttempt, EventDocument } from '../../../src/modules/events/event.types';
import { decodeCursor, toPage } from '../../../src/shared/utils/pagination';

/** Mirrors the claim, compare-and-set and requeue semantics of the Mongoose repository. */
export class InMemoryEventRepository implements EventRepository {
  readonly events = new Map<string, EventDocument>();

  add(event: EventDocument): EventDocument {
    this.events.set(event._id, event);
    return event;
  }

  insertIdempotent(event: EventDocument): Promise<{ created: boolean; event: EventDocument }> {
    const existing = [...this.events.values()].find(
      (candidate) => candidate.taskId === event.taskId && candidate.eventType === event.eventType,
    );
    if (existing !== undefined) return Promise.resolve({ created: false, event: existing });
    this.events.set(event._id, event);
    return Promise.resolve({ created: true, event });
  }

  findById(eventId: string): Promise<EventDocument | null> {
    return Promise.resolve(this.events.get(eventId) ?? null);
  }

  findByTaskId(taskId: string): Promise<EventDocument[]> {
    return Promise.resolve([...this.events.values()].filter((event) => event.taskId === taskId));
  }

  list({ status, customerId, limit, cursor }: EventListQuery): Promise<EventPage> {
    const after = cursor === undefined ? undefined : decodeCursor(cursor);
    const rows = [...this.events.values()]
      .filter((event) => status === undefined || event.delivery.status === status)
      .filter((event) => customerId === undefined || event.customerId === customerId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a._id < b._id ? 1 : -1))
      .filter(
        (event) =>
          after === undefined ||
          event.createdAt < after.createdAt ||
          (event.createdAt.getTime() === after.createdAt.getTime() && event._id < after.id),
      )
      .slice(0, limit + 1);
    return Promise.resolve(toPage(rows, limit));
  }

  claimNextDelivery({ workerId, now, leaseMs }: DeliveryClaimOptions): Promise<EventDocument | null> {
    const due = [...this.events.values()]
      .filter(
        (event) =>
          event.delivery.status === 'Pending' &&
          event.delivery.nextAttemptAt !== null &&
          event.delivery.nextAttemptAt <= now &&
          (event.delivery.lease === null || event.delivery.lease.expiresAt <= now),
      )
      .sort((a, b) => (a.delivery.nextAttemptAt?.getTime() ?? 0) - (b.delivery.nextAttemptAt?.getTime() ?? 0))[0];
    if (due === undefined) return Promise.resolve(null);
    const claimed: EventDocument = {
      ...due,
      delivery: { ...due.delivery, lease: { workerId, expiresAt: new Date(now.getTime() + leaseMs) } },
    };
    this.events.set(claimed._id, claimed);
    return Promise.resolve(claimed);
  }

  recordAttempt(
    eventId: string,
    workerId: string,
    attempt: DeliveryAttempt,
    result: DeliveryResult,
  ): Promise<EventDocument | null> {
    const event = this.events.get(eventId);
    if (event === undefined || event.delivery.status !== 'Pending' || event.delivery.lease?.workerId !== workerId) {
      return Promise.resolve(null);
    }
    const delivery = {
      ...event.delivery,
      lease: null,
      attempts: [...event.delivery.attempts, attempt],
      attemptCount: event.delivery.attemptCount + 1,
      ...(result.kind === 'delivered'
        ? { status: 'Delivered' as const, deliveredAt: result.deliveredAt, nextAttemptAt: null, lastError: null }
        : result.kind === 'retry'
          ? { nextAttemptAt: result.nextAttemptAt, lastError: result.lastError }
          : { status: 'Failed' as const, nextAttemptAt: null, lastError: result.lastError }),
    };
    const updated = { ...event, delivery };
    this.events.set(eventId, updated);
    return Promise.resolve(updated);
  }

  requeueFailed(eventId: string, additionalAttempts: number, now: Date): Promise<EventDocument | null> {
    const event = this.events.get(eventId);
    if (event === undefined || event.delivery.status !== 'Failed') return Promise.resolve(null);
    const updated: EventDocument = {
      ...event,
      delivery: {
        ...event.delivery,
        status: 'Pending',
        nextAttemptAt: now,
        lease: null,
        maxAttempts: event.delivery.attemptCount + additionalAttempts,
      },
    };
    this.events.set(eventId, updated);
    return Promise.resolve(updated);
  }
}

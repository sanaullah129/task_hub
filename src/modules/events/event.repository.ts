import type { Model } from 'mongoose';
import { cursorFilter, decodeCursor, toPage } from '../../shared/utils/pagination';
import { isDuplicateKeyError } from '../../shared/utils/mongoErrors';
import type { DeliveryStatus } from './event.constants';
import type { DeliveryAttempt, EventDocument } from './event.types';

export interface DeliveryClaimOptions {
  workerId: string;
  now: Date;
  leaseMs: number;
}

export type DeliveryResult =
  | { kind: 'delivered'; deliveredAt: Date }
  | { kind: 'retry'; nextAttemptAt: Date; lastError: string }
  | { kind: 'failed'; lastError: string };

export interface EventListQuery {
  status?: DeliveryStatus;
  customerId?: string;
  limit: number;
  cursor?: string;
}

export interface EventPage {
  items: EventDocument[];
  nextCursor: string | null;
}

export interface EventRepository {
  /** Inserts the event, or returns the existing one for the same (taskId, eventType). */
  insertIdempotent(event: EventDocument): Promise<{ created: boolean; event: EventDocument }>;
  findById(eventId: string): Promise<EventDocument | null>;
  findByTaskId(taskId: string): Promise<EventDocument[]>;
  list(query: EventListQuery): Promise<EventPage>;
  /** Atomically leases the next Pending delivery that is due (expired leases count as free). */
  claimNextDelivery(options: DeliveryClaimOptions): Promise<EventDocument | null>;
  /** Compare-and-set on the leased delivery; null when the lease is no longer held. */
  recordAttempt(
    eventId: string,
    workerId: string,
    attempt: DeliveryAttempt,
    result: DeliveryResult,
  ): Promise<EventDocument | null>;
  /** Moves a Failed delivery back to Pending with `additionalAttempts` more tries. */
  requeueFailed(eventId: string, additionalAttempts: number, now: Date): Promise<EventDocument | null>;
}

export class MongooseEventRepository implements EventRepository {
  constructor(private readonly events: Model<EventDocument>) {}

  async insertIdempotent(event: EventDocument): Promise<{ created: boolean; event: EventDocument }> {
    try {
      await this.events.create(event);
      return { created: true, event };
    } catch (error) {
      if (!isDuplicateKeyError(error, 'eventType')) throw error;
      const existing = await this.events
        .findOne({ taskId: event.taskId, eventType: event.eventType })
        .lean<EventDocument>();
      if (existing === null) throw error;
      return { created: false, event: existing };
    }
  }

  findById(eventId: string): Promise<EventDocument | null> {
    return this.events.findById(eventId).lean<EventDocument>().exec();
  }

  findByTaskId(taskId: string): Promise<EventDocument[]> {
    return this.events.find({ taskId }).sort({ createdAt: 1 }).lean<EventDocument[]>().exec();
  }

  async list({ status, customerId, limit, cursor }: EventListQuery): Promise<EventPage> {
    const filter: Record<string, unknown> = {
      ...(status === undefined ? {} : { 'delivery.status': status }),
      ...(customerId === undefined ? {} : { customerId }),
      ...(cursor === undefined ? {} : cursorFilter(decodeCursor(cursor))),
    };
    const rows = await this.events
      .find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean<EventDocument[]>()
      .exec();
    return toPage(rows, limit);
  }

  claimNextDelivery({ workerId, now, leaseMs }: DeliveryClaimOptions): Promise<EventDocument | null> {
    return this.events
      .findOneAndUpdate(
        {
          'delivery.status': 'Pending',
          'delivery.nextAttemptAt': { $lte: now },
          $or: [{ 'delivery.lease': null }, { 'delivery.lease.expiresAt': { $lte: now } }],
        },
        { $set: { 'delivery.lease': { workerId, expiresAt: new Date(now.getTime() + leaseMs) } } },
        { sort: { 'delivery.nextAttemptAt': 1 }, returnDocument: 'after' },
      )
      .lean<EventDocument>()
      .exec();
  }

  recordAttempt(
    eventId: string,
    workerId: string,
    attempt: DeliveryAttempt,
    result: DeliveryResult,
  ): Promise<EventDocument | null> {
    const set: Record<string, unknown> = { 'delivery.lease': null };
    switch (result.kind) {
      case 'delivered':
        Object.assign(set, {
          'delivery.status': 'Delivered',
          'delivery.deliveredAt': result.deliveredAt,
          'delivery.nextAttemptAt': null,
          'delivery.lastError': null,
        });
        break;
      case 'retry':
        Object.assign(set, {
          'delivery.nextAttemptAt': result.nextAttemptAt,
          'delivery.lastError': result.lastError,
        });
        break;
      case 'failed':
        Object.assign(set, {
          'delivery.status': 'Failed',
          'delivery.nextAttemptAt': null,
          'delivery.lastError': result.lastError,
        });
        break;
    }

    return this.events
      .findOneAndUpdate(
        { _id: eventId, 'delivery.status': 'Pending', 'delivery.lease.workerId': workerId },
        { $set: set, $push: { 'delivery.attempts': attempt }, $inc: { 'delivery.attemptCount': 1 } },
        { returnDocument: 'after' },
      )
      .lean<EventDocument>()
      .exec();
  }

  requeueFailed(eventId: string, additionalAttempts: number, now: Date): Promise<EventDocument | null> {
    const pipeline = [
      {
        $set: {
          'delivery.status': 'Pending',
          'delivery.nextAttemptAt': now,
          'delivery.lease': null,
          'delivery.maxAttempts': { $add: ['$delivery.attemptCount', additionalAttempts] },
        },
      },
    ];
    return this.events
      .findOneAndUpdate({ _id: eventId, 'delivery.status': 'Failed' }, pipeline, {
        returnDocument: 'after',
        updatePipeline: true,
      })
      .lean<EventDocument>()
      .exec();
  }
}

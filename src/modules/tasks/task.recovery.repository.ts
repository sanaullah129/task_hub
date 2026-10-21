import type { Model } from 'mongoose';
import type { TaskDocument } from './task.types';

/** Read and flag operations used by the reconciler. */
export interface TaskRecoveryRepository {
  /** Running tasks whose lease expired at or before `now`, oldest lease first. */
  findLeaseExpired(now: Date, limit: number): Promise<TaskDocument[]>;
  /** Terminal tasks still waiting for their event to be created. */
  findEventPending(limit: number): Promise<TaskDocument[]>;
  markEventEmitted(taskId: string): Promise<void>;
}

export class MongooseTaskRecoveryRepository implements TaskRecoveryRepository {
  constructor(private readonly tasks: Model<TaskDocument>) {}

  findLeaseExpired(now: Date, limit: number): Promise<TaskDocument[]> {
    return this.tasks
      .find({ status: 'Running', 'lease.expiresAt': { $lte: now } })
      .sort({ 'lease.expiresAt': 1 })
      .limit(limit)
      .lean<TaskDocument[]>()
      .exec();
  }

  findEventPending(limit: number): Promise<TaskDocument[]> {
    return this.tasks.find({ eventPending: true }).sort({ finishedAt: 1 }).limit(limit).lean<TaskDocument[]>().exec();
  }

  async markEventEmitted(taskId: string): Promise<void> {
    await this.tasks.updateOne({ _id: taskId }, { $set: { eventPending: false } }).exec();
  }
}

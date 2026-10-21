import type { Model } from 'mongoose';
import { isDuplicateKeyError } from '../../shared/utils/mongoErrors';
import type { TaskDocument } from './task.types';

export type InsertResult = { created: boolean; task: TaskDocument };

export interface TaskRepository {
  /** Inserts the task, or returns the existing one for the same (customerId, idempotencyKey). */
  insertIdempotent(task: TaskDocument): Promise<InsertResult>;
  findById(taskId: string): Promise<TaskDocument | null>;
}

export const isIdempotencyViolation = (error: unknown): boolean => isDuplicateKeyError(error, 'idempotencyKey');

export class MongooseTaskRepository implements TaskRepository {
  constructor(private readonly tasks: Model<TaskDocument>) {}

  async insertIdempotent(task: TaskDocument): Promise<InsertResult> {
    try {
      await this.tasks.create(task);
      return { created: true, task };
    } catch (error) {
      if (!isIdempotencyViolation(error)) throw error;
      const existing = await this.tasks
        .findOne({ customerId: task.customerId, idempotencyKey: task.idempotencyKey })
        .lean<TaskDocument>();
      if (existing === null) throw error;
      return { created: false, task: existing };
    }
  }

  findById(taskId: string): Promise<TaskDocument | null> {
    return this.tasks.findById(taskId).lean<TaskDocument>().exec();
  }
}

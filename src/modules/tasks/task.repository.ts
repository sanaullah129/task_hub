import type { Model } from 'mongoose';
import { isDuplicateKeyError } from '../../shared/utils/mongoErrors';
import { cursorFilter, decodeCursor, toPage } from '../../shared/utils/pagination';
import type { TaskStatus } from './task.constants';
import type { TaskDocument } from './task.types';

export type InsertResult = { created: boolean; task: TaskDocument };

export interface TaskListQuery {
  customerId?: string;
  status?: TaskStatus;
  limit: number;
  cursor?: string;
}

export interface TaskPage {
  items: TaskDocument[];
  nextCursor: string | null;
}

export interface TaskRepository {
  /** Inserts the task, or returns the existing one for the same (customerId, idempotencyKey). */
  insertIdempotent(task: TaskDocument): Promise<InsertResult>;
  findById(taskId: string): Promise<TaskDocument | null>;
  /** Newest first, cursor paginated. */
  list(query: TaskListQuery): Promise<TaskPage>;
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

  async list({ customerId, status, limit, cursor }: TaskListQuery): Promise<TaskPage> {
    const filter: Record<string, unknown> = {
      ...(customerId === undefined ? {} : { customerId }),
      ...(status === undefined ? {} : { status }),
      ...(cursor === undefined ? {} : cursorFilter(decodeCursor(cursor))),
    };
    const rows = await this.tasks
      .find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean<TaskDocument[]>()
      .exec();
    return toPage(rows, limit);
  }
}

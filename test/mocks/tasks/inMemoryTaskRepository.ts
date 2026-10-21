import type {
  InsertResult,
  TaskListQuery,
  TaskPage,
  TaskRepository,
} from '../../../src/modules/tasks/task.repository';
import type { TaskDocument } from '../../../src/modules/tasks/task.types';
import { decodeCursor, toPage } from '../../../src/shared/utils/pagination';

export class InMemoryTaskRepository implements TaskRepository {
  readonly tasks = new Map<string, TaskDocument>();

  insertIdempotent(task: TaskDocument): Promise<InsertResult> {
    const existing = [...this.tasks.values()].find(
      (candidate) =>
        candidate.customerId === task.customerId && candidate.idempotencyKey === task.idempotencyKey,
    );
    if (existing !== undefined) return Promise.resolve({ created: false, task: existing });
    this.tasks.set(task._id, task);
    return Promise.resolve({ created: true, task });
  }

  findById(taskId: string): Promise<TaskDocument | null> {
    return Promise.resolve(this.tasks.get(taskId) ?? null);
  }

  list({ customerId, status, limit, cursor }: TaskListQuery): Promise<TaskPage> {
    const after = cursor === undefined ? undefined : decodeCursor(cursor);
    const rows = [...this.tasks.values()]
      .filter((task) => customerId === undefined || task.customerId === customerId)
      .filter((task) => status === undefined || task.status === status)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a._id < b._id ? 1 : -1))
      .filter(
        (task) =>
          after === undefined ||
          task.createdAt < after.createdAt ||
          (task.createdAt.getTime() === after.createdAt.getTime() && task._id < after.id),
      )
      .slice(0, limit + 1);
    return Promise.resolve(toPage(rows, limit));
  }
}

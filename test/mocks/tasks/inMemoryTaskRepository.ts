import type { InsertResult, TaskRepository } from '../../../src/modules/tasks/task.repository';
import type { TaskDocument } from '../../../src/modules/tasks/task.types';

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
}

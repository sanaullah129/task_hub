import type { TaskDocument } from './task.types';

export function toTaskView(task: TaskDocument) {
  return {
    taskId: task._id,
    customerId: task.customerId,
    taskType: task.taskType,
    status: task.status,
    attempts: task.attempts,
    maxAttempts: task.maxAttempts,
    correlationId: task.correlationId,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    startedAt: task.firstStartedAt,
    finishedAt: task.finishedAt,
    result: task.result,
    error: task.error,
    attemptLog: task.attemptLog.map((attempt) => ({
      n: attempt.n,
      startedAt: attempt.startedAt,
      finishedAt: attempt.finishedAt,
      outcome: attempt.outcome,
      error: attempt.error ?? null,
    })),
  };
}

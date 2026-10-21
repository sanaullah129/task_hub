import type { Logger } from './logger';

/** Child logger carrying the identifiers every task-related line should have. `correlationId` overrides the task's own (e.g. for a repeat request). */
export const taskLog = (
  logger: Logger,
  task: { _id: string; customerId: string; correlationId: string },
  correlationId: string = task.correlationId,
): Logger => logger.child({ taskId: task._id, customerId: task.customerId, correlationId });

/** Child logger carrying the identifiers every webhook-event line should have. */
export const eventLog = (
  logger: Logger,
  event: { _id: string; taskId: string; customerId: string; correlationId: string },
  correlationId: string = event.correlationId,
): Logger => logger.child({ eventId: event._id, taskId: event.taskId, customerId: event.customerId, correlationId });

/** Host only: webhook URLs can carry tokens in the path or query, so they never go into logs in full. */
export function hostOf(url: string | null): string | null {
  if (url === null) return null;
  try {
    return new URL(url).host;
  } catch {
    return 'invalid-url';
  }
}

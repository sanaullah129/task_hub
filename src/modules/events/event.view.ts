import type { EventDocument } from './event.types';

export function toEventView(event: EventDocument) {
  const { delivery } = event;
  return {
    eventId: event._id,
    eventType: event.eventType,
    taskId: event.taskId,
    customerId: event.customerId,
    correlationId: event.correlationId,
    createdAt: event.createdAt,
    url: event.url,
    body: event.body,
    delivery: {
      status: delivery.status,
      attemptCount: delivery.attemptCount,
      maxAttempts: delivery.maxAttempts,
      nextAttemptAt: delivery.nextAttemptAt,
      deliveredAt: delivery.deliveredAt,
      lastError: delivery.lastError,
      attempts: delivery.attempts.map((attempt) => ({
        n: attempt.n,
        startedAt: attempt.startedAt,
        durationMs: attempt.durationMs,
        statusCode: attempt.statusCode ?? null,
        error: attempt.error ?? null,
        responseSnippet: attempt.responseSnippet ?? null,
      })),
    },
  };
}

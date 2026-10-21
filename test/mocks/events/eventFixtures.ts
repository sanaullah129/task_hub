import type { EventDocument } from '../../../src/modules/events/event.types';
import { FIXED_NOW } from '../tasks/taskFixtures';

export function buildEventDocument(overrides: Partial<EventDocument> = {}): EventDocument {
  const id = overrides._id ?? 'evt_00000000-0000-0000-0000-000000000001';
  const taskId = overrides.taskId ?? 'tsk_00000000-0000-0000-0000-000000000001';
  return {
    _id: id,
    taskId,
    customerId: 'cust_acme',
    eventType: 'task.completed',
    correlationId: 'cor_1',
    body: {
      eventId: id,
      eventType: 'task.completed',
      taskId,
      customerId: 'cust_acme',
      timestamp: FIXED_NOW.toISOString(),
      correlationId: 'cor_1',
      data: { status: 'Completed' },
    },
    url: 'https://hooks.example.com/tasks',
    taskFinishedAt: FIXED_NOW,
    createdAt: FIXED_NOW,
    delivery: {
      status: 'Pending',
      attemptCount: 0,
      maxAttempts: 6,
      nextAttemptAt: FIXED_NOW,
      lease: null,
      attempts: [],
      deliveredAt: null,
      lastError: null,
    },
    ...overrides,
  };
}

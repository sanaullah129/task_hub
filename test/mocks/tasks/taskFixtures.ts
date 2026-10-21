import type { TaskDocument } from '../../../src/modules/tasks/task.types';

export const FIXED_NOW = new Date('2026-10-21T10:00:00.000Z');

export function buildTaskDocument(overrides: Partial<TaskDocument> = {}): TaskDocument {
  return {
    _id: 'tsk_00000000-0000-0000-0000-000000000001',
    customerId: 'cust_acme',
    taskType: 'document_processing',
    payload: { documentId: 'doc_1' },
    payloadHash: 'hash_1',
    idempotencyKey: 'idem_1',
    status: 'Pending',
    attempts: 0,
    maxAttempts: 3,
    timeoutMs: 30_000,
    slaMs: 60_000,
    webhookUrl: null,
    correlationId: 'cor_1',
    nextRunAt: FIXED_NOW,
    lease: null,
    result: null,
    error: null,
    attemptLog: [],
    history: [{ from: null, to: 'Pending', at: FIXED_NOW, reason: 'submitted' }],
    eventEmitted: false,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    firstStartedAt: null,
    finishedAt: null,
    ...overrides,
  };
}

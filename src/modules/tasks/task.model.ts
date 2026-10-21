import { Schema } from 'mongoose';
import { baseSchemaOptions, leaseSchema } from '../../shared/database/schemaOptions';
import { ATTEMPT_OUTCOMES, TASK_STATUSES, TASK_TYPES } from './task.constants';
import type { TaskDocument } from './task.types';

const taskErrorSchema = new Schema(
  {
    code: { type: String, required: true },
    message: { type: String, required: true },
    retryable: { type: Boolean, required: true },
  },
  { _id: false },
);

const attemptLogSchema = new Schema(
  {
    n: { type: Number, required: true },
    workerId: { type: String, required: true },
    startedAt: { type: Date, required: true },
    finishedAt: { type: Date, default: null },
    outcome: { type: String, enum: ATTEMPT_OUTCOMES, default: null },
    error: { type: taskErrorSchema },
  },
  { _id: false },
);

const historySchema = new Schema(
  {
    from: { type: String, enum: [...TASK_STATUSES, null], default: null },
    to: { type: String, enum: TASK_STATUSES, required: true },
    at: { type: Date, required: true },
    reason: { type: String, required: true },
  },
  { _id: false },
);

export const taskSchema = new Schema<TaskDocument>(
  {
    _id: { type: String, required: true },
    customerId: { type: String, required: true },
    taskType: { type: String, enum: TASK_TYPES, required: true },
    payload: { type: Schema.Types.Mixed, required: true },
    payloadHash: { type: String, required: true },
    idempotencyKey: { type: String, required: true },
    status: { type: String, enum: TASK_STATUSES, required: true },
    attempts: { type: Number, required: true, default: 0 },
    maxAttempts: { type: Number, required: true },
    timeoutMs: { type: Number, required: true },
    slaMs: { type: Number, required: true },
    webhookUrl: { type: String, default: null },
    correlationId: { type: String, required: true },
    nextRunAt: { type: Date, required: true },
    lease: { type: leaseSchema, default: null },
    result: { type: Schema.Types.Mixed, default: null },
    error: { type: taskErrorSchema, default: null },
    attemptLog: { type: [attemptLogSchema], default: [] },
    history: { type: [historySchema], default: [] },
    eventPending: { type: Boolean, required: true, default: false },
    createdAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
    firstStartedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
  },
  { ...baseSchemaOptions, collection: 'tasks', autoIndex: false },
);

taskSchema.index({ customerId: 1, idempotencyKey: 1 }, { name: 'uniq_customer_idempotency', unique: true });
taskSchema.index({ status: 1, nextRunAt: 1 }, { name: 'claim_due' });
taskSchema.index({ status: 1, 'lease.expiresAt': 1 }, { name: 'lease_expiry' });
taskSchema.index(
  { eventPending: 1 },
  { name: 'event_pending', partialFilterExpression: { eventPending: true } },
);
taskSchema.index({ customerId: 1, createdAt: -1 }, { name: 'customer_created' });
taskSchema.index({ finishedAt: 1 }, { name: 'finished_at' });

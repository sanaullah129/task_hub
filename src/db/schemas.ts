import { Schema } from 'mongoose';
import {
  DELIVERY_STATUSES,
  EVENT_TYPES,
  TASK_STATUSES,
  TASK_TYPES,
  type CustomerDocument,
  type EventDocument,
  type TaskDocument,
} from '../domain/types.js';

const ATTEMPT_OUTCOMES = ['Completed', 'Failed', 'TimedOut', 'Abandoned'];

const leaseSchema = new Schema(
  { workerId: { type: String, required: true }, expiresAt: { type: Date, required: true } },
  { _id: false },
);

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

// Dates are set by the domain layer, versioning is off so array CAS updates are not affected by __v.
const baseOptions = { versionKey: false, timestamps: false, minimize: false } as const;

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
    eventEmitted: { type: Boolean, required: true, default: false },
    createdAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
    firstStartedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
  },
  { ...baseOptions, collection: 'tasks', autoIndex: false },
);

taskSchema.index({ customerId: 1, idempotencyKey: 1 }, { name: 'uniq_customer_idempotency', unique: true });
taskSchema.index({ status: 1, nextRunAt: 1 }, { name: 'claim_due' });
taskSchema.index({ status: 1, 'lease.expiresAt': 1 }, { name: 'lease_expiry' });
taskSchema.index(
  { eventEmitted: 1 },
  { name: 'event_pending', partialFilterExpression: { eventEmitted: false } },
);
taskSchema.index({ customerId: 1, createdAt: -1 }, { name: 'customer_created' });
taskSchema.index({ finishedAt: 1 }, { name: 'finished_at' });

const deliveryAttemptSchema = new Schema(
  {
    n: { type: Number, required: true },
    startedAt: { type: Date, required: true },
    durationMs: { type: Number, required: true },
    statusCode: { type: Number },
    error: { type: String },
    responseSnippet: { type: String },
  },
  { _id: false },
);

const deliverySchema = new Schema(
  {
    status: { type: String, enum: DELIVERY_STATUSES, required: true },
    attemptCount: { type: Number, required: true, default: 0 },
    maxAttempts: { type: Number, required: true },
    nextAttemptAt: { type: Date, default: null },
    lease: { type: leaseSchema, default: null },
    attempts: { type: [deliveryAttemptSchema], default: [] },
    deliveredAt: { type: Date, default: null },
    lastError: { type: String, default: null },
  },
  { _id: false },
);

export const eventSchema = new Schema<EventDocument>(
  {
    _id: { type: String, required: true },
    taskId: { type: String, required: true },
    customerId: { type: String, required: true },
    eventType: { type: String, enum: EVENT_TYPES, required: true },
    correlationId: { type: String, required: true },
    body: { type: Schema.Types.Mixed, required: true },
    url: { type: String, default: null },
    createdAt: { type: Date, required: true },
    delivery: { type: deliverySchema, required: true },
  },
  { ...baseOptions, collection: 'events', autoIndex: false },
);

eventSchema.index({ taskId: 1, eventType: 1 }, { name: 'uniq_task_event_type', unique: true });
eventSchema.index(
  { 'delivery.status': 1, 'delivery.nextAttemptAt': 1 },
  { name: 'delivery_due' },
);
eventSchema.index(
  { 'delivery.status': 1, 'delivery.lease.expiresAt': 1 },
  { name: 'delivery_lease_expiry' },
);
eventSchema.index({ customerId: 1, createdAt: -1 }, { name: 'customer_created' });

export const customerSchema = new Schema<CustomerDocument>(
  {
    _id: { type: String, required: true },
    webhook: {
      type: new Schema(
        { url: { type: String, required: true }, secret: { type: String, required: true } },
        { _id: false },
      ),
      default: null,
    },
    createdAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
  },
  { ...baseOptions, collection: 'customers', autoIndex: false },
);

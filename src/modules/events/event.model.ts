import { Schema } from 'mongoose';
import { baseSchemaOptions, leaseSchema } from '../../shared/database/schemaOptions';
import { DELIVERY_STATUSES, EVENT_TYPES } from './event.constants';
import type { EventDocument } from './event.types';

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
  { ...baseSchemaOptions, collection: 'events', autoIndex: false },
);

eventSchema.index({ taskId: 1, eventType: 1 }, { name: 'uniq_task_event_type', unique: true });
eventSchema.index({ 'delivery.status': 1, 'delivery.nextAttemptAt': 1 }, { name: 'delivery_due' });
eventSchema.index(
  { 'delivery.status': 1, 'delivery.lease.expiresAt': 1 },
  { name: 'delivery_lease_expiry' },
);
eventSchema.index({ customerId: 1, createdAt: -1 }, { name: 'customer_created' });

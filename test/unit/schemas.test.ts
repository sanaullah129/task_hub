import { describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { ensureIndexes, type IndexableModel } from '../../src/db/indexes.js';
import { customerSchema, eventSchema, taskSchema } from '../../src/db/schemas.js';
import { TASK_STATUSES, type TaskDocument } from '../../src/domain/types.js';
import { buildTaskDocument } from '../mocks/fixtures.js';

type IndexEntry = [Record<string, unknown>, Record<string, unknown>];

// An unconnected connection is enough to validate documents without a database.
const TaskModel = mongoose.createConnection().model<TaskDocument>('Task', taskSchema);

const indexByName = (schema: { indexes(): unknown[] }, name: string): IndexEntry | undefined =>
  (schema.indexes() as IndexEntry[]).find(([, options]) => options['name'] === name);

describe('task schema', () => {
  it('enforces idempotency per customer and key', () => {
    const [fields, options] = indexByName(taskSchema, 'uniq_customer_idempotency') ?? [];
    expect(fields).toEqual({ customerId: 1, idempotencyKey: 1 });
    expect(options).toMatchObject({ unique: true });
  });

  it('limits the reconciler index to tasks still missing an event', () => {
    const [, options] = indexByName(taskSchema, 'event_pending') ?? [];
    expect(options).toMatchObject({ partialFilterExpression: { eventEmitted: false } });
  });

  it('indexes claiming of due tasks and lease recovery', () => {
    expect(indexByName(taskSchema, 'claim_due')?.[0]).toEqual({ status: 1, nextRunAt: 1 });
    expect(indexByName(taskSchema, 'lease_expiry')?.[0]).toEqual({
      status: 1,
      'lease.expiresAt': 1,
    });
  });

  it('uses unique index names within the collection', () => {
    const names = (taskSchema.indexes() as IndexEntry[]).map(([, options]) => options['name']);
    expect(new Set(names).size).toBe(names.length);
  });

  it('disables automatic indexing, versioning and timestamps', () => {
    expect(taskSchema.get('autoIndex')).toBe(false);
    expect(taskSchema.get('versionKey')).toBe(false);
    expect(taskSchema.get('timestamps')).toBe(false);
    expect(taskSchema.get('collection')).toBe('tasks');
  });

  it('restricts status to the lifecycle states', () => {
    const statusPath = taskSchema.path('status') as unknown as { enumValues: string[] };
    expect(statusPath.enumValues).toEqual([...TASK_STATUSES]);
  });

  it('accepts a complete task document', async () => {
    await expect(new TaskModel(buildTaskDocument()).validate()).resolves.toBeUndefined();
  });

  it('rejects documents missing required fields', async () => {
    const error = await new TaskModel({ _id: 'tsk_1' }).validate().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(mongoose.Error.ValidationError);
    expect(Object.keys((error as mongoose.Error.ValidationError).errors)).toEqual(
      expect.arrayContaining(['customerId', 'taskType', 'idempotencyKey', 'status']),
    );
  });

  it('rejects an unknown status', async () => {
    const doc = new TaskModel(buildTaskDocument());
    doc.set('status', 'Retrying');

    await expect(doc.validate()).rejects.toThrow(/status/);
  });

  it('keeps an empty payload object instead of dropping it', () => {
    const doc = new TaskModel(buildTaskDocument({ payload: {} }));

    expect(doc.toObject().payload).toEqual({});
  });
});

describe('event schema', () => {
  it('enforces one event per task outcome', () => {
    const [fields, options] = indexByName(eventSchema, 'uniq_task_event_type') ?? [];
    expect(fields).toEqual({ taskId: 1, eventType: 1 });
    expect(options).toMatchObject({ unique: true });
  });

  it('indexes claiming of due deliveries', () => {
    expect(indexByName(eventSchema, 'delivery_due')?.[0]).toEqual({
      'delivery.status': 1,
      'delivery.nextAttemptAt': 1,
    });
  });

  it('uses the events collection', () => {
    expect(eventSchema.get('collection')).toBe('events');
  });
});

describe('customer schema', () => {
  it('uses the customers collection with a nullable webhook', () => {
    expect(customerSchema.get('collection')).toBe('customers');
    expect(customerSchema.path('webhook')).toBeDefined();
  });
});

describe('ensureIndexes', () => {
  it('creates indexes for tasks and events', async () => {
    const createTasks = vi.fn<IndexableModel['createIndexes']>().mockResolvedValue(undefined);
    const createEvents = vi.fn<IndexableModel['createIndexes']>().mockResolvedValue(undefined);

    await ensureIndexes({
      tasks: { createIndexes: createTasks },
      events: { createIndexes: createEvents },
    });

    expect(createTasks).toHaveBeenCalledOnce();
    expect(createEvents).toHaveBeenCalledOnce();
  });

  it('propagates index creation failures', async () => {
    const failing = vi
      .fn<IndexableModel['createIndexes']>()
      .mockRejectedValue(new Error('index build failed'));
    const ok = vi.fn<IndexableModel['createIndexes']>().mockResolvedValue(undefined);

    await expect(
      ensureIndexes({ tasks: { createIndexes: failing }, events: { createIndexes: ok } }),
    ).rejects.toThrow('index build failed');
  });
});

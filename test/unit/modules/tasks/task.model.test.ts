import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import { TASK_STATUSES } from '../../../../src/modules/tasks/task.constants';
import { taskSchema } from '../../../../src/modules/tasks/task.model';
import type { TaskDocument } from '../../../../src/modules/tasks/task.types';
import { buildTaskDocument } from '../../../mocks/tasks/taskFixtures';

type IndexEntry = [Record<string, unknown>, Record<string, unknown>];

const indexByName = (name: string): IndexEntry | undefined =>
  (taskSchema.indexes() as IndexEntry[]).find(([, options]) => options['name'] === name);

// An unconnected connection is enough to validate documents without a database.
const TaskModel = mongoose.createConnection().model<TaskDocument>('Task', taskSchema);

describe('task schema', () => {
  it('enforces idempotency per customer and key', () => {
    const [fields, options] = indexByName('uniq_customer_idempotency') ?? [];
    expect(fields).toEqual({ customerId: 1, idempotencyKey: 1 });
    expect(options).toMatchObject({ unique: true });
  });

  it('limits the reconciler index to tasks still missing an event', () => {
    const [, options] = indexByName('event_pending') ?? [];
    expect(options).toMatchObject({ partialFilterExpression: { eventEmitted: false } });
  });

  it('indexes claiming of due tasks and lease recovery', () => {
    expect(indexByName('claim_due')?.[0]).toEqual({ status: 1, nextRunAt: 1 });
    expect(indexByName('lease_expiry')?.[0]).toEqual({ status: 1, 'lease.expiresAt': 1 });
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

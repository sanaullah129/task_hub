import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../../../src/database/client';
import { MongooseTaskRepository } from '../../../../src/modules/tasks/task.repository';
import { IdempotencyConflictError } from '../../../../src/modules/tasks/task.errors';
import { TaskService, type SubmitTaskInput } from '../../../../src/modules/tasks/task.service';
import { buildTaskDocument } from '../../../mocks/tasks/taskFixtures';
import { silentLogger, testConfig } from '../../../mocks/helpers';
import { setupTestDatabase, teardownTestDatabase } from '../../../mocks/testDatabase';

describe('task submission against MongoDB', () => {
  let database: Database;
  let repository: MongooseTaskRepository;
  let service: TaskService;

  beforeAll(async () => {
    database = await setupTestDatabase();
    repository = new MongooseTaskRepository(database.tasks);
    service = new TaskService({ repository, config: testConfig(), logger: silentLogger() });
  });

  afterAll(() => teardownTestDatabase(database));

  beforeEach(async () => {
    await database.tasks.deleteMany({});
  });

  const submission = (overrides: Partial<SubmitTaskInput> = {}): SubmitTaskInput => ({
    customerId: 'cust_acme',
    taskType: 'document_processing',
    payload: { documentId: 'doc_1' },
    idempotencyKey: 'idem_1',
    webhookUrl: null,
    correlationId: 'cor_1',
    ...overrides,
  });

  describe('MongooseTaskRepository', () => {
    it('round-trips a task with dates, history and null fields intact', async () => {
      const task = buildTaskDocument({ payload: {} });

      await repository.insertIdempotent(task);
      const stored = await repository.findById(task._id);

      expect(stored).toMatchObject({
        _id: task._id,
        status: 'Pending',
        payload: {},
        lease: null,
        result: null,
        history: [{ from: null, to: 'Pending', reason: 'submitted' }],
      });
      expect(stored?.createdAt).toBeInstanceOf(Date);
      expect(stored).not.toHaveProperty('__v');
    });

    it('returns null for an unknown id', async () => {
      await expect(repository.findById('tsk_missing')).resolves.toBeNull();
    });

    it('returns the existing task for a duplicate (customerId, idempotencyKey)', async () => {
      const first = buildTaskDocument({ _id: 'tsk_a' });
      const second = buildTaskDocument({ _id: 'tsk_b' });

      const created = await repository.insertIdempotent(first);
      const duplicate = await repository.insertIdempotent(second);

      expect(created.created).toBe(true);
      expect(duplicate).toMatchObject({ created: false, task: { _id: 'tsk_a' } });
      expect(await database.tasks.countDocuments()).toBe(1);
    });

    it('allows the same key for different customers', async () => {
      await repository.insertIdempotent(buildTaskDocument({ _id: 'tsk_a', customerId: 'cust_a' }));
      const other = await repository.insertIdempotent(buildTaskDocument({ _id: 'tsk_b', customerId: 'cust_b' }));

      expect(other.created).toBe(true);
    });

    it('does not swallow duplicate-key errors from other indexes', async () => {
      await repository.insertIdempotent(buildTaskDocument({ _id: 'tsk_same', idempotencyKey: 'k1' }));

      await expect(
        repository.insertIdempotent(buildTaskDocument({ _id: 'tsk_same', idempotencyKey: 'k2' })),
      ).rejects.toMatchObject({ code: 11000 });
    });

    it('rejects documents that fail schema validation', async () => {
      await expect(
        repository.insertIdempotent(buildTaskDocument({ _id: 'tsk_bad', status: 'Retrying' as never })),
      ).rejects.toThrow(/status/);
    });
  });

  describe('concurrent submissions', () => {
    it('creates exactly one task when many identical requests race', async () => {
      const results = await Promise.all(Array.from({ length: 50 }, () => service.submit(submission())));

      expect(results.filter((result) => result.created)).toHaveLength(1);
      expect(new Set(results.map((result) => result.task._id)).size).toBe(1);
      expect(await database.tasks.countDocuments()).toBe(1);
    });

    it('accepts all distinct keys from one customer concurrently', async () => {
      const results = await Promise.all(
        Array.from({ length: 30 }, (_, i) => service.submit(submission({ idempotencyKey: `key_${i}` }))),
      );

      expect(results.every((result) => result.created)).toBe(true);
      expect(await database.tasks.countDocuments()).toBe(30);
    });

    it('lets one racing request win and rejects the conflicting ones', async () => {
      const outcomes = await Promise.allSettled(
        Array.from({ length: 20 }, (_, i) =>
          service.submit(submission({ payload: { documentId: `doc_${i % 2}` } })),
        ),
      );

      const fulfilled = outcomes.filter((outcome) => outcome.status === 'fulfilled');
      const rejected = outcomes.filter((outcome) => outcome.status === 'rejected');
      expect(await database.tasks.countDocuments()).toBe(1);
      expect(fulfilled.length + rejected.length).toBe(20);
      expect(rejected.length).toBeGreaterThan(0);
      for (const outcome of rejected) expect(outcome.reason).toBeInstanceOf(IdempotencyConflictError);
    });
  });
});

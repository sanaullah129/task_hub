import { beforeEach, describe, expect, it } from 'vitest';
import { IdempotencyConflictError } from '../../../../src/modules/tasks/task.errors';
import { NotFoundError } from '../../../../src/shared/errors/appErrors';
import { TaskService, type SubmitTaskInput } from '../../../../src/modules/tasks/task.service';
import { FIXED_NOW } from '../../../mocks/tasks/taskFixtures';
import { testConfig, silentLogger } from '../../../mocks/helpers';
import { InMemoryTaskRepository } from '../../../mocks/tasks/inMemoryTaskRepository';

const input = (overrides: Partial<SubmitTaskInput> = {}): SubmitTaskInput => ({
  customerId: 'cust_acme',
  taskType: 'report_generation',
  payload: { reportType: 'monthly' },
  idempotencyKey: 'idem_1',
  webhookUrl: null,
  correlationId: 'cor_1',
  ...overrides,
});

describe('TaskService', () => {
  let repository: InMemoryTaskRepository;
  let service: TaskService;

  beforeEach(() => {
    repository = new InMemoryTaskRepository();
    service = new TaskService({
      repository,
      config: testConfig(),
      logger: silentLogger(),
      now: () => FIXED_NOW,
    });
  });

  describe('submit', () => {
    it('persists a Pending task with configured defaults for its type', async () => {
      const { task, created } = await service.submit(input());

      expect(created).toBe(true);
      expect(task).toMatchObject({
        customerId: 'cust_acme',
        taskType: 'report_generation',
        status: 'Pending',
        attempts: 0,
        maxAttempts: 3,
        timeoutMs: 30_000,
        slaMs: 120_000,
        correlationId: 'cor_1',
        webhookUrl: null,
        eventEmitted: false,
        lease: null,
        result: null,
        error: null,
        nextRunAt: FIXED_NOW,
        createdAt: FIXED_NOW,
      });
      expect(task._id).toMatch(/^tsk_/);
      expect(task.history).toEqual([{ from: null, to: 'Pending', at: FIXED_NOW, reason: 'submitted' }]);
      expect(repository.tasks.get(task._id)).toBe(task);
    });

    it('stores the per-task webhook override', async () => {
      const { task } = await service.submit(input({ webhookUrl: 'https://hooks.example.com/' }));

      expect(task.webhookUrl).toBe('https://hooks.example.com/');
    });

    it('returns the original task for a repeated key and identical request', async () => {
      const first = await service.submit(input());
      const second = await service.submit(input({ correlationId: 'cor_other' }));

      expect(second.created).toBe(false);
      expect(second.task._id).toBe(first.task._id);
      expect(second.task.correlationId).toBe('cor_1');
      expect(repository.tasks.size).toBe(1);
    });

    it('treats reordered payload keys as the same request', async () => {
      const first = await service.submit(input({ taskType: 'data_sync', payload: { source: 'a', target: 'b' } }));
      const second = await service.submit(input({ taskType: 'data_sync', payload: { target: 'b', source: 'a' } }));

      expect(second).toMatchObject({ created: false, task: { _id: first.task._id } });
    });

    it('rejects a repeated key with a different payload', async () => {
      await service.submit(input());

      await expect(service.submit(input({ payload: { reportType: 'weekly' } }))).rejects.toBeInstanceOf(
        IdempotencyConflictError,
      );
      expect(repository.tasks.size).toBe(1);
    });

    it('rejects a repeated key with a different task type', async () => {
      await service.submit(input());

      await expect(
        service.submit(input({ taskType: 'document_processing', payload: { reportType: 'monthly' } })),
      ).rejects.toBeInstanceOf(IdempotencyConflictError);
    });

    it('scopes idempotency keys to the customer', async () => {
      const a = await service.submit(input({ customerId: 'cust_a' }));
      const b = await service.submit(input({ customerId: 'cust_b' }));

      expect(b.created).toBe(true);
      expect(b.task._id).not.toBe(a.task._id);
    });

    it('allows one customer to submit many tasks', async () => {
      for (const key of ['k1', 'k2', 'k3']) await service.submit(input({ idempotencyKey: key }));

      expect(repository.tasks.size).toBe(3);
    });

    it('uses the current time when no clock is injected', async () => {
      const real = new TaskService({ repository, config: testConfig(), logger: silentLogger() });
      const before = Date.now();

      const { task } = await real.submit(input({ idempotencyKey: 'real_clock' }));

      expect(task.createdAt.getTime()).toBeGreaterThanOrEqual(before);
    });
  });

  describe('get', () => {
    it('returns a stored task', async () => {
      const { task } = await service.submit(input());

      await expect(service.get(task._id)).resolves.toBe(task);
    });

    it('throws NotFoundError for an unknown id', async () => {
      await expect(service.get('tsk_missing')).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});

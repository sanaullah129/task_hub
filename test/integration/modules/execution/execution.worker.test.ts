import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '../../../../src/database/client';
import { createExecutionModule, type TaskWorker } from '../../../../src/modules/execution';
import { MongooseTaskExecutionRepository } from '../../../../src/modules/tasks/task.execution.repository';
import { MongooseTaskRepository } from '../../../../src/modules/tasks/task.repository';
import { TaskService, type SubmitTaskInput } from '../../../../src/modules/tasks/task.service';
import type { TaskDocument } from '../../../../src/modules/tasks/task.types';
import type { JsonObject } from '../../../../src/shared/types/json';
import { silentLogger, testConfig } from '../../../mocks/helpers';
import { setupTestDatabase, teardownTestDatabase } from '../../../mocks/testDatabase';

const config = testConfig({
  TASK_TIMEOUT_MS: '80',
  TASK_MAX_ATTEMPTS: '3',
  TASK_RETRY_BASE_MS: '10',
  TASK_RETRY_CAP_MS: '20',
  TASK_POLL_INTERVAL_MS: '10',
  TASK_CONCURRENCY: '4',
  TASK_SHUTDOWN_TIMEOUT_MS: '2000',
});

describe('task worker against MongoDB', () => {
  let database: Database;
  let service: TaskService;
  let tasks: MongooseTaskRepository;
  let workers: TaskWorker[];
  let counter = 0;

  beforeAll(async () => {
    database = await setupTestDatabase();
    tasks = new MongooseTaskRepository(database.tasks);
    service = new TaskService({ repository: tasks, config, logger: silentLogger() });
  });

  afterAll(() => teardownTestDatabase(database));

  beforeEach(async () => {
    await database.tasks.deleteMany({});
    workers = [];
  });

  afterEach(async () => {
    await Promise.all(workers.map((worker) => worker.stop()));
  });

  const startWorkers = (count = 1): void => {
    for (let i = 0; i < count; i++) {
      const { worker } = createExecutionModule({
        repository: new MongooseTaskExecutionRepository(database.tasks),
        config,
        logger: silentLogger(),
        workerId: `wrk_it_${i}`,
      });
      worker.start();
      workers.push(worker);
    }
  };

  const submit = async (simulate: JsonObject, overrides: Partial<SubmitTaskInput> = {}): Promise<string> => {
    counter += 1;
    const { task } = await service.submit({
      customerId: 'cust_it',
      taskType: 'document_processing',
      payload: { documentId: `doc_${counter}`, simulate: { durationMs: 5, ...simulate } },
      idempotencyKey: `idem_${counter}`,
      webhookUrl: null,
      correlationId: `cor_${counter}`,
      ...overrides,
    });
    return task._id;
  };

  const waitForTerminal = (taskId: string): Promise<TaskDocument> =>
    vi.waitFor(
      async () => {
        const task = await tasks.findById(taskId);
        if (task === null || !['Completed', 'Failed', 'TimedOut'].includes(task.status)) {
          throw new Error(`task ${taskId} is ${task?.status ?? 'missing'}`);
        }
        return task;
      },
      { timeout: 10_000, interval: 25 },
    );

  const transitions = (task: TaskDocument): string[] => task.history.map((entry) => `${entry.from ?? '-'}>${entry.to}`);

  it('executes a task to completion and records its result', async () => {
    startWorkers();
    const task = await waitForTerminal(await submit({}));

    expect(task).toMatchObject({ status: 'Completed', attempts: 1, lease: null, eventPending: true });
    expect(task.result).toMatchObject({ status: 'processed', attempt: 1 });
    expect(transitions(task)).toEqual(['->Pending', 'Pending>Running', 'Running>Completed']);
    expect(task.firstStartedAt).toBeInstanceOf(Date);
    expect(task.finishedAt).toBeInstanceOf(Date);
  });

  it('retries a flaky task with backoff and then completes it', async () => {
    startWorkers();
    const task = await waitForTerminal(await submit({ failure: 'retryable', failTimes: 1 }));

    expect(task).toMatchObject({ status: 'Completed', attempts: 2 });
    expect(task.attemptLog.map((entry) => entry.outcome)).toEqual(['Failed', 'Completed']);
    expect(transitions(task)).toEqual([
      '->Pending',
      'Pending>Running',
      'Running>Pending',
      'Pending>Running',
      'Running>Completed',
    ]);
  });

  it('fails a task immediately on a non-retryable error', async () => {
    startWorkers();
    const task = await waitForTerminal(await submit({ failure: 'fatal' }));

    expect(task).toMatchObject({
      status: 'Failed',
      attempts: 1,
      error: { code: 'simulated_fatal', retryable: false },
      eventPending: true,
    });
  });

  it('fails a task after exhausting its retries', async () => {
    startWorkers();
    const task = await waitForTerminal(await submit({ failure: 'retryable' }));

    expect(task).toMatchObject({ status: 'Failed', attempts: 3, error: { code: 'simulated_failure' } });
    expect(task.attemptLog.map((entry) => entry.outcome)).toEqual(['Failed', 'Failed', 'Failed']);
  });

  it('times out a hanging task on every attempt and ends in TimedOut', async () => {
    startWorkers();
    const task = await waitForTerminal(await submit({ failure: 'hang' }));

    expect(task).toMatchObject({ status: 'TimedOut', attempts: 3, error: { code: 'timeout' }, eventPending: true });
    expect(task.attemptLog.map((entry) => entry.outcome)).toEqual(['TimedOut', 'TimedOut', 'TimedOut']);
  });

  it('recovers when only the first attempt hangs', async () => {
    startWorkers();
    const task = await waitForTerminal(await submit({ failure: 'hang', failTimes: 1 }));

    expect(task).toMatchObject({ status: 'Completed', attempts: 2 });
    expect(task.attemptLog.map((entry) => entry.outcome)).toEqual(['TimedOut', 'Completed']);
  });

  it('runs each task once when several workers compete', async () => {
    startWorkers(3);
    const ids = await Promise.all(Array.from({ length: 24 }, () => submit({})));

    const finished = await Promise.all(ids.map(waitForTerminal));

    expect(finished.every((task) => task.status === 'Completed' && task.attempts === 1)).toBe(true);
    const claimers = new Set(finished.map((task) => task.attemptLog[0]?.workerId));
    expect(claimers.size).toBeGreaterThan(1);
  });

  it('leaves a running attempt to finish when the worker is stopped', async () => {
    startWorkers();
    const id = await submit({ durationMs: 60 });
    await vi.waitFor(async () => expect((await tasks.findById(id))?.status).toBe('Running'), { timeout: 5_000, interval: 5 });

    await Promise.all(workers.map((worker) => worker.stop()));

    expect((await tasks.findById(id))?.status).toBe('Completed');
  });
});

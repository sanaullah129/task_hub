import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HandlerError } from '../../../../src/modules/execution/execution.errors';
import { TaskExecutor } from '../../../../src/modules/execution/execution.executor';
import type { HandlerRegistry, TaskHandler } from '../../../../src/modules/execution/execution.types';
import type { TaskDocument } from '../../../../src/modules/tasks/task.types';
import { FIXED_NOW, buildTaskDocument } from '../../../mocks/tasks/taskFixtures';
import { InMemoryExecutionRepository } from '../../../mocks/tasks/inMemoryExecutionRepository';
import { silentLogger, testConfig } from '../../../mocks/helpers';
import { createLogCapture } from '../../../mocks/logCapture';
import { createLogger } from '../../../../src/observability/logger';

const WORKER = 'wrk_test';

function registry(handler: TaskHandler): HandlerRegistry {
  return { document_processing: handler, report_generation: handler, data_sync: handler };
}

describe('TaskExecutor', () => {
  let repository: InMemoryExecutionRepository;
  let claimed: TaskDocument;

  const executor = (handler: TaskHandler, logger = silentLogger()): TaskExecutor =>
    new TaskExecutor({
      repository,
      handlers: registry(handler),
      config: testConfig(),
      logger,
      workerId: WORKER,
      now: () => FIXED_NOW,
      random: () => 0,
    });

  const claim = async (overrides: Partial<TaskDocument> = {}): Promise<TaskDocument> => {
    repository.add(buildTaskDocument({ timeoutMs: 40, ...overrides }));
    const task = await repository.claimNext({ workerId: WORKER, now: FIXED_NOW, leaseGraceMs: 1_000 });
    if (task === null) throw new Error('expected a claimable task');
    return task;
  };

  const stored = (): TaskDocument => {
    const task = repository.tasks.get(claimed._id);
    if (task === undefined) throw new Error('task missing');
    return task;
  };

  beforeEach(async () => {
    repository = new InMemoryExecutionRepository();
    claimed = await claim();
  });

  it('completes the task with the handler result', async () => {
    await executor(() => Promise.resolve({ done: true })).execute(claimed);

    expect(stored()).toMatchObject({
      status: 'Completed',
      result: { done: true },
      eventPending: true,
      finishedAt: FIXED_NOW,
      lease: null,
    });
    expect(stored().attemptLog[0]).toMatchObject({ n: 1, outcome: 'Completed' });
  });

  it('passes the attempt context and an abort signal to the handler', async () => {
    const handler = vi.fn<TaskHandler>().mockResolvedValue({});

    await executor(handler).execute(claimed);

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: claimed._id,
        taskType: 'document_processing',
        payload: claimed.payload,
        attempt: 1,
        signal: expect.any(AbortSignal) as AbortSignal,
      }),
    );
  });

  it('schedules a retry when the handler fails with a retryable error', async () => {
    await executor(() => Promise.reject(new HandlerError('flaky', 'try again', true))).execute(claimed);

    expect(stored()).toMatchObject({ status: 'Pending', lease: null, nextRunAt: new Date(FIXED_NOW.getTime() + 1_000) });
    expect(stored().attemptLog[0]).toMatchObject({ outcome: 'Failed', error: { code: 'flaky' } });
    expect(stored().history.at(-1)).toMatchObject({ from: 'Running', to: 'Pending' });
  });

  it('fails the task permanently on a non-retryable error', async () => {
    await executor(() => Promise.reject(new HandlerError('bad', 'no', false))).execute(claimed);

    expect(stored()).toMatchObject({
      status: 'Failed',
      error: { code: 'bad', retryable: false },
      eventPending: true,
    });
  });

  it('records unexpected exceptions as retryable errors', async () => {
    await executor(() => Promise.reject(new Error('kaboom'))).execute(claimed);

    expect(stored()).toMatchObject({ status: 'Pending' });
    expect(stored().attemptLog[0]?.error).toMatchObject({ code: 'unexpected_error', message: 'kaboom' });
  });

  it('times out a handler that ignores the abort signal and aborts the signal', async () => {
    let seen: AbortSignal | undefined;
    const never: TaskHandler = ({ signal }) => {
      seen = signal;
      return new Promise<never>(() => undefined);
    };

    await executor(never).execute(claimed);

    expect(seen?.aborted).toBe(true);
    expect(stored()).toMatchObject({ status: 'Pending' });
    expect(stored().attemptLog[0]).toMatchObject({ outcome: 'TimedOut', error: { code: 'timeout' } });
  });

  it('ends in TimedOut when the last attempt times out', async () => {
    repository = new InMemoryExecutionRepository();
    claimed = await claim({ maxAttempts: 1 });

    await executor(() => new Promise<never>(() => undefined)).execute(claimed);

    expect(stored()).toMatchObject({ status: 'TimedOut', error: { code: 'timeout' }, eventPending: true });
  });

  it('ignores a late handler result after the timeout already decided the attempt', async () => {
    const late: TaskHandler = () => new Promise((resolve) => setTimeout(() => resolve({ late: true }), 120));

    await executor(late).execute(claimed);
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(repository.completions).toHaveLength(1);
    expect(stored().status).toBe('Pending');
  });

  it('discards the result when the attempt is no longer owned', async () => {
    const capture = createLogCapture();
    const logger = createLogger({ logLevel: 'info' }, {}, [capture.transport]);
    const handler: TaskHandler = () => {
      repository.tasks.set(claimed._id, { ...stored(), lease: { workerId: 'wrk_other', expiresAt: FIXED_NOW } });
      return Promise.resolve({});
    };

    await executor(handler, logger).execute(claimed);

    expect(stored().status).toBe('Running');
    expect(capture.lines().some((line) => String(line['message']).includes('no longer owned'))).toBe(true);
  });

  it('logs attempt start and finish with correlation fields', async () => {
    const capture = createLogCapture();
    const logger = createLogger({ logLevel: 'info' }, {}, [capture.transport]);

    await executor(() => Promise.resolve({}), logger).execute(claimed);

    const messages = capture.lines().map((line) => line['message']);
    expect(messages).toEqual(['task attempt started', 'task attempt finished', 'task finished, webhook event will be created']);
    expect(capture.lines()[1]).toMatchObject({
      taskId: claimed._id,
      customerId: claimed.customerId,
      correlationId: claimed.correlationId,
      attempt: 1,
      next: 'Completed',
    });
    expect(capture.lines()[2]).toMatchObject({ taskId: claimed._id, status: 'Completed', attempts: 1, correlationId: claimed.correlationId });
  });

  it('uses the real clock when none is injected', async () => {
    const before = Date.now();
    const real = new TaskExecutor({
      repository,
      handlers: registry(() => Promise.resolve({})),
      config: testConfig(),
      logger: silentLogger(),
      workerId: WORKER,
    });

    await real.execute(claimed);

    expect(stored().status).toBe('Completed');
    expect(stored().finishedAt?.getTime()).toBeGreaterThanOrEqual(before);
  });
});

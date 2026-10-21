import { describe, expect, it, vi } from 'vitest';
import { TaskWorker, newWorkerId } from '../../../../src/modules/execution/execution.worker';
import type { TaskExecutor } from '../../../../src/modules/execution/execution.executor';
import type { TaskExecutionRepository } from '../../../../src/modules/tasks/task.execution.repository';
import type { TaskDocument } from '../../../../src/modules/tasks/task.types';
import { createLogger } from '../../../../src/observability/logger';
import { buildTaskDocument } from '../../../mocks/tasks/taskFixtures';
import { silentLogger, testConfig } from '../../../mocks/helpers';
import { createLogCapture } from '../../../mocks/logCapture';

type Execute = TaskExecutor['execute'];

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function setup(options: {
  tasks?: TaskDocument[];
  env?: Record<string, string>;
  execute?: Execute;
  claimError?: Error;
}) {
  const queue = [...(options.tasks ?? [])];
  const claimNext = vi.fn<TaskExecutionRepository['claimNext']>(() => {
    if (options.claimError !== undefined && queue.length === 0) return Promise.reject(options.claimError);
    return Promise.resolve(queue.shift() ?? null);
  });
  const repository: TaskExecutionRepository = {
    claimNext,
    completeAttempt: vi.fn<TaskExecutionRepository['completeAttempt']>().mockResolvedValue(null),
  };
  const execute = vi.fn<Execute>(options.execute ?? (() => Promise.resolve()));
  const sleep = vi.fn<(ms: number, signal?: AbortSignal) => Promise<void>>(
    (_ms, signal) =>
      new Promise((resolve) => {
        if (signal?.aborted === true) resolve();
        else signal?.addEventListener('abort', () => resolve(), { once: true });
        setTimeout(resolve, 5);
      }),
  );
  const capture = createLogCapture();
  const worker = new TaskWorker({
    repository,
    executor: { execute },
    config: testConfig({ TASK_CONCURRENCY: '2', TASK_POLL_INTERVAL_MS: '100', TASK_SHUTDOWN_TIMEOUT_MS: '50', ...options.env }),
    logger: createLogger({ logLevel: 'info' }, {}, [capture.transport]),
    workerId: 'wrk_test',
    sleep,
    random: () => 0.5,
  });
  return { worker, claimNext, execute, sleep, capture };
}

const tasks = (count: number): TaskDocument[] =>
  Array.from({ length: count }, (_, i) => buildTaskDocument({ _id: `tsk_${i}`, idempotencyKey: `k${i}`, attempts: 1 }));

describe('TaskWorker', () => {
  it('claims and executes every available task, then idles', async () => {
    const { worker, execute, claimNext, sleep } = setup({ tasks: tasks(3) });

    worker.start();
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(3));
    await vi.waitFor(() => expect(sleep).toHaveBeenCalled());
    await worker.stop();

    expect(execute.mock.calls.map(([task]) => task._id)).toEqual(['tsk_0', 'tsk_1', 'tsk_2']);
    expect(claimNext).toHaveBeenCalledWith(expect.objectContaining({ workerId: 'wrk_test', leaseGraceMs: 10_000 }));
  });

  it('never runs more attempts than the configured concurrency', async () => {
    let running = 0;
    let peak = 0;
    const execute: Execute = async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 20));
      running -= 1;
    };
    const { worker, execute: spy } = setup({ tasks: tasks(6), execute });

    worker.start();
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(6));
    await worker.stop();

    expect(peak).toBe(2);
  });

  it('polls with a jittered delay around the configured interval when idle', async () => {
    const { worker, sleep } = setup({ tasks: [] });

    worker.start();
    await vi.waitFor(() => expect(sleep).toHaveBeenCalled());
    await worker.stop();

    expect(sleep.mock.calls[0]?.[0]).toBe(100);
  });

  it('keeps polling after a claim error and logs it', async () => {
    const { worker, claimNext, capture } = setup({ tasks: [], claimError: new Error('mongo down') });

    worker.start();
    await vi.waitFor(() => expect(claimNext.mock.calls.length).toBeGreaterThan(2));
    await worker.stop();

    expect(capture.lines().some((line) => line['message'] === 'failed to claim task')).toBe(true);
  });

  it('survives an attempt that could not be recorded', async () => {
    const execute: Execute = () => Promise.reject(new Error('db write failed'));
    const { worker, capture } = setup({ tasks: tasks(2), execute });

    worker.start();
    await vi.waitFor(() =>
      expect(capture.lines().filter((line) => line['message'] === 'attempt could not be recorded')).toHaveLength(2),
    );
    await worker.stop();
  });

  it('does not start twice', async () => {
    const { worker, capture } = setup({ tasks: [] });

    worker.start();
    worker.start();
    await worker.stop();

    expect(capture.lines().filter((line) => line['message'] === 'task worker started')).toHaveLength(1);
  });

  it('stops claiming new work once stopped and waits for running attempts', async () => {
    let release: () => void = () => undefined;
    const execute: Execute = () => new Promise<void>((resolve) => (release = resolve));
    const { worker, claimNext, capture } = setup({ tasks: tasks(1), execute, env: { TASK_SHUTDOWN_TIMEOUT_MS: '5000' } });

    worker.start();
    await vi.waitFor(() => expect(worker.activeCount).toBe(1));
    const stopping = worker.stop();
    await flush();
    const claimsAtStop = claimNext.mock.calls.length;
    release();
    await stopping;

    expect(claimNext.mock.calls.length).toBe(claimsAtStop);
    expect(worker.activeCount).toBe(0);
    expect(capture.lines().some((line) => line['message'] === 'task worker stopped')).toBe(true);
  });

  it('gives up waiting after the shutdown timeout and warns about running attempts', async () => {
    const execute: Execute = () => new Promise<void>(() => undefined);
    const { worker, capture } = setup({ tasks: tasks(1), execute, env: { TASK_SHUTDOWN_TIMEOUT_MS: '20' } });

    worker.start();
    await vi.waitFor(() => expect(worker.activeCount).toBe(1));
    await worker.stop();

    expect(capture.lines().find((line) => line['message'] === 'task worker stopped with work still running')).toMatchObject({
      running: 1,
    });
  });

  it('uses real timers and the default clock when none are injected', async () => {
    const claimNext = vi.fn<TaskExecutionRepository['claimNext']>().mockResolvedValue(null);
    const repository: TaskExecutionRepository = {
      claimNext,
      completeAttempt: vi.fn<TaskExecutionRepository['completeAttempt']>(),
    };
    const worker = new TaskWorker({
      repository,
      executor: { execute: vi.fn<Execute>() },
      config: testConfig({ TASK_POLL_INTERVAL_MS: '10' }),
      logger: silentLogger(),
      workerId: 'wrk_real',
    });

    worker.start();
    await vi.waitFor(() => expect(claimNext).toHaveBeenCalled());
    await worker.stop();
  });
});

describe('newWorkerId', () => {
  it('is unique per call and carries the process id', () => {
    expect(newWorkerId()).toContain(String(process.pid));
    expect(newWorkerId()).not.toBe(newWorkerId());
  });
});

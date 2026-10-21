import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HandlerError } from '../../../../src/modules/execution/execution.errors';
import { TaskExecutor } from '../../../../src/modules/execution/execution.executor';
import type { HandlerRegistry, TaskHandler } from '../../../../src/modules/execution/execution.types';
import type { TaskDocument } from '../../../../src/modules/tasks/task.types';
import { createLogger } from '../../../../src/observability/logger';
import { createMetrics } from '../../../../src/observability/metrics';
import { InMemoryExecutionRepository } from '../../../mocks/tasks/inMemoryExecutionRepository';
import { FIXED_NOW, buildTaskDocument } from '../../../mocks/tasks/taskFixtures';
import { testConfig } from '../../../mocks/helpers';
import { createLogCapture } from '../../../mocks/logCapture';

const registry = (handler: TaskHandler): HandlerRegistry => ({
  document_processing: handler,
  report_generation: handler,
  data_sync: handler,
});

describe('TaskExecutor terminal hook and metrics', () => {
  let repository: InMemoryExecutionRepository;
  let claimed: TaskDocument;
  let onTerminal: ReturnType<typeof vi.fn<(task: TaskDocument) => Promise<unknown>>>;
  let metrics: ReturnType<typeof createMetrics>;
  let capture: ReturnType<typeof createLogCapture>;

  const executor = (handler: TaskHandler): TaskExecutor =>
    new TaskExecutor({
      repository,
      handlers: registry(handler),
      config: testConfig(),
      logger: createLogger({ logLevel: 'info' }, {}, [capture.transport]),
      workerId: 'wrk_test',
      onTerminal,
      metrics,
      now: () => FIXED_NOW,
      random: () => 0,
    });

  beforeEach(async () => {
    repository = new InMemoryExecutionRepository();
    onTerminal = vi.fn<(task: TaskDocument) => Promise<unknown>>().mockResolvedValue(undefined);
    metrics = createMetrics();
    capture = createLogCapture();
    repository.add(buildTaskDocument({ timeoutMs: 1_000 }));
    const task = await repository.claimNext({ workerId: 'wrk_test', now: FIXED_NOW, leaseGraceMs: 1_000 });
    if (task === null) throw new Error('expected a claim');
    claimed = task;
  });

  it('hands the terminal task to the hook after a successful attempt', async () => {
    await executor(() => Promise.resolve({ ok: true })).execute(claimed);

    expect(onTerminal).toHaveBeenCalledOnce();
    expect(onTerminal).toHaveBeenCalledWith(expect.objectContaining({ _id: claimed._id, status: 'Completed', eventPending: true }));
  });

  it('hands over tasks that fail permanently', async () => {
    await executor(() => Promise.reject(new HandlerError('bad', 'no', false))).execute(claimed);

    expect(onTerminal).toHaveBeenCalledWith(expect.objectContaining({ status: 'Failed' }));
  });

  it('does not call the hook when the task goes back for a retry', async () => {
    await executor(() => Promise.reject(new HandlerError('flaky', 'again', true))).execute(claimed);

    expect(onTerminal).not.toHaveBeenCalled();
  });

  it('does not call the hook when the attempt result was discarded', async () => {
    const handler: TaskHandler = () => {
      repository.tasks.set(claimed._id, { ...(repository.tasks.get(claimed._id) as TaskDocument), lease: { workerId: 'wrk_other', expiresAt: FIXED_NOW } });
      return Promise.resolve({});
    };

    await executor(handler).execute(claimed);

    expect(onTerminal).not.toHaveBeenCalled();
  });

  it('logs and swallows hook failures so the reconciler can finish the job', async () => {
    onTerminal.mockRejectedValue(new Error('events db down'));

    await expect(executor(() => Promise.resolve({})).execute(claimed)).resolves.toBeUndefined();

    expect(capture.lines().find((line) => line['message'] === 'event creation failed; the reconciler will retry')).toMatchObject({
      taskId: claimed._id,
      level: 'warn',
    });
    expect(repository.tasks.get(claimed._id)?.status).toBe('Completed');
  });

  it('records the attempt duration metric with its outcome', async () => {
    await executor(() => Promise.resolve({})).execute(claimed);

    expect(await metrics.render()).toContain('taskhub_task_attempt_duration_seconds_count{task_type="document_processing",outcome="success"} 1');
  });

  it('works without a hook or metrics', async () => {
    const plain = new TaskExecutor({
      repository,
      handlers: registry(() => Promise.resolve({})),
      config: testConfig(),
      logger: createLogger({ logLevel: 'silent' }),
      workerId: 'wrk_test',
    });

    await plain.execute(claimed);

    expect(repository.tasks.get(claimed._id)?.status).toBe('Completed');
  });
});

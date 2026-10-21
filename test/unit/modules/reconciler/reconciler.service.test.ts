import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReconcilerService } from '../../../../src/modules/reconciler/reconciler.service';
import type { TaskDocument } from '../../../../src/modules/tasks/task.types';
import { InMemoryExecutionRepository } from '../../../mocks/tasks/inMemoryExecutionRepository';
import { FIXED_NOW, buildTaskDocument } from '../../../mocks/tasks/taskFixtures';
import { silentLogger, testConfig } from '../../../mocks/helpers';

const NOW = new Date(FIXED_NOW.getTime() + 60_000);
const running = (id: string, overrides: Partial<TaskDocument> = {}): TaskDocument =>
  buildTaskDocument({
    _id: id,
    idempotencyKey: id,
    status: 'Running',
    attempts: 1,
    lease: { workerId: 'wrk_dead', expiresAt: new Date(NOW.getTime() - 1_000) },
    attemptLog: [{ n: 1, workerId: 'wrk_dead', startedAt: FIXED_NOW, finishedAt: null, outcome: null }],
    ...overrides,
  });

describe('ReconcilerService', () => {
  let repository: InMemoryExecutionRepository;
  let emitEvent: ReturnType<typeof vi.fn<(task: TaskDocument) => Promise<unknown>>>;

  const service = (overrides: { batchSize?: number } = {}): ReconcilerService =>
    new ReconcilerService({
      recovery: repository,
      execution: repository,
      emitEvent,
      config: testConfig(),
      logger: silentLogger(),
      now: () => NOW,
      random: () => 0,
      ...overrides,
    });

  beforeEach(() => {
    repository = new InMemoryExecutionRepository();
    emitEvent = vi
      .fn<(task: TaskDocument) => Promise<unknown>>()
      .mockImplementation((task) => repository.markEventEmitted(task._id));
  });

  it('returns an expired attempt to Pending with an Abandoned outcome and a backoff time', async () => {
    repository.add(running('tsk_a'));

    const summary = await service().runOnce();

    expect(summary).toEqual({ leasesRecovered: 1, leasesSkipped: 0, eventsEmitted: 0, eventFailures: 0 });
    const task = repository.tasks.get('tsk_a');
    expect(task).toMatchObject({ status: 'Pending', lease: null, nextRunAt: new Date(NOW.getTime() + 1_000) });
    expect(task?.attemptLog[0]).toMatchObject({ outcome: 'Abandoned', error: { code: 'lease_expired' } });
    expect(task?.history.at(-1)).toMatchObject({ from: 'Running', to: 'Pending' });
    expect(emitEvent).not.toHaveBeenCalled();
  });

  it('fails an exhausted task and creates its event right away', async () => {
    repository.add(running('tsk_a', { attempts: 3, attemptLog: [{ n: 3, workerId: 'wrk_dead', startedAt: FIXED_NOW, finishedAt: null, outcome: null }] }));

    const summary = await service().runOnce();

    expect(summary).toMatchObject({ leasesRecovered: 1, eventsEmitted: 1 });
    expect(repository.tasks.get('tsk_a')).toMatchObject({ status: 'Failed', error: { code: 'lease_expired', retryable: false }, eventPending: false });
    expect(emitEvent).toHaveBeenCalledWith(expect.objectContaining({ _id: 'tsk_a', status: 'Failed' }));
  });

  it('leaves attempts with a live lease alone', async () => {
    repository.add(running('tsk_live', { lease: { workerId: 'wrk_ok', expiresAt: new Date(NOW.getTime() + 5_000) } }));

    const summary = await service().runOnce();

    expect(summary.leasesRecovered).toBe(0);
    expect(repository.tasks.get('tsk_live')?.status).toBe('Running');
  });

  it('skips a lease that changed owner between the scan and the update', async () => {
    repository.add(running('tsk_a'));
    vi.spyOn(repository, 'completeAttempt').mockResolvedValue(null);

    const summary = await service().runOnce();

    expect(summary).toMatchObject({ leasesRecovered: 0, leasesSkipped: 1 });
  });

  it('creates events for terminal tasks that are still flagged pending', async () => {
    repository.add(buildTaskDocument({ _id: 'tsk_done', idempotencyKey: 'd', status: 'Completed', finishedAt: FIXED_NOW, eventPending: true }));
    repository.add(buildTaskDocument({ _id: 'tsk_ok', idempotencyKey: 'o', status: 'Completed', finishedAt: FIXED_NOW, eventPending: false }));

    const summary = await service().runOnce();

    expect(summary.eventsEmitted).toBe(1);
    expect(emitEvent).toHaveBeenCalledTimes(1);
    expect(emitEvent).toHaveBeenCalledWith(expect.objectContaining({ _id: 'tsk_done' }));
  });

  it('keeps going when creating an event fails and reports the failure', async () => {
    repository.add(buildTaskDocument({ _id: 'tsk_1', idempotencyKey: '1', status: 'Completed', finishedAt: FIXED_NOW, eventPending: true }));
    repository.add(buildTaskDocument({ _id: 'tsk_2', idempotencyKey: '2', status: 'Failed', finishedAt: FIXED_NOW, eventPending: true }));
    emitEvent.mockRejectedValueOnce(new Error('mongo down')).mockResolvedValueOnce(undefined);

    const summary = await service().runOnce();

    expect(summary).toMatchObject({ eventsEmitted: 1, eventFailures: 1 });
    expect(emitEvent).toHaveBeenCalledTimes(2);
  });

  it('honours the batch size', async () => {
    for (const id of ['a', 'b', 'c']) repository.add(running(`tsk_${id}`));

    const summary = await service({ batchSize: 2 }).runOnce();

    expect(summary.leasesRecovered).toBe(2);
  });

  it('uses the real clock and default batch size when none are injected', async () => {
    repository.add(running('tsk_a', { lease: { workerId: 'wrk_dead', expiresAt: new Date(Date.now() - 1_000) } }));
    const real = new ReconcilerService({
      recovery: repository,
      execution: repository,
      emitEvent,
      config: testConfig(),
      logger: silentLogger(),
    });

    expect((await real.runOnce()).leasesRecovered).toBe(1);
  });
});

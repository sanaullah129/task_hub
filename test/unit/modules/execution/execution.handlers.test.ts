import { describe, expect, it } from 'vitest';
import { HandlerError } from '../../../../src/modules/execution/execution.errors';
import { createSimulatedHandlers } from '../../../../src/modules/execution/execution.handlers';
import type { HandlerContext } from '../../../../src/modules/execution/execution.types';
import type { JsonObject } from '../../../../src/shared/types/json';

const handlers = createSimulatedHandlers();

const context = (overrides: Partial<HandlerContext> = {}): HandlerContext => ({
  taskId: 'tsk_1',
  taskType: 'document_processing',
  payload: { documentId: 'doc_1', simulate: { durationMs: 1 } },
  attempt: 1,
  signal: new AbortController().signal,
  ...overrides,
});

const withSimulation = (simulate: JsonObject, extra: JsonObject = { documentId: 'doc_1' }): JsonObject => ({
  ...extra,
  simulate,
});

describe('simulated handlers', () => {
  it('returns a result per task type', async () => {
    await expect(handlers.document_processing(context())).resolves.toEqual({
      documentId: 'doc_1',
      status: 'processed',
      attempt: 1,
    });
    await expect(
      handlers.report_generation(
        context({ taskType: 'report_generation', payload: { reportType: 'monthly', simulate: { durationMs: 1 } } }),
      ),
    ).resolves.toEqual({ reportType: 'monthly', reportRef: 'reports/tsk_1', attempt: 1 });
    await expect(
      handlers.data_sync(
        context({ taskType: 'data_sync', payload: { source: 'a', target: 'b', simulate: { durationMs: 1 } } }),
      ),
    ).resolves.toEqual({ source: 'a', target: 'b', recordsSynced: 100, attempt: 1 });
  });

  it('uses the default duration when no simulation is given and tolerates a malformed one', async () => {
    const started = Date.now();
    await handlers.document_processing(context({ payload: { documentId: 'doc_1' } }));
    expect(Date.now() - started).toBeGreaterThanOrEqual(90);

    await expect(
      handlers.document_processing(context({ payload: { documentId: 7, simulate: { durationMs: 'slow' } } })),
    ).resolves.toMatchObject({ documentId: '' });
  });

  it('fails with a retryable error when simulating retryable failures', async () => {
    const payload = withSimulation({ durationMs: 1, failure: 'retryable' });

    await expect(handlers.document_processing(context({ payload }))).rejects.toMatchObject({
      code: 'simulated_failure',
      retryable: true,
    });
  });

  it('fails with a non-retryable error when simulating fatal failures', async () => {
    const payload = withSimulation({ durationMs: 1, failure: 'fatal' });

    const error = await handlers.document_processing(context({ payload })).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HandlerError);
    expect(error).toMatchObject({ code: 'simulated_fatal', retryable: false });
  });

  it('misbehaves only for the first failTimes attempts', async () => {
    const payload = withSimulation({ durationMs: 1, failure: 'retryable', failTimes: 2 });

    await expect(handlers.document_processing(context({ payload, attempt: 2 }))).rejects.toBeInstanceOf(HandlerError);
    await expect(handlers.document_processing(context({ payload, attempt: 3 }))).resolves.toMatchObject({
      attempt: 3,
    });
  });

  it('hangs until aborted, then reports an aborted error', async () => {
    const controller = new AbortController();
    const payload = withSimulation({ failure: 'hang' });
    const pending = handlers.document_processing(context({ payload, signal: controller.signal }));
    let settled = false;
    void pending.catch(() => (settled = true));

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);

    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'aborted', retryable: true });
  });

  it('stops early when aborted during the simulated work', async () => {
    const controller = new AbortController();
    const payload = withSimulation({ durationMs: 5_000 });
    const pending = handlers.document_processing(context({ payload, signal: controller.signal }));

    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: 'aborted' });
  });

  it('reports aborted immediately for a hang whose signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      handlers.document_processing(
        context({ payload: withSimulation({ failure: 'hang' }), signal: controller.signal }),
      ),
    ).rejects.toMatchObject({ code: 'aborted' });
  });
});

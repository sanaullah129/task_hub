import { describe, expect, it, vi } from 'vitest';
import { ReconcilerRunner } from '../../../../src/modules/reconciler/reconciler.runner';
import type { ReconcileSummary } from '../../../../src/modules/reconciler/reconciler.service';
import { createLogger } from '../../../../src/observability/logger';
import { createLogCapture } from '../../../mocks/logCapture';

const idle: ReconcileSummary = { leasesRecovered: 0, leasesSkipped: 0, eventsEmitted: 0, eventFailures: 0 };

function setup(runOnce: () => Promise<ReconcileSummary>) {
  const capture = createLogCapture();
  const service = { runOnce: vi.fn(runOnce) };
  const runner = new ReconcilerRunner({
    service,
    intervalMs: 50,
    logger: createLogger({ logLevel: 'info' }, {}, [capture.transport]),
    sleep: (_ms, signal) =>
      new Promise((resolve) => {
        if (signal?.aborted === true) resolve();
        signal?.addEventListener('abort', () => resolve(), { once: true });
        setTimeout(resolve, 2);
      }),
  });
  const messages = (): unknown[] => capture.lines().map((line) => line['message']);
  return { runner, service, messages, capture };
}

describe('ReconcilerRunner', () => {
  it('runs a pass immediately and keeps running until stopped', async () => {
    const { runner, service, messages } = setup(() => Promise.resolve(idle));

    runner.start();
    await vi.waitFor(() => expect(service.runOnce.mock.calls.length).toBeGreaterThan(2));
    await runner.stop();

    expect(messages()).toEqual(['reconciler started', 'reconciler stopped']);
  });

  it('logs a pass only when it did something', async () => {
    const { runner, service, capture } = setup(() => Promise.resolve({ ...idle, leasesRecovered: 2, eventsEmitted: 1 }));

    runner.start();
    await vi.waitFor(() => expect(service.runOnce).toHaveBeenCalled());
    await runner.stop();

    expect(capture.lines().find((line) => line['message'] === 'reconciler pass finished')).toMatchObject({
      leasesRecovered: 2,
      eventsEmitted: 1,
    });
  });

  it('logs a failed pass and carries on', async () => {
    let calls = 0;
    const { runner, service, capture } = setup(() => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error('db down')) : Promise.resolve(idle);
    });

    runner.start();
    await vi.waitFor(() => expect(service.runOnce.mock.calls.length).toBeGreaterThan(1));
    await runner.stop();

    expect(capture.lines().some((line) => line['message'] === 'reconciler pass failed')).toBe(true);
  });

  it('does not start twice and can use the default sleep', async () => {
    const service = { runOnce: vi.fn(() => Promise.resolve(idle)) };
    const runner = new ReconcilerRunner({ service, intervalMs: 5, logger: createLogger({ logLevel: 'silent' }) });

    runner.start();
    runner.start();
    await vi.waitFor(() => expect(service.runOnce.mock.calls.length).toBeGreaterThan(1));
    await runner.stop();
  });
});

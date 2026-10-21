import { describe, expect, it } from 'vitest';
import { sleep } from '../../../src/shared/utils/sleep';

describe('sleep', () => {
  it('resolves after the delay', async () => {
    const started = Date.now();

    await sleep(30);

    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
  });

  it('resolves early when the signal aborts', async () => {
    const controller = new AbortController();
    const started = Date.now();
    setTimeout(() => controller.abort(), 10);

    await sleep(5_000, controller.signal);

    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('resolves immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const started = Date.now();

    await sleep(5_000, controller.signal);

    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

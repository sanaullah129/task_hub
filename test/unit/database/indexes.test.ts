import { describe, expect, it, vi } from 'vitest';
import { ensureIndexes, type IndexableModel } from '../../../src/database/indexes';

type CreateIndexes = IndexableModel['createIndexes'];

describe('ensureIndexes', () => {
  it('creates indexes for tasks and events', async () => {
    const createTasks = vi.fn<CreateIndexes>().mockResolvedValue(undefined);
    const createEvents = vi.fn<CreateIndexes>().mockResolvedValue(undefined);

    await ensureIndexes({
      tasks: { createIndexes: createTasks },
      events: { createIndexes: createEvents },
    });

    expect(createTasks).toHaveBeenCalledOnce();
    expect(createEvents).toHaveBeenCalledOnce();
  });

  it('propagates index creation failures', async () => {
    const failing = vi.fn<CreateIndexes>().mockRejectedValue(new Error('index build failed'));
    const ok = vi.fn<CreateIndexes>().mockResolvedValue(undefined);

    await expect(
      ensureIndexes({ tasks: { createIndexes: failing }, events: { createIndexes: ok } }),
    ).rejects.toThrow('index build failed');
  });
});

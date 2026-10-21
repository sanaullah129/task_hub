import { describe, expect, it, vi } from 'vitest';
import { ensureIndexes, isIndexConflict, type IndexableModel } from '../../../src/database/indexes';

type CreateIndexes = IndexableModel['createIndexes'];
type SyncIndexes = IndexableModel['syncIndexes'];

const model = (create: CreateIndexes, sync: SyncIndexes = vi.fn<SyncIndexes>().mockResolvedValue([])): IndexableModel => ({
  createIndexes: create,
  syncIndexes: sync,
});

describe('ensureIndexes', () => {
  it('creates indexes for tasks and events without syncing', async () => {
    const createTasks = vi.fn<CreateIndexes>().mockResolvedValue(undefined);
    const createEvents = vi.fn<CreateIndexes>().mockResolvedValue(undefined);
    const syncTasks = vi.fn<SyncIndexes>().mockResolvedValue([]);

    await ensureIndexes({ tasks: model(createTasks, syncTasks), events: model(createEvents) });

    expect(createTasks).toHaveBeenCalledOnce();
    expect(createEvents).toHaveBeenCalledOnce();
    expect(syncTasks).not.toHaveBeenCalled();
  });

  it.each([85, 86])('syncs indexes when an existing index conflicts (code %i)', async (code) => {
    const sync = vi.fn<SyncIndexes>().mockResolvedValue(['event_pending']);
    const conflicting = vi.fn<CreateIndexes>().mockRejectedValue(Object.assign(new Error('IndexKeySpecsConflict'), { code }));
    const ok = vi.fn<CreateIndexes>().mockResolvedValue(undefined);

    await expect(ensureIndexes({ tasks: model(conflicting, sync), events: model(ok) })).resolves.toBeUndefined();

    expect(sync).toHaveBeenCalledOnce();
  });

  it('propagates other index creation failures without syncing', async () => {
    const sync = vi.fn<SyncIndexes>().mockResolvedValue([]);
    const failing = vi.fn<CreateIndexes>().mockRejectedValue(new Error('index build failed'));
    const ok = vi.fn<CreateIndexes>().mockResolvedValue(undefined);

    await expect(ensureIndexes({ tasks: model(failing, sync), events: model(ok) })).rejects.toThrow('index build failed');
    expect(sync).not.toHaveBeenCalled();
  });

  it('propagates a failure of the sync itself', async () => {
    const sync = vi.fn<SyncIndexes>().mockRejectedValue(new Error('sync failed'));
    const conflicting = vi.fn<CreateIndexes>().mockRejectedValue(Object.assign(new Error('conflict'), { code: 86 }));
    const ok = vi.fn<CreateIndexes>().mockResolvedValue(undefined);

    await expect(ensureIndexes({ tasks: model(conflicting, sync), events: model(ok) })).rejects.toThrow('sync failed');
  });
});

describe('isIndexConflict', () => {
  it('recognises only the two index conflict codes', () => {
    expect(isIndexConflict({ code: 85 })).toBe(true);
    expect(isIndexConflict({ code: 86 })).toBe(true);
    expect(isIndexConflict({ code: 11000 })).toBe(false);
    expect(isIndexConflict(new Error('x'))).toBe(false);
    expect(isIndexConflict(null)).toBe(false);
    expect(isIndexConflict('86')).toBe(false);
  });
});

export interface IndexableModel {
  createIndexes(): Promise<void>;
  /** Drops indexes that differ from the schema and creates the missing ones. */
  syncIndexes(): Promise<unknown>;
}

export interface IndexTargets {
  tasks: IndexableModel;
  events: IndexableModel;
}

const INDEX_OPTIONS_CONFLICT = 85;
const INDEX_KEY_SPECS_CONFLICT = 86;

export function isIndexConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code } = error as { code?: unknown };
  return code === INDEX_OPTIONS_CONFLICT || code === INDEX_KEY_SPECS_CONFLICT;
}

async function ensureModelIndexes(model: IndexableModel): Promise<void> {
  try {
    await model.createIndexes();
  } catch (error) {
    // A database created by an older version can hold an index with the same name but a different definition.
    if (!isIndexConflict(error)) throw error;
    await model.syncIndexes();
  }
}

// Schemas set autoIndex=false, so indexes are created explicitly at startup.
export async function ensureIndexes({ tasks, events }: IndexTargets): Promise<void> {
  await Promise.all([ensureModelIndexes(tasks), ensureModelIndexes(events)]);
}

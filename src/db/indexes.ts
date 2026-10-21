export interface IndexableModel {
  createIndexes(): Promise<void>;
}

export interface IndexTargets {
  tasks: IndexableModel;
  events: IndexableModel;
}

// Schemas set autoIndex=false, so indexes are created explicitly at startup.
export async function ensureIndexes({ tasks, events }: IndexTargets): Promise<void> {
  await Promise.all([tasks.createIndexes(), events.createIndexes()]);
}

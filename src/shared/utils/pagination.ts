import { ValidationError } from '../errors/appErrors';

export interface Cursor {
  createdAt: Date;
  id: string;
}

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export const encodeCursor = (cursor: Cursor): string =>
  Buffer.from(JSON.stringify({ t: cursor.createdAt.toISOString(), i: cursor.id })).toString('base64url');

export function decodeCursor(raw: string): Cursor {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as { t?: unknown; i?: unknown };
    const createdAt = typeof parsed.t === 'string' ? new Date(parsed.t) : undefined;
    if (createdAt === undefined || Number.isNaN(createdAt.getTime()) || typeof parsed.i !== 'string') {
      throw new Error('malformed cursor');
    }
    return { createdAt, id: parsed.i };
  } catch {
    throw new ValidationError(['cursor: is not a valid cursor']);
  }
}

/** Filter for "strictly after this cursor" when results are sorted by createdAt desc, _id desc. */
export const cursorFilter = ({ createdAt, id }: Cursor): Record<string, unknown> => ({
  $or: [{ createdAt: { $lt: createdAt } }, { createdAt, _id: { $lt: id } }],
});

/** Rows must be fetched with limit + 1 so a following page can be detected. */
export function toPage<T extends { _id: string; createdAt: Date }>(
  rows: T[],
  limit: number,
): { items: T[]; nextCursor: string | null } {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  const nextCursor = rows.length > limit && last !== undefined ? encodeCursor({ createdAt: last.createdAt, id: last._id }) : null;
  return { items, nextCursor };
}

export function parseLimit(raw: unknown): number {
  if (raw === undefined) return DEFAULT_PAGE_SIZE;
  const value = typeof raw === 'string' ? Number(raw) : Number.NaN;
  if (!Number.isInteger(value) || value < 1 || value > MAX_PAGE_SIZE) {
    throw new ValidationError([`limit: must be an integer between 1 and ${MAX_PAGE_SIZE}`]);
  }
  return value;
}

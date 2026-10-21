import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../src/shared/errors/appErrors';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  cursorFilter,
  decodeCursor,
  encodeCursor,
  parseLimit,
  toPage,
} from '../../../src/shared/utils/pagination';

const row = (id: string, minute: number): { _id: string; createdAt: Date } => ({
  _id: id,
  createdAt: new Date(Date.UTC(2026, 9, 21, 10, minute)),
});

describe('cursor encoding', () => {
  it('round-trips a cursor', () => {
    const cursor = { createdAt: new Date('2026-10-21T10:00:00.000Z'), id: 'tsk_1' };

    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it.each(['not-base64-json', Buffer.from('{"t":"nope","i":"x"}').toString('base64url'), Buffer.from('{"t":"2026-10-21T10:00:00Z"}').toString('base64url'), ''])(
    'rejects malformed cursor %#',
    (raw) => {
      expect(() => decodeCursor(raw)).toThrow(ValidationError);
    },
  );

  it('builds a filter for rows strictly after the cursor', () => {
    const createdAt = new Date('2026-10-21T10:00:00.000Z');

    expect(cursorFilter({ createdAt, id: 'tsk_5' })).toEqual({
      $or: [{ createdAt: { $lt: createdAt } }, { createdAt, _id: { $lt: 'tsk_5' } }],
    });
  });
});

describe('toPage', () => {
  it('returns every row and no cursor when there is no extra row', () => {
    const rows = [row('a', 3), row('b', 2)];

    expect(toPage(rows, 2)).toEqual({ items: rows, nextCursor: null });
  });

  it('trims the extra row and returns a cursor pointing at the last returned row', () => {
    const rows = [row('a', 3), row('b', 2), row('c', 1)];

    const page = toPage(rows, 2);

    expect(page.items.map((item) => item._id)).toEqual(['a', 'b']);
    expect(decodeCursor(page.nextCursor ?? '')).toEqual({ createdAt: rows[1]?.createdAt, id: 'b' });
  });

  it('handles an empty result', () => {
    expect(toPage([], 10)).toEqual({ items: [], nextCursor: null });
  });
});

describe('parseLimit', () => {
  it('defaults when missing and accepts valid integers', () => {
    expect(parseLimit(undefined)).toBe(DEFAULT_PAGE_SIZE);
    expect(parseLimit('25')).toBe(25);
    expect(parseLimit(String(MAX_PAGE_SIZE))).toBe(MAX_PAGE_SIZE);
  });

  it.each(['0', '-1', '1.5', 'abc', String(MAX_PAGE_SIZE + 1), '']) ('rejects %s', (raw) => {
    expect(() => parseLimit(raw)).toThrow(ValidationError);
  });

  it('rejects non-string values such as repeated query parameters', () => {
    expect(() => parseLimit(['1', '2'])).toThrow(ValidationError);
  });
});

import { describe, expect, it } from 'vitest';
import { isDuplicateKeyError } from '../../../src/shared/utils/mongoErrors';

describe('isDuplicateKeyError', () => {
  it('matches any duplicate key error when no field is given', () => {
    expect(isDuplicateKeyError({ code: 11000 })).toBe(true);
    expect(isDuplicateKeyError({ code: 11000, keyPattern: { _id: 1 } })).toBe(true);
  });

  it('matches only the requested index field when one is given', () => {
    const error = { code: 11000, keyPattern: { customerId: 1, idempotencyKey: 1 } };

    expect(isDuplicateKeyError(error, 'idempotencyKey')).toBe(true);
    expect(isDuplicateKeyError({ code: 11000, keyPattern: { _id: 1 } }, 'idempotencyKey')).toBe(false);
    expect(isDuplicateKeyError({ code: 11000 }, 'idempotencyKey')).toBe(false);
  });

  it('ignores other error codes and non-object values', () => {
    expect(isDuplicateKeyError({ code: 121 })).toBe(false);
    expect(isDuplicateKeyError(new Error('boom'))).toBe(false);
    expect(isDuplicateKeyError(null)).toBe(false);
    expect(isDuplicateKeyError('11000')).toBe(false);
  });
});

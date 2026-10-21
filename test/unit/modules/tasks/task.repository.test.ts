import { describe, expect, it } from 'vitest';
import { isIdempotencyViolation } from '../../../../src/modules/tasks/task.repository';

describe('isIdempotencyViolation', () => {
  it('matches a duplicate key error on the idempotency index', () => {
    expect(
      isIdempotencyViolation({ code: 11000, keyPattern: { customerId: 1, idempotencyKey: 1 } }),
    ).toBe(true);
  });

  it('ignores duplicate key errors on other indexes such as _id', () => {
    expect(isIdempotencyViolation({ code: 11000, keyPattern: { _id: 1 } })).toBe(false);
    expect(isIdempotencyViolation({ code: 11000 })).toBe(false);
  });

  it('ignores other error codes and non-object values', () => {
    expect(isIdempotencyViolation({ code: 121, keyPattern: { idempotencyKey: 1 } })).toBe(false);
    expect(isIdempotencyViolation(new Error('boom'))).toBe(false);
    expect(isIdempotencyViolation(null)).toBe(false);
    expect(isIdempotencyViolation('11000')).toBe(false);
  });
});

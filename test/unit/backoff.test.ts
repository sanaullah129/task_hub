import { describe, expect, it } from 'vitest';
import { computeBackoffMs } from '../../src/domain/backoff.js';

const options = { baseMs: 1_000, capMs: 30_000 };
const noJitter = (): number => 0;
const maxJitter = (): number => 1;

describe('computeBackoffMs', () => {
  it('doubles the delay on each attempt', () => {
    expect([1, 2, 3, 4].map((attempt) => computeBackoffMs(attempt, options, noJitter))).toEqual([
      1_000, 2_000, 4_000, 8_000,
    ]);
  });

  it('caps the exponential delay', () => {
    expect(computeBackoffMs(10, options, noJitter)).toBe(30_000);
  });

  it('adds jitter as a fraction of the capped delay', () => {
    expect(computeBackoffMs(1, options, maxJitter)).toBe(1_200);
    expect(computeBackoffMs(10, options, maxJitter)).toBe(36_000);
  });

  it('honours a custom jitter ratio and a zero ratio', () => {
    expect(computeBackoffMs(2, { ...options, jitterRatio: 0.5 }, () => 0.5)).toBe(2_500);
    expect(computeBackoffMs(2, { ...options, jitterRatio: 0 }, maxJitter)).toBe(2_000);
  });

  it('stays within the jitter window with the default random source', () => {
    for (let i = 0; i < 50; i++) {
      const delay = computeBackoffMs(3, options);
      expect(delay).toBeGreaterThanOrEqual(4_000);
      expect(delay).toBeLessThanOrEqual(4_800);
    }
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects invalid attempt %s', (attempt) => {
    expect(() => computeBackoffMs(attempt, options)).toThrow(RangeError);
  });
});

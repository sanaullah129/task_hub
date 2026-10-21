import { describe, expect, it } from 'vitest';
import { percentage, percentileOfSorted, summarizeDurations } from '../../../../src/modules/metrics/metrics.stats';
import { DEFAULT_WINDOW, WINDOWS, parseWindow } from '../../../../src/modules/metrics/metrics.window';
import { ValidationError } from '../../../../src/shared/errors/appErrors';

const oneToHundred = Array.from({ length: 100 }, (_, i) => i + 1);

describe('percentileOfSorted (nearest rank)', () => {
  it('returns the value at ceil(p/100 * n)', () => {
    expect(percentileOfSorted(oneToHundred, 50)).toBe(50);
    expect(percentileOfSorted(oneToHundred, 96)).toBe(96);
    expect(percentileOfSorted(oneToHundred, 99)).toBe(99);
    expect(percentileOfSorted(oneToHundred, 100)).toBe(100);
  });

  it('handles small samples without reading past the ends', () => {
    expect(percentileOfSorted([7], 50)).toBe(7);
    expect(percentileOfSorted([7], 99)).toBe(7);
    expect(percentileOfSorted([1, 2, 3, 4], 50)).toBe(2);
    expect(percentileOfSorted([1, 2, 3, 4], 96)).toBe(4);
    expect(percentileOfSorted([1, 2, 3, 4], 0)).toBe(1);
  });

  it('returns null with no samples', () => {
    expect(percentileOfSorted([], 50)).toBeNull();
  });
});

describe('summarizeDurations', () => {
  it('sorts the input and reports count, percentiles, average and max', () => {
    const shuffled = [...oneToHundred].reverse();

    expect(summarizeDurations(shuffled)).toEqual({ count: 100, p50: 50, p96: 96, p99: 99, avg: 50.5, max: 100 });
    expect(shuffled[0]).toBe(100);
  });

  it('reports nulls for an empty sample set', () => {
    expect(summarizeDurations([])).toEqual({ count: 0, p50: null, p96: null, p99: null, avg: null, max: null });
  });

  it('rounds the average to two decimals', () => {
    expect(summarizeDurations([1, 2, 2]).avg).toBe(1.67);
  });
});

describe('percentage', () => {
  it('rounds to two decimals and returns null for a zero denominator', () => {
    expect(percentage(1, 3)).toBe(33.33);
    expect(percentage(2, 3)).toBe(66.67);
    expect(percentage(5, 5)).toBe(100);
    expect(percentage(0, 4)).toBe(0);
    expect(percentage(0, 0)).toBeNull();
  });
});

describe('parseWindow', () => {
  it('defaults to one hour and accepts each supported window', () => {
    expect(parseWindow(undefined)).toBe(DEFAULT_WINDOW);
    expect(DEFAULT_WINDOW).toBe('1h');
    for (const key of Object.keys(WINDOWS)) expect(parseWindow(key)).toBe(key);
  });

  it.each(['2h', '', 'toString', 5, ['1h']])('rejects %j', (raw) => {
    expect(() => parseWindow(raw)).toThrow(ValidationError);
  });
});

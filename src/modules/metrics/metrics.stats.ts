export interface DurationStats {
  count: number;
  p50: number | null;
  p96: number | null;
  p99: number | null;
  avg: number | null;
  max: number | null;
}

/** Nearest-rank percentile of an ascending-sorted list; null when there are no samples. */
export function percentileOfSorted(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1] ?? null;
}

export function summarizeDurations(samples: readonly number[]): DurationStats {
  if (samples.length === 0) return { count: 0, p50: null, p96: null, p99: null, avg: null, max: null };
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    count: sorted.length,
    p50: percentileOfSorted(sorted, 50),
    p96: percentileOfSorted(sorted, 96),
    p99: percentileOfSorted(sorted, 99),
    avg: Math.round((sum / sorted.length) * 100) / 100,
    max: sorted.at(-1) ?? null,
  };
}

/** Percentage rounded to two decimals; null when the denominator is zero. */
export function percentage(part: number, total: number): number | null {
  return total === 0 ? null : Math.round((part / total) * 10_000) / 100;
}

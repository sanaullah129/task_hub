export interface BackoffOptions {
  baseMs: number;
  capMs: number;
  /** Extra random delay as a fraction of the capped delay; applied after the cap. */
  jitterRatio?: number;
}

export type RandomSource = () => number;

export function computeBackoffMs(
  attempt: number,
  { baseMs, capMs, jitterRatio = 0.2 }: BackoffOptions,
  random: RandomSource = Math.random,
): number {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new RangeError(`attempt must be a positive integer, got ${attempt}`);
  }
  const exponential = Math.min(capMs, baseMs * 2 ** (attempt - 1));
  return Math.round(exponential + random() * jitterRatio * exponential);
}

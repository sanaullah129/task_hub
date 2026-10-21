const DUPLICATE_KEY_CODE = 11000;

/** True for a MongoDB duplicate-key error, optionally only when it was raised by the index covering `field`. */
export function isDuplicateKeyError(error: unknown, field?: string): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, keyPattern } = error as { code?: unknown; keyPattern?: unknown };
  if (code !== DUPLICATE_KEY_CODE) return false;
  if (field === undefined) return true;
  return typeof keyPattern === 'object' && keyPattern !== null && field in keyPattern;
}

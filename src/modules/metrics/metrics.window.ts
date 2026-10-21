import { ValidationError } from '../../shared/errors/appErrors';

export const WINDOWS = {
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '24h': 24 * 60 * 60_000,
} as const;

export type WindowKey = keyof typeof WINDOWS;
export const DEFAULT_WINDOW: WindowKey = '1h';

export function parseWindow(raw: unknown): WindowKey {
  if (raw === undefined) return DEFAULT_WINDOW;
  if (typeof raw === 'string' && Object.hasOwn(WINDOWS, raw)) return raw as WindowKey;
  throw new ValidationError([`window: must be one of ${Object.keys(WINDOWS).join(', ')}`]);
}

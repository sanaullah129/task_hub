import winston, { type Logger } from 'winston';
import type { Config } from '../config/config';

export type { Logger };

export interface LoggerBindings {
  role?: string;
}

const REDACTED = '[redacted]';
const SENSITIVE_KEYS = new Set(['secret', 'authorization', 'x-taskhub-signature']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// Returns a copy so objects owned by the caller are never mutated.
export function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (Array.isArray(value)) {
    if (seen.has(value)) return '[circular]';
    seen.add(value);
    return value.map((item: unknown) => redact(item, seen));
  }
  if (isPlainObject(value)) {
    if (seen.has(value)) return '[circular]';
    seen.add(value);
    const copy: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      copy[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? REDACTED : redact(nested, seen);
    }
    return copy;
  }
  return value;
}

const redactFormat = winston.format((info) => {
  for (const key of Object.keys(info)) {
    if (key === 'level' || key === 'message') continue;
    info[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? REDACTED : redact(info[key]);
  }
  return info;
});

export function createLogger(
  config: Pick<Config, 'logLevel'>,
  bindings: LoggerBindings = {},
  transports?: winston.transport[],
): Logger {
  const silent = config.logLevel === 'silent';
  return winston.createLogger({
    level: silent ? 'error' : config.logLevel,
    silent,
    defaultMeta: { service: 'taskhub', ...bindings },
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      redactFormat(),
      winston.format.json(),
    ),
    transports: transports ?? [new winston.transports.Console()],
  });
}

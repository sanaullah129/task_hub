import { z } from 'zod';
import { type TaskType } from '../modules/tasks/task.constants';

export const ROLES = ['api', 'worker', 'delivery', 'reconciler'] as const;
export type Role = (typeof ROLES)[number];

export class ConfigError extends Error {
  constructor(public readonly issues: readonly string[]) {
    super(`Invalid configuration:\n- ${issues.join('\n- ')}`);
    this.name = 'ConfigError';
  }
}

export const LOG_LEVELS = ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const positiveInt = (fallback: number) => z.coerce.number().int().positive().default(fallback);

const booleanFlag = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const rolesSchema = z
  .string()
  .default(ROLES.join(','))
  .transform((value) =>
    value
      .split(',')
      .map((role) => role.trim())
      .filter((role) => role.length > 0),
  )
  .pipe(z.array(z.enum(ROLES)).min(1));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: positiveInt(3000),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  ROLES: rolesSchema,
  DEMO_MODE: booleanFlag,
  MONGODB_URI: z.string().min(1).default('mongodb://127.0.0.1:27017'),
  MONGODB_DB: z.string().min(1).default('taskhub'),

  TASK_POLL_INTERVAL_MS: positiveInt(500),
  TASK_CONCURRENCY: positiveInt(4),
  TASK_MAX_ATTEMPTS: positiveInt(3),
  TASK_TIMEOUT_MS: positiveInt(30_000),
  TASK_LEASE_GRACE_MS: positiveInt(10_000),
  TASK_RETRY_BASE_MS: positiveInt(1_000),
  TASK_RETRY_CAP_MS: positiveInt(30_000),
  MAX_PAYLOAD_BYTES: positiveInt(100_000),
  SLA_DOCUMENT_PROCESSING_MS: positiveInt(60_000),
  SLA_REPORT_GENERATION_MS: positiveInt(120_000),
  SLA_DATA_SYNC_MS: positiveInt(300_000),

  DELIVERY_POLL_INTERVAL_MS: positiveInt(500),
  DELIVERY_TIMEOUT_MS: positiveInt(10_000),
  DELIVERY_MAX_ATTEMPTS: positiveInt(6),
  DELIVERY_BACKOFF_BASE_MS: positiveInt(1_000),
  DELIVERY_BACKOFF_CAP_MS: positiveInt(60_000),

  RECONCILER_INTERVAL_MS: positiveInt(5_000),
});

export interface BackoffConfig {
  baseMs: number;
  capMs: number;
}

export interface TaskTypeConfig {
  timeoutMs: number;
  slaMs: number;
}

export interface Config {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  logLevel: LogLevel;
  roles: readonly Role[];
  demoMode: boolean;
  mongo: { uri: string; dbName: string };
  task: {
    pollIntervalMs: number;
    concurrency: number;
    maxAttempts: number;
    leaseGraceMs: number;
    maxPayloadBytes: number;
    retry: BackoffConfig;
    types: Readonly<Record<TaskType, TaskTypeConfig>>;
  };
  delivery: {
    pollIntervalMs: number;
    timeoutMs: number;
    maxAttempts: number;
    backoff: BackoffConfig;
  };
  reconcilerIntervalMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }
  const e = parsed.data;

  const issues: string[] = [];
  if (e.TASK_RETRY_CAP_MS < e.TASK_RETRY_BASE_MS) {
    issues.push('TASK_RETRY_CAP_MS: must be >= TASK_RETRY_BASE_MS');
  }
  if (e.DELIVERY_BACKOFF_CAP_MS < e.DELIVERY_BACKOFF_BASE_MS) {
    issues.push('DELIVERY_BACKOFF_CAP_MS: must be >= DELIVERY_BACKOFF_BASE_MS');
  }
  if (issues.length > 0) throw new ConfigError(issues);

  const types: Record<TaskType, TaskTypeConfig> = {
    document_processing: { timeoutMs: e.TASK_TIMEOUT_MS, slaMs: e.SLA_DOCUMENT_PROCESSING_MS },
    report_generation: { timeoutMs: e.TASK_TIMEOUT_MS, slaMs: e.SLA_REPORT_GENERATION_MS },
    data_sync: { timeoutMs: e.TASK_TIMEOUT_MS, slaMs: e.SLA_DATA_SYNC_MS },
  };

  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    roles: [...new Set(e.ROLES)],
    demoMode: e.DEMO_MODE,
    mongo: { uri: e.MONGODB_URI, dbName: e.MONGODB_DB },
    task: {
      pollIntervalMs: e.TASK_POLL_INTERVAL_MS,
      concurrency: e.TASK_CONCURRENCY,
      maxAttempts: e.TASK_MAX_ATTEMPTS,
      leaseGraceMs: e.TASK_LEASE_GRACE_MS,
      maxPayloadBytes: e.MAX_PAYLOAD_BYTES,
      retry: { baseMs: e.TASK_RETRY_BASE_MS, capMs: e.TASK_RETRY_CAP_MS },
      types,
    },
    delivery: {
      pollIntervalMs: e.DELIVERY_POLL_INTERVAL_MS,
      timeoutMs: e.DELIVERY_TIMEOUT_MS,
      maxAttempts: e.DELIVERY_MAX_ATTEMPTS,
      backoff: { baseMs: e.DELIVERY_BACKOFF_BASE_MS, capMs: e.DELIVERY_BACKOFF_CAP_MS },
    },
    reconcilerIntervalMs: e.RECONCILER_INTERVAL_MS,
  };
}

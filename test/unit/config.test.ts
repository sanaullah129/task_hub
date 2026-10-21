import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/config/config.js';

describe('loadConfig', () => {
  it('applies documented defaults for an empty environment', () => {
    const config = loadConfig({});

    expect(config.nodeEnv).toBe('development');
    expect(config.port).toBe(3000);
    expect(config.roles).toEqual(['api', 'worker', 'delivery', 'reconciler']);
    expect(config.demoMode).toBe(false);
    expect(config.mongo).toEqual({ uri: 'mongodb://127.0.0.1:27017', dbName: 'taskhub' });
    expect(config.task.maxAttempts).toBe(3);
    expect(config.task.retry).toEqual({ baseMs: 1_000, capMs: 30_000 });
    expect(config.delivery.maxAttempts).toBe(6);
    expect(config.task.types.document_processing).toEqual({ timeoutMs: 30_000, slaMs: 60_000 });
    expect(config.task.types.report_generation.slaMs).toBe(120_000);
    expect(config.task.types.data_sync.slaMs).toBe(300_000);
  });

  it('reads overrides from the environment and coerces numbers', () => {
    const config = loadConfig({
      PORT: '8080',
      MONGODB_DB: 'taskhub_test',
      DEMO_MODE: 'true',
      TASK_TIMEOUT_MS: '2000',
      SLA_DATA_SYNC_MS: '5000',
      LOG_LEVEL: 'debug',
    });

    expect(config.port).toBe(8080);
    expect(config.mongo.dbName).toBe('taskhub_test');
    expect(config.demoMode).toBe(true);
    expect(config.logLevel).toBe('debug');
    expect(config.task.types.data_sync).toEqual({ timeoutMs: 2000, slaMs: 5000 });
  });

  it('parses roles, trimming spaces and removing duplicates', () => {
    const config = loadConfig({ ROLES: ' api , worker,api ' });

    expect(config.roles).toEqual(['api', 'worker']);
  });

  it('rejects unknown roles', () => {
    expect(() => loadConfig({ ROLES: 'api,janitor' })).toThrow(ConfigError);
  });

  it('rejects an empty role list', () => {
    expect(() => loadConfig({ ROLES: ' , ' })).toThrow(ConfigError);
  });

  it('rejects non-positive or non-numeric numbers and lists every issue', () => {
    try {
      loadConfig({ PORT: '0', TASK_CONCURRENCY: 'abc' });
      expect.unreachable('loadConfig should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const { issues } = error as ConfigError;
      expect(issues.some((issue) => issue.startsWith('PORT'))).toBe(true);
      expect(issues.some((issue) => issue.startsWith('TASK_CONCURRENCY'))).toBe(true);
    }
  });

  it('rejects an invalid DEMO_MODE value', () => {
    expect(() => loadConfig({ DEMO_MODE: 'yes' })).toThrow(ConfigError);
  });

  it('rejects a task retry cap below the base delay', () => {
    expect(() => loadConfig({ TASK_RETRY_BASE_MS: '5000', TASK_RETRY_CAP_MS: '1000' })).toThrow(
      /TASK_RETRY_CAP_MS/,
    );
  });

  it('rejects a delivery backoff cap below the base delay', () => {
    expect(() =>
      loadConfig({ DELIVERY_BACKOFF_BASE_MS: '5000', DELIVERY_BACKOFF_CAP_MS: '1000' }),
    ).toThrow(/DELIVERY_BACKOFF_CAP_MS/);
  });
});

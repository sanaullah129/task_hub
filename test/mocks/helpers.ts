import { loadConfig, type Config } from '../../src/config/config';
import { createLogger, type Logger } from '../../src/observability/logger';

export const testConfig = (env: Record<string, string> = {}): Config =>
  loadConfig({ LOG_LEVEL: 'silent', ...env });

export const silentLogger = (): Logger => createLogger({ logLevel: 'silent' });

export function validSubmitBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    customerId: 'cust_acme',
    taskType: 'document_processing',
    payload: { documentId: 'doc_1' },
    idempotencyKey: 'idem_1',
    ...overrides,
  };
}

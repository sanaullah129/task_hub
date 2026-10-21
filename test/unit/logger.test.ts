import { describe, expect, it } from 'vitest';
import { createLogger, redact } from '../../src/observability/logger.js';
import { createLogCapture } from '../mocks/logCapture.js';

describe('createLogger', () => {
  it('emits structured JSON with service, role, and ISO timestamp', () => {
    const capture = createLogCapture();
    const logger = createLogger({ logLevel: 'info' }, { role: 'worker' }, [capture.transport]);

    logger.info('task claimed', { taskId: 'tsk_1', correlationId: 'cor_1' });

    const [line] = capture.lines();
    expect(line).toMatchObject({
      level: 'info',
      message: 'task claimed',
      service: 'taskhub',
      role: 'worker',
      taskId: 'tsk_1',
      correlationId: 'cor_1',
    });
    expect(Number.isNaN(Date.parse(String(line?.['timestamp'])))).toBe(false);
  });

  it('carries child logger bindings on every line', () => {
    const capture = createLogCapture();
    const logger = createLogger({ logLevel: 'info' }, {}, [capture.transport]);

    logger.child({ taskId: 'tsk_9', customerId: 'cust_1' }).info('state changed');

    expect(capture.lines()[0]).toMatchObject({ taskId: 'tsk_9', customerId: 'cust_1' });
  });

  it('respects the configured level', () => {
    const capture = createLogCapture();
    const logger = createLogger({ logLevel: 'warn' }, {}, [capture.transport]);

    logger.info('hidden');
    logger.warn('shown');

    expect(capture.lines().map((line) => line['message'])).toEqual(['shown']);
  });

  it('emits nothing when the level is silent', () => {
    const capture = createLogCapture();
    const logger = createLogger({ logLevel: 'silent' }, {}, [capture.transport]);

    logger.error('hidden');

    expect(capture.lines()).toEqual([]);
  });

  it('serialises errors with message and stack', () => {
    const capture = createLogCapture();
    const logger = createLogger({ logLevel: 'info' }, {}, [capture.transport]);

    logger.error('delivery failed', new Error('connect ECONNREFUSED'));

    const [line] = capture.lines();
    expect(String(line?.['message'])).toContain('connect ECONNREFUSED');
    expect(String(line?.['stack'])).toContain('Error: connect ECONNREFUSED');
  });

  it('redacts secrets and authorization values, including nested ones', () => {
    const capture = createLogCapture();
    const logger = createLogger({ logLevel: 'info' }, {}, [capture.transport]);

    logger.info('configured', { webhook: { url: 'https://example.test', secret: 'whsec_123' } });
    logger.info('nested', { customer: { webhook: { secret: 'whsec_456' } } });
    logger.info('request', { req: { headers: { Authorization: 'Bearer abc' } } });
    logger.info('top level', { secret: 'whsec_789' });

    const output = JSON.stringify(capture.lines());
    for (const leaked of ['whsec_123', 'whsec_456', 'whsec_789', 'Bearer abc']) {
      expect(output).not.toContain(leaked);
    }
    expect(output).toContain('[redacted]');
    expect(output).toContain('https://example.test');
  });

  it('does not mutate objects passed by the caller', () => {
    const capture = createLogCapture();
    const logger = createLogger({ logLevel: 'info' }, {}, [capture.transport]);
    const webhook = { url: 'https://example.test', secret: 'whsec_123' };

    logger.info('configured', { webhook });

    expect(webhook.secret).toBe('whsec_123');
  });
});

describe('redact', () => {
  it('copies plain objects and arrays while masking sensitive keys', () => {
    const input = { items: [{ secret: 'a', keep: 1 }], keep: 'x' };

    expect(redact(input)).toEqual({ items: [{ secret: '[redacted]', keep: 1 }], keep: 'x' });
  });

  it('leaves primitives and non-plain objects untouched', () => {
    const date = new Date('2026-10-21T00:00:00Z');

    expect(redact('text')).toBe('text');
    expect(redact(42)).toBe(42);
    expect(redact(null)).toBeNull();
    expect(redact(date)).toBe(date);
  });

  it('handles circular references', () => {
    const node: Record<string, unknown> = { name: 'a' };
    node['self'] = node;

    expect(redact(node)).toEqual({ name: 'a', self: '[circular]' });
  });

  it('handles circular arrays', () => {
    const list: unknown[] = [];
    list.push(list);

    expect(redact(list)).toEqual(['[circular]']);
  });
});

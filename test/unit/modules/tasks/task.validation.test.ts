import { describe, expect, it } from 'vitest';
import { parseSubmitRequest } from '../../../../src/modules/tasks/task.validation';
import { ValidationError } from '../../../../src/shared/errors/appErrors';
import { validSubmitBody } from '../../../mocks/helpers';

const options = { demoMode: false };

function validationDetails(body: unknown, demoMode = false): readonly string[] {
  try {
    parseSubmitRequest(body, { demoMode });
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    return (error as ValidationError).details ?? [];
  }
  throw new Error('expected parseSubmitRequest to throw');
}

describe('parseSubmitRequest', () => {
  it('returns the parsed request with a null webhook URL by default', () => {
    expect(parseSubmitRequest(validSubmitBody(), options)).toEqual({
      customerId: 'cust_acme',
      taskType: 'document_processing',
      payload: { documentId: 'doc_1' },
      idempotencyKey: 'idem_1',
      webhookUrl: null,
    });
  });

  it('keeps unknown payload fields and simulate hints', () => {
    const payload = { documentId: 'doc_1', pages: 3, simulate: { durationMs: 50, failure: 'retryable', failTimes: 2 } };

    expect(parseSubmitRequest(validSubmitBody({ payload }), options).payload).toEqual(payload);
  });

  it('normalises a valid webhook override', () => {
    const parsed = parseSubmitRequest(validSubmitBody({ webhookUrl: 'https://hooks.example.com' }), options);

    expect(parsed.webhookUrl).toBe('https://hooks.example.com/');
  });

  it.each([
    [undefined, '(body)'],
    ['text', '(body)'],
    [{}, 'customerId'],
  ])('rejects a malformed body %#', (body, expected) => {
    expect(validationDetails(body).join('\n')).toContain(expected);
  });

  it('reports every invalid envelope field', () => {
    const details = validationDetails(
      validSubmitBody({ customerId: 'bad id!', taskType: 'unknown', idempotencyKey: '', payload: [] }),
    ).join('\n');

    for (const field of ['customerId', 'taskType', 'idempotencyKey', 'payload']) {
      expect(details).toContain(field);
    }
  });

  it.each([
    ['document_processing', { documentId: '' }, 'payload.documentId'],
    ['report_generation', {}, 'payload.reportType'],
    ['data_sync', { source: 'a' }, 'payload.target'],
    ['document_processing', { documentId: 'd', simulate: { failure: 'explode' } }, 'payload.simulate.failure'],
    ['document_processing', { documentId: 'd', simulate: { durationMs: -1 } }, 'payload.simulate.durationMs'],
  ])('validates the %s payload shape', (taskType, payload, expected) => {
    expect(validationDetails(validSubmitBody({ taskType, payload })).join('\n')).toContain(expected);
  });

  it('rejects an unsafe webhook override and reports it together with payload errors', () => {
    const details = validationDetails(
      validSubmitBody({ payload: {}, webhookUrl: 'http://169.254.169.254/latest' }),
    );

    expect(details.some((detail) => detail.startsWith('payload.documentId'))).toBe(true);
    expect(details.some((detail) => detail.startsWith('webhookUrl'))).toBe(true);
  });

  it('allows a loopback webhook override in demo mode', () => {
    const parsed = parseSubmitRequest(validSubmitBody({ webhookUrl: 'http://localhost:4000/hook' }), {
      demoMode: true,
    });

    expect(parsed.webhookUrl).toBe('http://localhost:4000/hook');
  });
});

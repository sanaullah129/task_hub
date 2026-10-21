import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../../src/shared/errors/appErrors';
import { parseCustomerId, parseWebhookRequest } from '../../../../src/modules/customers/customer.validation';

const strict = { demoMode: false };

function details(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    return ((error as ValidationError).details ?? []).join('\n');
  }
  throw new Error('expected a ValidationError');
}

describe('parseCustomerId', () => {
  it('accepts allowed characters', () => {
    expect(parseCustomerId('cust_acme-1.eu@x:y')).toBe('cust_acme-1.eu@x:y');
  });

  it.each(['', 'bad id', 'x'.repeat(129), 'semi;colon', 42])('rejects %j', (value) => {
    expect(details(() => parseCustomerId(value))).toContain('customerId');
  });
});

describe('parseWebhookRequest', () => {
  it('returns the normalised url and optional secret', () => {
    expect(
      parseWebhookRequest('cust_a', { url: 'https://hooks.example.com/in', secret: 's'.repeat(20) }, strict),
    ).toEqual({ customerId: 'cust_a', url: 'https://hooks.example.com/in', secret: 's'.repeat(20) });
    expect(parseWebhookRequest('cust_a', { url: 'https://hooks.example.com' }, strict).secret).toBeUndefined();
  });

  it('rejects an invalid customer id, body shape, short secret, and unsafe URL', () => {
    expect(details(() => parseWebhookRequest('bad id', { url: 'https://a.example.com' }, strict))).toContain('customerId');
    expect(details(() => parseWebhookRequest('c', undefined, strict))).toContain('(body)');
    expect(details(() => parseWebhookRequest('c', { url: 'https://a.example.com', secret: 'short' }, strict))).toContain('secret');
    expect(details(() => parseWebhookRequest('c', { url: 'http://127.0.0.1/x' }, strict))).toContain('url: must use https');
  });

  it('allows loopback http targets in demo mode', () => {
    expect(parseWebhookRequest('c', { url: 'http://localhost:4000/hook' }, { demoMode: true }).url).toBe(
      'http://localhost:4000/hook',
    );
  });
});

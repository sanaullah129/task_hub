import { describe, expect, it } from 'vitest';
import { SIGNATURE_HEADER, signPayload, verifySignature } from '../../../../src/modules/delivery/delivery.signing';

const secret = 'whsec_test_secret_value';
const body = JSON.stringify({ eventId: 'evt_1', status: 'Completed' });
const now = 1_792_000_000;

describe('webhook signatures', () => {
  it('produces a t=,v1= header that verifies for the same secret, timestamp and body', () => {
    const header = signPayload(secret, now, body);

    expect(header).toMatch(/^t=1792000000,v1=[0-9a-f]{64}$/);
    expect(verifySignature({ secret, header, body, nowSeconds: now })).toBe(true);
    expect(SIGNATURE_HEADER).toBe('X-TaskHub-Signature');
  });

  it('is deterministic and depends on every input', () => {
    expect(signPayload(secret, now, body)).toBe(signPayload(secret, now, body));
    expect(signPayload('other', now, body)).not.toBe(signPayload(secret, now, body));
    expect(signPayload(secret, now + 1, body)).not.toBe(signPayload(secret, now, body));
    expect(signPayload(secret, now, `${body} `)).not.toBe(signPayload(secret, now, body));
  });

  it('rejects a wrong secret or a tampered body', () => {
    const header = signPayload(secret, now, body);

    expect(verifySignature({ secret: 'wrong', header, body, nowSeconds: now })).toBe(false);
    expect(verifySignature({ secret, header, body: `${body}x`, nowSeconds: now })).toBe(false);
  });

  it('rejects timestamps outside the tolerance in either direction', () => {
    const header = signPayload(secret, now, body);

    expect(verifySignature({ secret, header, body, nowSeconds: now + 299 })).toBe(true);
    expect(verifySignature({ secret, header, body, nowSeconds: now + 301 })).toBe(false);
    expect(verifySignature({ secret, header, body, nowSeconds: now - 301 })).toBe(false);
    expect(verifySignature({ secret, header, body, nowSeconds: now + 3_000, toleranceSeconds: 5_000 })).toBe(true);
  });

  it.each(['', 'garbage', 't=abc,v1=00', 't=1792000000', 'v1=abcd', 't=1792000000,v1=short'])(
    'rejects malformed header %j',
    (header) => {
      expect(verifySignature({ secret, header, body, nowSeconds: now })).toBe(false);
    },
  );

  it('verifies against the real clock by default', () => {
    const header = signPayload(secret, Math.floor(Date.now() / 1000), body);

    expect(verifySignature({ secret, header, body })).toBe(true);
  });
});

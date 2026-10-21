import { describe, expect, it } from 'vitest';
import { isPrivateHost, validateWebhookUrl } from '../../../../src/modules/webhooks/webhookUrl';

const strict = { demoMode: false };
const demo = { demoMode: true };

describe('validateWebhookUrl', () => {
  it('accepts a public https URL and normalises it', () => {
    expect(validateWebhookUrl('https://hooks.example.com/tasks', strict)).toEqual({
      ok: true,
      url: 'https://hooks.example.com/tasks',
    });
  });

  it.each([
    ['not a url', 'valid absolute URL'],
    ['http://hooks.example.com', 'https'],
    ['ftp://hooks.example.com', 'https'],
    ['https://user:pass@hooks.example.com', 'credentials'],
    ['https://localhost/hook', 'private'],
    ['https://127.0.0.1/hook', 'private'],
    ['https://10.1.2.3/hook', 'private'],
    ['https://[::1]/hook', 'private'],
  ])('rejects %s outside demo mode', (url, reason) => {
    const result = validateWebhookUrl(url, strict);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain(reason);
  });

  it('allows http and loopback targets in demo mode', () => {
    expect(validateWebhookUrl('http://localhost:4000/hook', demo)).toEqual({
      ok: true,
      url: 'http://localhost:4000/hook',
    });
  });

  it('still rejects unsupported protocols and credentials in demo mode', () => {
    expect(validateWebhookUrl('ftp://localhost/hook', demo)).toEqual({
      ok: false,
      reason: 'must use http or https',
    });
    expect(validateWebhookUrl('http://a:b@localhost/hook', demo).ok).toBe(false);
  });
});

describe('isPrivateHost', () => {
  it.each([
    '0.0.0.0',
    '10.0.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '[::1]',
    '[::]',
    '[fd00::1]',
    '[fe80::1]',
    '[::ffff:7f00:1]',
    'localhost',
    'api.localhost',
    'printer.local',
    'db.internal',
  ])('treats %s as private', (host) => {
    expect(isPrivateHost(host)).toBe(true);
  });

  it.each(['8.8.8.8', '172.32.0.1', '172.15.0.1', '[2606:4700::1111]', 'example.com'])(
    'treats %s as public',
    (host) => {
      expect(isPrivateHost(host)).toBe(false);
    },
  );
});

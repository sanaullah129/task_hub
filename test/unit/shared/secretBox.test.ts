import { describe, expect, it } from 'vitest';
import { createSecretBox } from '../../../src/shared/security/secretBox';

const KEY = 'a'.repeat(64);

describe('secretBox', () => {
  it('round-trips and never stores the plain text', () => {
    const box = createSecretBox(KEY);
    const stored = box.encrypt('whsec_plain');

    expect(stored).not.toContain('whsec_plain');
    expect(stored.startsWith('enc:v1:')).toBe(true);
    expect(box.decrypt(stored)).toBe('whsec_plain');
  });

  it('uses a fresh IV for every encryption', () => {
    const box = createSecretBox(KEY);

    expect(box.encrypt('same')).not.toBe(box.encrypt('same'));
  });

  it('passes pre-encryption plain values through', () => {
    expect(createSecretBox(KEY).decrypt('whsec_legacy')).toBe('whsec_legacy');
  });

  it('rejects tampered data and the wrong key', () => {
    const stored = createSecretBox(KEY).encrypt('whsec_plain');

    expect(() => createSecretBox('b'.repeat(64)).decrypt(stored)).toThrow();
    expect(() => createSecretBox(KEY).decrypt(`${stored.slice(0, -4)}AAAA`)).toThrow();
    expect(() => createSecretBox(KEY).decrypt('enc:v1:only-one-part')).toThrow('malformed');
  });

  it('requires a 32 byte key', () => {
    expect(() => createSecretBox('abcd')).toThrow('32 bytes');
  });
});

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const PREFIX = 'enc:v1:';

export interface SecretBox {
  encrypt(plain: string): string;
  /** Values without the `enc:v1:` prefix are returned as-is so pre-encryption records keep working. */
  decrypt(stored: string): string;
}

/** AES-256-GCM; `keyHex` is 64 hex characters. */
export function createSecretBox(keyHex: string): SecretBox {
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) throw new Error('secrets key must be 32 bytes (64 hex characters)');

  return {
    encrypt(plain) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      return `${PREFIX}${[iv, cipher.getAuthTag(), data].map((part) => part.toString('base64')).join(':')}`;
    },
    decrypt(stored) {
      if (!stored.startsWith(PREFIX)) return stored;
      const [iv, tag, data] = stored.slice(PREFIX.length).split(':').map((part) => Buffer.from(part, 'base64'));
      if (iv === undefined || tag === undefined || data === undefined) throw new Error('malformed encrypted secret');
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    },
  };
}

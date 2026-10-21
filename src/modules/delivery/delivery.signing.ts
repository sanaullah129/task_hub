import { createHmac, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_HEADER = 'X-TaskHub-Signature';
export const TIMESTAMP_HEADER = 'X-TaskHub-Timestamp';
const DEFAULT_TOLERANCE_SECONDS = 300;

const digest = (secret: string, timestamp: number, body: string): string =>
  createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');

/** Header value `t=<unix seconds>,v1=<hex hmac of "<t>.<body>">`; the timestamp is signed to stop replays. */
export const signPayload = (secret: string, timestamp: number, body: string): string =>
  `t=${timestamp},v1=${digest(secret, timestamp, body)}`;

export interface VerifyOptions {
  secret: string;
  header: string;
  body: string;
  toleranceSeconds?: number;
  nowSeconds?: number;
}

export function verifySignature({
  secret,
  header,
  body,
  toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
  nowSeconds = Math.floor(Date.now() / 1000),
}: VerifyOptions): boolean {
  const parts = new Map(header.split(',').map((part) => part.trim().split('=', 2) as [string, string | undefined]));
  const timestamp = Number(parts.get('t'));
  const provided = parts.get('v1');
  if (!Number.isInteger(timestamp) || provided === undefined) return false;
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return false;

  const expected = Buffer.from(digest(secret, timestamp, body));
  const actual = Buffer.from(provided);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

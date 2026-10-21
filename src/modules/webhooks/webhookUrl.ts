import { isIP } from 'node:net';

export type WebhookUrlResult = { ok: true; url: string } | { ok: false; reason: string };

function isPrivateIPv4(host: string): boolean {
  const [a = 0, b = 0] = host.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isPrivateIPv6(host: string): boolean {
  const lower = host.toLowerCase();
  return (
    lower === '::' ||
    lower === '::1' ||
    lower.startsWith('fc') ||
    lower.startsWith('fd') ||
    lower.startsWith('fe8') ||
    lower.startsWith('fe9') ||
    lower.startsWith('fea') ||
    lower.startsWith('feb') ||
    lower.startsWith('::ffff:')
  );
}

export function isPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '');
  const ipVersion = isIP(host);
  if (ipVersion === 4) return isPrivateIPv4(host);
  if (ipVersion === 6) return isPrivateIPv6(host);
  const lower = host.toLowerCase();
  return lower === 'localhost' || lower.endsWith('.localhost') || lower.endsWith('.local') || lower.endsWith('.internal');
}

// Literal host checks only; resolving DNS and pinning the IP is tracked in docs/IMPROVEMENTS.md.
export function validateWebhookUrl(raw: string, options: { demoMode: boolean }): WebhookUrlResult {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: 'must be a valid absolute URL' };
  }
  const allowedProtocols = options.demoMode ? ['https:', 'http:'] : ['https:'];
  if (!allowedProtocols.includes(parsed.protocol)) {
    return { ok: false, reason: options.demoMode ? 'must use http or https' : 'must use https' };
  }
  if (parsed.username !== '' || parsed.password !== '') {
    return { ok: false, reason: 'must not contain credentials' };
  }
  if (!options.demoMode && isPrivateHost(parsed.hostname)) {
    return { ok: false, reason: 'must not target a private or loopback address' };
  }
  return { ok: true, url: parsed.href };
}

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express, { type Express } from 'express';
import { verifySignature } from '../../src/modules/delivery';
import { sleep } from '../../src/shared/utils/sleep';

export type ReceiverMode =
  | { kind: 'ok' }
  | { kind: 'fail-n'; remaining: number; status: number }
  | { kind: 'always-500' }
  | { kind: 'slow'; delayMs: number }
  | { kind: 'drop' };

export interface ReceivedWebhook {
  receivedAt: string;
  path: string;
  eventId: string;
  eventType: string;
  deliveryAttempt: string;
  /** null when no secret is configured, so nothing could be verified. */
  signatureValid: boolean | null;
  /** True when this eventId was already received on this path (at-least-once delivery). */
  duplicate: boolean;
  respondedWith: number | 'dropped';
}

/** Webhook endpoint with controllable failure modes, per path, for demos and manual testing. */
export class MockReceiver {
  readonly app: Express = express();
  readonly received: ReceivedWebhook[] = [];
  private readonly modes = new Map<string, ReceiverMode>();
  private server: Server | undefined;
  private secret: string | undefined;

  constructor(options: { secret?: string } = {}) {
    this.secret = options.secret;
    this.app.use(express.raw({ type: () => true, limit: '1mb' }));

    this.app.post('/admin/mode', express.json(), (req, res) => {
      const body = req.body as { path?: string; mode?: string; failCount?: number; status?: number; delayMs?: number };
      const mode = this.parseMode(body);
      if (mode === undefined) {
        res.status(400).json({ error: 'mode must be one of ok, fail-n, always-500, slow, drop' });
        return;
      }
      this.setMode(body.path ?? '/hook', mode);
      res.json({ path: body.path ?? '/hook', mode });
    });
    this.app.get('/admin/received', (_req, res) => res.json(this.received));
    this.app.delete('/admin/received', (_req, res) => {
      this.received.length = 0;
      res.status(204).end();
    });
    this.app.post(['/hook', '/hook/*path'], (req, res) => void this.handle(req.path, req.get('x-taskhub-signature'), req.body as Buffer, req.headers, res));
  }

  setSecret(secret: string | undefined): void {
    this.secret = secret;
  }

  setMode(path: string, mode: ReceiverMode): void {
    this.modes.set(path, mode);
  }

  async listen(port = 0): Promise<number> {
    this.server = createServer(this.app);
    await new Promise<void>((resolve) => this.server?.listen(port, '127.0.0.1', resolve));
    return (this.server.address() as AddressInfo).port;
  }

  async close(): Promise<void> {
    this.server?.closeAllConnections();
    await new Promise<void>((resolve) => (this.server === undefined ? resolve() : this.server.close(() => resolve())));
  }

  forPath(path: string): ReceivedWebhook[] {
    return this.received.filter((entry) => entry.path === path);
  }

  private parseMode(body: { mode?: string; failCount?: number; status?: number; delayMs?: number }): ReceiverMode | undefined {
    switch (body.mode) {
      case 'ok':
        return { kind: 'ok' };
      case 'fail-n':
        return { kind: 'fail-n', remaining: body.failCount ?? 2, status: body.status ?? 503 };
      case 'always-500':
        return { kind: 'always-500' };
      case 'slow':
        return { kind: 'slow', delayMs: body.delayMs ?? 3_000 };
      case 'drop':
        return { kind: 'drop' };
      default:
        return undefined;
    }
  }

  private async handle(
    path: string,
    signature: string | undefined,
    raw: Buffer,
    headers: Record<string, string | string[] | undefined>,
    res: express.Response,
  ): Promise<void> {
    const text = raw.toString('utf8');
    const parsed = safeJson(text);
    const eventId = text_(parsed['eventId'], text_(headers['x-taskhub-event-id'], 'unknown'));
    const mode = this.modes.get(path) ?? this.modes.get('/hook') ?? { kind: 'ok' };

    const entry: ReceivedWebhook = {
      receivedAt: new Date().toISOString(),
      path,
      eventId,
      eventType: text_(parsed['eventType'], 'unknown'),
      deliveryAttempt: text_(headers['x-taskhub-delivery-attempt'], '?'),
      signatureValid:
        this.secret === undefined || signature === undefined
          ? null
          : verifySignature({ secret: this.secret, header: signature, body: text }),
      duplicate: this.received.some((previous) => previous.path === path && previous.eventId === eventId),
      respondedWith: 200,
    };
    this.received.push(entry);

    if (mode.kind === 'drop') {
      entry.respondedWith = 'dropped';
      res.socket?.destroy();
      return;
    }
    if (mode.kind === 'slow') await sleep(mode.delayMs);

    const failing =
      mode.kind === 'always-500' || (mode.kind === 'fail-n' && mode.remaining > 0);
    if (mode.kind === 'fail-n' && mode.remaining > 0) mode.remaining -= 1;
    const status = mode.kind === 'fail-n' && failing ? mode.status : failing ? 500 : 200;
    entry.respondedWith = status;
    res.status(status).json({ received: !failing, eventId });
  }
}

function text_(value: unknown, fallback: string): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return fallback;
}

function safeJson(text: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface ReceivedWebhook {
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

export interface Behavior {
  /** Respond with `status` to the first N requests, then 200. */
  failFirst?: number;
  status?: number;
  /** Respond with `status` forever. */
  always?: boolean;
}

/** Minimal in-test webhook endpoint with per-path failure behaviour. */
export class TestReceiver {
  private server: Server | undefined;
  private port = 0;
  private readonly behaviors = new Map<string, Behavior>();
  private readonly log: ReceivedWebhook[] = [];

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const path = req.url ?? '/';
        const seen = this.log.filter((entry) => entry.path === path).length;
        this.log.push({ path, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
        const behavior = this.behaviors.get(path) ?? {};
        const failing = behavior.always === true || seen < (behavior.failFirst ?? 0);
        res.statusCode = failing ? (behavior.status ?? 500) : 200;
        res.end(failing ? 'failing' : 'ok');
      });
    });
    await new Promise<void>((resolve) => this.server?.listen(0, '127.0.0.1', resolve));
    this.port = (this.server?.address() as AddressInfo).port;
  }

  async stop(): Promise<void> {
    this.server?.closeAllConnections();
    await new Promise<void>((resolve) => (this.server === undefined ? resolve() : this.server.close(() => resolve())));
  }

  url(path: string): string {
    return `http://127.0.0.1:${this.port}${path}`;
  }

  behave(path: string, behavior: Behavior): void {
    this.behaviors.set(path, behavior);
  }

  received(path: string): ReceivedWebhook[] {
    return this.log.filter((entry) => entry.path === path);
  }
}

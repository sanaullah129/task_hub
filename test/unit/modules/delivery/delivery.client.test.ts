import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { fetchWebhookClient } from '../../../../src/modules/delivery/delivery.client';

interface Received {
  method: string | undefined;
  headers: IncomingMessage['headers'];
  body: string;
}

let server: Server | undefined;

async function listen(handler: Parameters<typeof createServer>[1]): Promise<{ url: string; received: Received[] }> {
  const received: Received[] = [];
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      received.push({ method: req.method, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
      handler?.(req, res);
    });
  });
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`, received };
}

afterEach(async () => {
  server?.closeAllConnections();
  await new Promise<void>((resolve) => (server === undefined ? resolve() : server.close(() => resolve())));
  server = undefined;
});

describe('fetchWebhookClient', () => {
  it('posts the body and headers and reports status, latency and a response snippet', async () => {
    const { url, received } = await listen((_req, res) => {
      res.statusCode = 202;
      res.end('accepted');
    });

    const response = await fetchWebhookClient({
      url,
      body: '{"a":1}',
      headers: { 'Content-Type': 'application/json', 'X-TaskHub-Event-Id': 'evt_1' },
      timeoutMs: 2_000,
    });

    expect(response).toMatchObject({ statusCode: 202, responseSnippet: 'accepted' });
    expect(response.durationMs).toBeGreaterThanOrEqual(0);
    expect(response.error).toBeUndefined();
    expect(received[0]).toMatchObject({ method: 'POST', body: '{"a":1}' });
    expect(received[0]?.headers['x-taskhub-event-id']).toBe('evt_1');
  });

  it('truncates long response bodies', async () => {
    const { url } = await listen((_req, res) => res.end('x'.repeat(1_000)));

    const response = await fetchWebhookClient({ url, body: '{}', headers: {}, timeoutMs: 2_000 });

    expect(response.responseSnippet).toHaveLength(200);
  });

  it('returns non-2xx responses as statuses, not errors', async () => {
    const { url } = await listen((_req, res) => {
      res.statusCode = 500;
      res.end('boom');
    });

    expect(await fetchWebhookClient({ url, body: '{}', headers: {}, timeoutMs: 2_000 })).toMatchObject({
      statusCode: 500,
      responseSnippet: 'boom',
    });
  });

  it('does not follow redirects', async () => {
    const { url, received } = await listen((_req, res) => {
      res.statusCode = 302;
      res.setHeader('Location', 'http://127.0.0.1:1/elsewhere');
      res.end();
    });

    const response = await fetchWebhookClient({ url, body: '{}', headers: {}, timeoutMs: 2_000 });

    expect(response.statusCode).toBe(302);
    expect(received).toHaveLength(1);
  });

  it('reports a timeout when the endpoint is too slow', async () => {
    const { url } = await listen(() => undefined);

    const response = await fetchWebhookClient({ url, body: '{}', headers: {}, timeoutMs: 50 });

    expect(response.statusCode).toBeUndefined();
    expect(response.error).toBe('timeout after 50 ms');
  });

  it('reports a connection error with its code when nothing is listening', async () => {
    const { url } = await listen(() => undefined);
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;

    const response = await fetchWebhookClient({ url, body: '{}', headers: {}, timeoutMs: 1_000 });

    expect(response.statusCode).toBeUndefined();
    expect(response.error).toContain('ECONNREFUSED');
  });

  it('reports an invalid URL as an error without throwing', async () => {
    const response = await fetchWebhookClient({ url: 'not a url', body: '{}', headers: {}, timeoutMs: 1_000 });

    expect(response.statusCode).toBeUndefined();
    expect(response.error).toBeTruthy();
  });

  it('reports a dropped connection as an error', async () => {
    const { url } = await listen((req) => req.socket.destroy());

    const response = await fetchWebhookClient({ url, body: '{}', headers: {}, timeoutMs: 1_000 });

    expect(response.statusCode).toBeUndefined();
    expect(response.error).toBeTruthy();
  });
});

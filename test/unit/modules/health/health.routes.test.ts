import request, { type Response } from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import { createHealthModule, type HealthCheck } from '../../../../src/modules/health';

const bodyOf = (res: Response): Record<string, unknown> => res.body as Record<string, unknown>;

const appWith = (check: HealthCheck): express.Express => {
  const app = express();
  app.use('/healthz', createHealthModule(check).router);
  return app;
};

describe('GET /healthz', () => {
  it('reports ok when the check passes', async () => {
    const res = await request(appWith(() => Promise.resolve(true))).get('/healthz');

    expect(res.status).toBe(200);
    expect(bodyOf(res)).toEqual({ status: 'ok' });
  });

  it('reports 503 when the check returns false', async () => {
    const res = await request(appWith(() => Promise.resolve(false))).get('/healthz');

    expect(res.status).toBe(503);
    expect(bodyOf(res)).toEqual({ status: 'unavailable' });
  });

  it('reports 503 when the check throws', async () => {
    const check = vi.fn<HealthCheck>().mockRejectedValue(new Error('down'));

    expect((await request(appWith(check)).get('/healthz')).status).toBe(503);
  });
});

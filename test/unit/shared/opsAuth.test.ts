import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../../src/app';
import { silentLogger, testConfig } from '../../mocks/helpers';

const TOKEN = 'ops-token-1234567890';

const build = (opsToken?: string) => {
  const router = express.Router();
  router.get('/metrics', (_req, res) => res.send('ok'));
  router.get('/v1/ops/x', (_req, res) => res.send('ok'));
  router.get('/v1/deliveries', (_req, res) => res.send('ok'));
  router.get('/v1/tasks', (_req, res) => res.send('ok'));
  return createApp({
    config: testConfig(),
    logger: silentLogger(),
    routes: [{ path: '/', router }],
    ...(opsToken === undefined ? {} : { opsToken }),
  });
};

describe('ops bearer token', () => {
  it.each(['/metrics', '/v1/ops/x', '/v1/deliveries'])('rejects %s without a valid token', async (path) => {
    const app = build(TOKEN);

    expect((await request(app).get(path)).status).toBe(401);
    expect((await request(app).get(path).set('Authorization', 'Bearer wrong')).status).toBe(401);
    expect((await request(app).get(path).set('Authorization', TOKEN)).status).toBe(401);
    expect((await request(app).get(path).set('Authorization', `Bearer ${TOKEN}`)).status).toBe(200);
  });

  it('leaves customer-facing routes open', async () => {
    expect((await request(build(TOKEN)).get('/v1/tasks')).status).toBe(200);
  });

  it('is disabled when no token is configured', async () => {
    expect((await request(build()).get('/metrics')).status).toBe(200);
  });
});

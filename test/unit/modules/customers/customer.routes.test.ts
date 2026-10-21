import request, { type Response } from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildHarness } from '../../../mocks/harness';

const bodyOf = (res: Response): Record<string, unknown> => res.body as Record<string, unknown>;
const errorOf = (res: Response): Record<string, unknown> => bodyOf(res)['error'] as Record<string, unknown>;

describe('customer webhook routes', () => {
  it('configures a webhook and returns a generated secret exactly once', async () => {
    const { app, customers } = buildHarness();

    const put = await request(app).put('/v1/customers/cust_a/webhook').send({ url: 'https://hooks.example.com/in' });

    expect(put.status).toBe(200);
    expect(bodyOf(put)).toMatchObject({ customerId: 'cust_a', webhook: { url: 'https://hooks.example.com/in' } });
    expect(bodyOf(put)['secret']).toMatch(/^whsec_/);
    expect(customers.customers.get('cust_a')?.webhook?.secret).toBe(bodyOf(put)['secret']);

    const get = await request(app).get('/v1/customers/cust_a/webhook');
    expect(get.status).toBe(200);
    expect(bodyOf(get)).toEqual({
      customerId: 'cust_a',
      webhook: { url: 'https://hooks.example.com/in', secretConfigured: true },
    });
  });

  it('does not echo a caller-supplied secret', async () => {
    const { app } = buildHarness();

    const put = await request(app)
      .put('/v1/customers/cust_a/webhook')
      .send({ url: 'https://hooks.example.com/in', secret: 'y'.repeat(32) });

    expect(put.status).toBe(200);
    expect(JSON.stringify(put.body)).not.toContain('y'.repeat(32));
    expect(bodyOf(put)).not.toHaveProperty('secret');
  });

  it('rejects invalid input with 400', async () => {
    const { app } = buildHarness();

    const unsafe = await request(app).put('/v1/customers/cust_a/webhook').send({ url: 'http://localhost/x' });
    const badId = await request(app).put('/v1/customers/bad%20id/webhook').send({ url: 'https://hooks.example.com' });
    const noBody = await request(app).put('/v1/customers/cust_a/webhook');

    expect([unsafe.status, badId.status, noBody.status]).toEqual([400, 400, 400]);
    expect(errorOf(unsafe)['code']).toBe('validation_error');
  });

  it('allows a local URL in demo mode', async () => {
    const { app } = buildHarness({ env: { DEMO_MODE: 'true' } });

    const put = await request(app).put('/v1/customers/cust_a/webhook').send({ url: 'http://localhost:4000/hook' });

    expect(put.status).toBe(200);
  });

  it('returns 404 when no webhook is configured and 400 for an invalid id on read', async () => {
    const { app } = buildHarness();

    expect((await request(app).get('/v1/customers/cust_none/webhook')).status).toBe(404);
    expect((await request(app).get('/v1/customers/bad%20id/webhook')).status).toBe(400);
  });
});

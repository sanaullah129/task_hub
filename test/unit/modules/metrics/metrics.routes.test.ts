import request, { type Response } from 'supertest';
import { describe, expect, it } from 'vitest';
import { createMetricsModule } from '../../../../src/modules/metrics';
import { createMetrics } from '../../../../src/observability/metrics';
import { buildHarness } from '../../../mocks/harness';
import { FakeMetricsRepository } from '../../../mocks/metricsRepository';

const bodyOf = (res: Response): Record<string, unknown> => res.body as Record<string, unknown>;

function appWithMetrics() {
  const metrics = createMetrics();
  const module = createMetricsModule({ repository: new FakeMetricsRepository({ pending: 4 }), metrics });
  return buildHarness({ metrics, extraRoutes: [{ path: '/', router: module.router }] }).app;
}

describe('metrics routes', () => {
  it('exposes Prometheus metrics including the requests it served', async () => {
    const app = appWithMetrics();
    await request(app).get('/healthz');
    await request(app).get('/v1/tasks/tsk_missing');

    const res = await request(app).get('/metrics');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toContain('taskhub_http_requests_total{method="GET",route="/healthz",status="200"} 1');
    expect(res.text).toContain('taskhub_http_requests_total{method="GET",route="/v1/tasks/:taskId",status="404"} 1');
  });

  it('labels unknown paths as unmatched to keep cardinality low', async () => {
    const app = appWithMetrics();
    await request(app).get('/definitely/not/a/route');

    expect((await request(app).get('/metrics')).text).toContain('route="unmatched",status="404"');
  });

  it('returns the JSON summary for the default and an explicit window', async () => {
    const app = appWithMetrics();

    const byDefault = await request(app).get('/v1/ops/metrics/summary');
    const explicit = await request(app).get('/v1/ops/metrics/summary?window=24h');

    expect(bodyOf(byDefault)['window']).toBe('1h');
    expect(bodyOf(explicit)['window']).toBe('24h');
    expect((bodyOf(explicit)['technical'] as Record<string, unknown>)['pendingTasks']).toMatchObject({ value: 4 });
  });

  it('rejects an unsupported window', async () => {
    const res = await request(appWithMetrics()).get('/v1/ops/metrics/summary?window=2h');

    expect(res.status).toBe(400);
  });
});

import { Router } from 'express';
import type { Metrics } from '../../observability/metrics';
import type { MetricsService } from './metrics.service';
import { parseWindow } from './metrics.window';

export function createMetricsRouter(deps: { service: MetricsService; metrics: Metrics }): Router {
  const router = Router();

  router.get('/metrics', async (_req, res) => {
    res.type(deps.metrics.contentType).send(await deps.metrics.render());
  });

  router.get('/v1/ops/metrics/summary', async (req, res) => {
    res.json(await deps.service.summary(parseWindow(req.query['window'])));
  });

  return router;
}

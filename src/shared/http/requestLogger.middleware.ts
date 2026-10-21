import { performance } from 'node:perf_hooks';
import type { Request, RequestHandler } from 'express';
import type { Logger } from '../../observability/logger';
import { noopMetrics, type Metrics } from '../../observability/metrics';
import { getRequestContext } from './requestContext';

/** Route template (e.g. /v1/tasks/:taskId) so metrics labels stay low-cardinality. */
export function routeLabel(req: Request): string {
  const route = req.route as { path?: unknown } | undefined;
  if (typeof route?.path !== 'string') return 'unmatched';
  const full = `/${getRequestContext(req).mountPath ?? ''}/${route.path}`.replace(/\/+/g, '/');
  return full.length > 1 && full.endsWith('/') ? full.slice(0, -1) : full;
}

export function requestLogger(logger: Logger, metrics: Metrics = noopMetrics): RequestHandler {
  return (req, res, next) => {
    res.on('finish', () => {
      const { correlationId, startedAt } = getRequestContext(req);
      const durationMs = Math.round((performance.now() - startedAt) * 100) / 100;
      const level = res.statusCode >= 500 ? 'error' : 'http';
      logger.log(level, 'request completed', {
        correlationId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs,
      });
      metrics.recordHttpRequest({ method: req.method, route: routeLabel(req), status: res.statusCode, durationMs });
    });
    next();
  };
}

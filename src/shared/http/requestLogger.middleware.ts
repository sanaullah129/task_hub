import { performance } from 'node:perf_hooks';
import type { RequestHandler } from 'express';
import type { Logger } from '../../observability/logger';
import { getRequestContext } from './requestContext';

export function requestLogger(logger: Logger): RequestHandler {
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
    });
    next();
  };
}

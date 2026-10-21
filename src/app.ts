import express, { type Express, type Router } from 'express';
import type { Config } from './config/config';
import type { Logger } from './observability/logger';
import { noopMetrics, type Metrics } from './observability/metrics';
import { correlationMiddleware } from './shared/http/correlation.middleware';
import { errorHandler, notFoundHandler } from './shared/http/error.middleware';
import { requireBearerToken } from './shared/http/opsAuth.middleware';
import { requestLogger } from './shared/http/requestLogger.middleware';
import { setMountPath } from './shared/http/requestContext';

export interface AppRoute {
  path: string;
  router: Router;
}

export interface AppDeps {
  config: Pick<Config, 'task'>;
  logger: Logger;
  routes: readonly AppRoute[];
  metrics?: Metrics;
  /** When set, /metrics, /v1/ops/* and /v1/deliveries* require this bearer token. */
  opsToken?: string;
}

export function createApp({ config, logger, routes, metrics = noopMetrics, opsToken }: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');

  app.use(correlationMiddleware);
  app.use(requestLogger(logger, metrics));
  app.use(express.json({ limit: config.task.maxPayloadBytes }));
  if (opsToken !== undefined) app.use(['/metrics', '/v1/ops', '/v1/deliveries'], requireBearerToken(opsToken));

  for (const { path, router } of routes) {
    app.use(
      path,
      (req, _res, next) => {
        setMountPath(req, path);
        next();
      },
      router,
    );
  }

  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}

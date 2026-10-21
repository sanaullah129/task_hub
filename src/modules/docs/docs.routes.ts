import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { buildOpenApiSpec } from './openapi';

/** Serves the OpenAPI document at /openapi.json and Swagger UI at /docs. */
export function createDocsRouter(): Router {
  const spec = buildOpenApiSpec();
  const router = Router();

  router.get('/openapi.json', (_req, res) => {
    res.json(spec);
  });
  router.use(
    '/docs',
    swaggerUi.serve,
    swaggerUi.setup(spec, { customSiteTitle: 'TaskHub API', swaggerOptions: { displayRequestDuration: true } }),
  );

  return router;
}

import type { Server } from 'node:http';
import { createApp } from './app';
import { loadConfig } from './config/config';
import { createContainer } from './container';
import { connectDatabase } from './database/client';
import { ensureIndexes } from './database/indexes';
import { createLogger } from './observability/logger';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  const database = await connectDatabase(config.mongo);
  await ensureIndexes(database);
  logger.info('taskhub started', { roles: config.roles, db: config.mongo.dbName });

  const container = createContainer({ config, logger, database });

  let server: Server | undefined;
  if (config.roles.includes('api')) {
    const apiLogger = logger.child({ role: 'api' });
    const app = createApp({ config, logger: apiLogger, routes: container.routes, metrics: container.metrics, opsToken: config.security.opsToken });
    server = app.listen(config.port, () => apiLogger.info('api listening', { port: config.port }));
  }
  for (const lifecycle of container.lifecycles) lifecycle.start();

  const shutdown = async (signal: string): Promise<void> => {
    logger.info('shutting down', { signal });
    if (server !== undefined) {
      const api = server;
      await new Promise<void>((resolve) => api.close(() => resolve()));
    }
    await Promise.all(container.lifecycles.map((lifecycle) => lifecycle.stop()));
    await database.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

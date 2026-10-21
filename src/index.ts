import type { Server } from 'node:http';
import { createApp } from './app';
import { loadConfig } from './config/config';
import { connectDatabase } from './database/client';
import { ensureIndexes } from './database/indexes';
import { MongooseTaskRepository } from './modules/tasks';
import { createLogger } from './observability/logger';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  const database = await connectDatabase(config.mongo);
  await ensureIndexes(database);
  logger.info('taskhub started', { roles: config.roles, db: config.mongo.dbName });

  let server: Server | undefined;
  if (config.roles.includes('api')) {
    const apiLogger = logger.child({ role: 'api' });
    const app = createApp({
      config,
      logger: apiLogger,
      taskRepository: new MongooseTaskRepository(database.tasks),
      isHealthy: async () => {
        const db = database.connection.db;
        if (db === undefined) return false;
        await db.command({ ping: 1 });
        return true;
      },
    });
    server = app.listen(config.port, () => apiLogger.info('api listening', { port: config.port }));
  }

  const shutdown = async (signal: string): Promise<void> => {
    logger.info('shutting down', { signal });
    if (server !== undefined) {
      const api = server;
      await new Promise<void>((resolve) => api.close(() => resolve()));
    }
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

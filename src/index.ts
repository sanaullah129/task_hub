import { loadConfig } from './config/config.js';
import { connectDatabase } from './db/client.js';
import { ensureIndexes } from './db/indexes.js';
import { createLogger } from './observability/logger.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  const database = await connectDatabase(config.mongo);
  await ensureIndexes(database);
  logger.info('taskhub started', { roles: config.roles, db: config.mongo.dbName });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info('shutting down', { signal });
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

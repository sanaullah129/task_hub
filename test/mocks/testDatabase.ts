import { randomUUID } from 'node:crypto';
import { connectDatabase, type Database } from '../../src/database/client';
import { ensureIndexes } from '../../src/database/indexes';
import { loadConfig } from '../../src/config/config';

export async function setupTestDatabase(): Promise<Database> {
  const dbName = `taskhub_it_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const config = loadConfig({ LOG_LEVEL: 'silent', MONGODB_DB: dbName, ...mongoUriEnv() });
  const database = await connectDatabase(config.mongo);
  await ensureIndexes(database);
  return database;
}

export async function teardownTestDatabase(database: Database): Promise<void> {
  await database.connection.dropDatabase();
  await database.close();
}

function mongoUriEnv(): Record<string, string> {
  const uri = process.env['MONGODB_URI'];
  return uri === undefined ? {} : { MONGODB_URI: uri };
}

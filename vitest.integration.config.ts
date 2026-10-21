import { defineConfig } from 'vitest/config';

// Needs a local MongoDB (MONGODB_URI, default mongodb://127.0.0.1:27017); each file uses its own throwaway database.
export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
    hookTimeout: 20_000,
    fileParallelism: false,
  },
});

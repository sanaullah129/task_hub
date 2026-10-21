import { defineConfig } from 'tsup';

// Bundling resolves extensionless imports, which plain tsc output would not for Node ESM.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  outDir: 'dist',
  sourcemap: true,
  clean: true,
});

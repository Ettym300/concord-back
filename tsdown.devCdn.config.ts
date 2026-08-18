import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/devCdnEntry.ts'],
  outDir: 'dist/dev-cdn',
  sourcemap: true,
  clean: true,
  format: ['esm'],
});

import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@ocg/config': fileURLToPath(new URL('./packages/config/src/index.ts', import.meta.url)),
      '@ocg/protocol': fileURLToPath(new URL('./packages/protocol/src/index.ts', import.meta.url)),
      '@ocg/diff': fileURLToPath(new URL('./packages/diff/src/index.ts', import.meta.url)),
      '@ocg/host': fileURLToPath(new URL('./packages/host/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    environment: 'node',
  },
});

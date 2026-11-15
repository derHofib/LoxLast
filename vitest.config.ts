import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*'],
    coverage: {
      provider: 'v8',
      include: ['packages/core/src/**', 'packages/loxone-export/src/**'],
      exclude: ['**/*.test.ts', '**/__tests__/**', '**/index.ts'],
      // Kap. 13: core und loxone-export ≥ 90 %
      thresholds: { lines: 90, functions: 90, branches: 90, statements: 90 },
    },
  },
});

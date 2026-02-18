import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Support running vitest from repo root and from individual package directories.
    include: ['packages/*/test/**/*.test.ts', 'test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['packages/*/src/**/*.ts', 'src/**/*.ts'],
      exclude: [
        'packages/cli/src/index.ts',
        'packages/cli/src/mcp.ts',
        'packages/*/src/index.ts',
        'packages/core/src/types.ts',
      ],
      thresholds: {
        statements: 95,
        branches: 85,
        functions: 95,
        lines: 95,
      },
    },
  },
});

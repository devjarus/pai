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
        'packages/cli/src/init.ts',
        'packages/*/src/index.ts',
        'packages/core/src/types.ts',
        'packages/core/src/memory/index.ts',
        'packages/server/src/index.ts',
        'packages/ui/**',
        // I/O-heavy files: HTTP fetching, HTML scraping, bot lifecycle — tested via integration, not unit tests
        'packages/plugin-assistant/src/page-fetch.ts',
        'packages/plugin-assistant/src/web-search.ts',
        'packages/plugin-assistant/src/tools.ts',
        'packages/plugin-telegram/src/bot.ts',
        'packages/plugin-telegram/src/chat.ts',
        'packages/server/src/routes/knowledge.ts',
        'packages/server/src/routes/config.ts',
      ],
      thresholds: {
        statements: 80,
        branches: 70,
        functions: 80,
        lines: 80,
      },
    },
  },
});

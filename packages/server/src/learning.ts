import type { Migration } from "@personal-ai/core";

export const learningMigrations: Migration[] = [
  {
    version: 1,
    up: `CREATE TABLE IF NOT EXISTS learning_watermarks (
      source TEXT PRIMARY KEY,
      last_processed_at TEXT NOT NULL
    );`,
  },
];

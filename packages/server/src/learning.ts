import type { Migration, Storage } from "@personal-ai/core";

export const learningMigrations: Migration[] = [
  {
    version: 1,
    up: `CREATE TABLE IF NOT EXISTS learning_watermarks (
      source TEXT PRIMARY KEY,
      last_processed_at TEXT NOT NULL
    );`,
  },
];

export function getWatermark(storage: Storage, source: string): string {
  const rows = storage.query<{ last_processed_at: string }>(
    "SELECT last_processed_at FROM learning_watermarks WHERE source = ?",
    [source],
  );
  if (rows[0]) return rows[0].last_processed_at;
  // First run: default to 24 hours ago
  const defaultTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  storage.run(
    "INSERT INTO learning_watermarks (source, last_processed_at) VALUES (?, ?)",
    [source, defaultTime],
  );
  return defaultTime;
}

export function updateWatermark(storage: Storage, source: string, timestamp: string): void {
  storage.run(
    "INSERT OR REPLACE INTO learning_watermarks (source, last_processed_at) VALUES (?, ?)",
    [source, timestamp],
  );
}

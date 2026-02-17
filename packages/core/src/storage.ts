import Database from "better-sqlite3";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import type { Storage, Migration, Logger } from "./types.js";
import { createLogger } from "./logger.js";

export function createStorage(dataDir: string, logger?: Logger): Storage {
  const log = logger ?? createLogger();
  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, "personal-ai.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Migration tracking table
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      plugin TEXT NOT NULL,
      version INTEGER NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (plugin, version)
    )
  `);

  return {
    db,

    migrate(pluginName: string, migrations: Migration[]): void {
      const applied = db
        .prepare("SELECT version FROM _migrations WHERE plugin = ?")
        .all(pluginName) as Array<{ version: number }>;
      const appliedVersions = new Set(applied.map((r) => r.version));

      for (const m of migrations) {
        if (appliedVersions.has(m.version)) continue;
        log.info("Applying migration", { plugin: pluginName, version: m.version });
        db.exec(m.up);
        db.prepare("INSERT INTO _migrations (plugin, version) VALUES (?, ?)").run(
          pluginName,
          m.version,
        );
      }
    },

    query<T>(sql: string, params: unknown[] = []): T[] {
      return db.prepare(sql).all(...params) as T[];
    },

    run(sql: string, params: unknown[] = []) {
      return db.prepare(sql).run(...params);
    },

    close(): void {
      db.close();
    },
  };
}

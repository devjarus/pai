import Database from "better-sqlite3";
import { join, dirname, basename } from "node:path";
import { copyFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import type { Storage, Migration, Logger } from "./types.js";
import { createLogger } from "./logger.js";

/**
 * Create a backup of the database file.
 * Checkpoints WAL to ensure the backup is self-contained.
 * Returns the path to the backup file.
 */
export function backupDatabase(storage: Storage): string {
  const dbPath = storage.dbPath;
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${dbPath}-backup-${timestamp}.db`;
  // Checkpoint WAL so the main db file has all data
  storage.db.pragma("wal_checkpoint(TRUNCATE)");
  copyFileSync(dbPath, backupPath);
  cleanupOldBackups(dbPath);
  return backupPath;
}

function cleanupOldBackups(dbPath: string): void {
  try {
    const dir = dirname(dbPath);
    const prefix = basename(dbPath) + "-backup-";
    const files = readdirSync(dir)
      .filter((f) => f.startsWith(prefix) && f.endsWith(".db"))
      .map((f) => {
        const fullPath = join(dir, f);
        const mtime = statSync(fullPath).mtimeMs;
        return { path: fullPath, mtime };
      })
      .sort((a, b) => a.mtime - b.mtime);

    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const maxBackups = 5;

    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      const isOverLimit = files.length - i > maxBackups;
      const isOld = file.mtime < sevenDaysAgo;
      if (isOverLimit || isOld) {
        unlinkSync(file.path);
      }
    }
  } catch {
    // best-effort cleanup
  }
}

/**
 * Resolve a full ID from a prefix. Tries exact match first, then LIKE prefix.
 * Throws if no match or ambiguous (2+ matches).
 *
 * @param storage - Storage instance
 * @param table - Table name to search
 * @param idOrPrefix - Full ID or prefix (8+ chars)
 * @param where - Optional additional WHERE clause (e.g., "AND status = 'active'")
 * @param params - Optional params for the WHERE clause
 * @returns The resolved full ID
 */
export function resolveIdPrefix(
  storage: Storage,
  table: string,
  idOrPrefix: string,
  where = "",
  params: unknown[] = [],
): string {
  const exact = storage.query<{ id: string }>(
    `SELECT id FROM ${table} WHERE id = ? ${where} LIMIT 1`,
    [idOrPrefix, ...params],
  );
  if (exact[0]) return exact[0].id;

  const prefixMatches = storage.query<{ id: string }>(
    `SELECT id FROM ${table} WHERE id LIKE ? ${where} ORDER BY created_at DESC LIMIT 2`,
    [`${idOrPrefix}%`, ...params],
  );
  if (prefixMatches.length === 0) throw new Error(`No match found for "${idOrPrefix}" in ${table}.`);
  if (prefixMatches.length > 1) throw new Error(`ID prefix "${idOrPrefix}" is ambiguous. Provide more characters.`);
  return prefixMatches[0]!.id;
}

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
    dbPath,

    migrate(pluginName: string, migrations: Migration[]): void {
      const applied = db
        .prepare("SELECT version FROM _migrations WHERE plugin = ?")
        .all(pluginName) as Array<{ version: number }>;
      const appliedVersions = new Set(applied.map((r) => r.version));

      // Determine pending migrations
      const pending = migrations.filter((m) => !appliedVersions.has(m.version));
      if (pending.length === 0) return;

      // Backup before running any migrations
      const backupPath = backupDatabase({ dbPath, db } as Storage);
      log.info("Database backed up before migration", { backupPath });

      for (const m of pending) {
        log.info("Applying migration", { plugin: pluginName, version: m.version });
        try {
          db.exec("BEGIN");
          db.exec(m.up);
          db.prepare("INSERT INTO _migrations (plugin, version) VALUES (?, ?)").run(
            pluginName,
            m.version,
          );
          db.exec("COMMIT");
        } catch (err) {
          db.exec("ROLLBACK");
          throw err;
        }
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

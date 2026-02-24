import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createStorage, backupDatabase } from "../src/storage.js";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import type { Migration } from "../src/types.js";

describe("Storage", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pai-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("should create database file", () => {
    const storage = createStorage(dir);
    expect(storage.db.open).toBe(true);
    storage.close();
  });

  it("should expose dbPath", () => {
    const storage = createStorage(dir);
    expect(storage.dbPath).toBe(join(dir, "personal-ai.db"));
    storage.close();
  });

  it("should run migrations", () => {
    const storage = createStorage(dir);
    const migrations: Migration[] = [
      { version: 1, up: "CREATE TABLE test (id TEXT PRIMARY KEY, value TEXT)" },
    ];
    storage.migrate("test-plugin", migrations);
    storage.run("INSERT INTO test (id, value) VALUES (?, ?)", ["1", "hello"]);
    const rows = storage.query<{ id: string; value: string }>("SELECT * FROM test");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.value).toBe("hello");
    storage.close();
  });

  it("should skip already-applied migrations", () => {
    const storage = createStorage(dir);
    const migrations: Migration[] = [
      { version: 1, up: "CREATE TABLE test2 (id TEXT PRIMARY KEY)" },
    ];
    storage.migrate("test-plugin", migrations);
    // Running again should not throw
    storage.migrate("test-plugin", migrations);
    storage.close();
  });

  describe("Automatic backup before migrations", () => {
    it("should create a backup file before running pending migrations", () => {
      const storage = createStorage(dir);
      const migrations: Migration[] = [
        { version: 1, up: "CREATE TABLE backup_test (id TEXT PRIMARY KEY)" },
      ];

      storage.migrate("backup-plugin", migrations);

      const files = readdirSync(dir);
      const backupFiles = files.filter((f) => f.includes("-backup-"));
      expect(backupFiles).toHaveLength(1);
      expect(backupFiles[0]).toMatch(/^personal-ai\.db-backup-.*\.db$/);

      // Verify the backup is a valid SQLite database
      const backupPath = join(dir, backupFiles[0]!);
      const backupDb = new Database(backupPath);
      expect(backupDb.open).toBe(true);
      backupDb.close();

      storage.close();
    });

    it("should NOT create a backup when there are no pending migrations", () => {
      const storage = createStorage(dir);
      const migrations: Migration[] = [
        { version: 1, up: "CREATE TABLE no_backup_test (id TEXT PRIMARY KEY)" },
      ];

      // First run creates backup
      storage.migrate("no-backup-plugin", migrations);
      const filesAfterFirst = readdirSync(dir);
      const backupsAfterFirst = filesAfterFirst.filter((f) => f.includes("-backup-"));
      expect(backupsAfterFirst).toHaveLength(1);

      // Second run with same migrations should NOT create another backup
      storage.migrate("no-backup-plugin", migrations);
      const filesAfterSecond = readdirSync(dir);
      const backupsAfterSecond = filesAfterSecond.filter((f) => f.includes("-backup-"));
      expect(backupsAfterSecond).toHaveLength(1); // still just 1

      storage.close();
    });
  });

  describe("Transaction-wrapped migrations", () => {
    it("should roll back a failed migration without affecting the database", () => {
      const storage = createStorage(dir);
      const migrations: Migration[] = [
        { version: 1, up: "CREATE TABLE txn_test (id TEXT PRIMARY KEY)" },
        { version: 2, up: "INVALID SQL THAT WILL FAIL" },
      ];

      expect(() => storage.migrate("txn-plugin", migrations)).toThrow();

      // Version 1 should have been applied (committed before version 2 failed)
      const applied = storage.query<{ version: number }>(
        "SELECT version FROM _migrations WHERE plugin = ?",
        ["txn-plugin"],
      );
      expect(applied).toHaveLength(1);
      expect(applied[0]!.version).toBe(1);

      // The table from migration 1 should exist
      const rows = storage.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='txn_test'",
      );
      expect(rows).toHaveLength(1);

      storage.close();
    });

    it("should not record a failed migration in _migrations", () => {
      const storage = createStorage(dir);
      const migrations: Migration[] = [
        { version: 1, up: "THIS IS BAD SQL" },
      ];

      expect(() => storage.migrate("fail-plugin", migrations)).toThrow();

      const applied = storage.query<{ version: number }>(
        "SELECT version FROM _migrations WHERE plugin = ?",
        ["fail-plugin"],
      );
      expect(applied).toHaveLength(0);

      storage.close();
    });
  });

  describe("backupDatabase()", () => {
    it("should create a valid backup copy of the database", () => {
      const storage = createStorage(dir);

      // Insert some data first
      storage.migrate("backup-test", [
        { version: 1, up: "CREATE TABLE stuff (id TEXT PRIMARY KEY, val TEXT)" },
      ]);
      storage.run("INSERT INTO stuff (id, val) VALUES (?, ?)", ["a", "hello"]);

      // Clear backup files from migrate
      const existingBackups = readdirSync(dir).filter((f) => f.includes("-backup-"));
      for (const b of existingBackups) {
        rmSync(join(dir, b));
      }

      const backupPath = backupDatabase(storage);

      expect(existsSync(backupPath)).toBe(true);
      expect(backupPath).toMatch(/-backup-.*\.db$/);

      // Verify backup contains the data
      const backupDb = new Database(backupPath);
      const rows = backupDb.prepare("SELECT * FROM stuff").all() as Array<{ id: string; val: string }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.val).toBe("hello");
      backupDb.close();

      storage.close();
    });
  });
});

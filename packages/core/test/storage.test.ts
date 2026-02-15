import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createStorage } from "../src/storage.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
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
});

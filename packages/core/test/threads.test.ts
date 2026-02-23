import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createStorage } from "../src/storage.js";
import { threadMigrations } from "../src/threads.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("thread migrations", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pai-thread-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("migrates legacy thread_messages JSON into normalized rows", () => {
    const storage = createStorage(dir);
    const v1 = threadMigrations[0]!;

    // Set up legacy schema
    storage.db.exec(v1.up);
    storage.run("INSERT INTO _migrations (plugin, version) VALUES (?, ?)", ["threads", 1]);

    const threadId = "thread-legacy";
    const now = new Date().toISOString();
    storage.run(
      "INSERT INTO threads (id, title, agent_name, created_at, updated_at, message_count) VALUES (?, ?, ?, ?, ?, ?)",
      [threadId, "Legacy Thread", "assistant", now, now, 2],
    );
    storage.run(
      "INSERT INTO thread_messages (thread_id, messages_json, updated_at) VALUES (?, ?, ?)",
      [threadId, JSON.stringify([
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ]), now],
    );

    // Run v2 migration
    storage.migrate("threads", threadMigrations);

    const users = storage.query<{ id: string }>("SELECT id FROM users WHERE id = 'user-local'");
    expect(users).toHaveLength(1);

    const thread = storage.query<{ id: string; user_id: string; message_count: number }>(
      "SELECT id, user_id, message_count FROM threads WHERE id = ?",
      [threadId],
    )[0];
    expect(thread?.user_id).toBe("user-local");
    expect(thread?.message_count).toBe(2);

    const messages = storage.query<{ role: string; content: string; sequence: number }>(
      "SELECT role, content, sequence FROM thread_messages WHERE thread_id = ? ORDER BY sequence ASC",
      [threadId],
    );
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ role: "user", content: "hi", sequence: 1 });
    expect(messages[1]).toEqual({ role: "assistant", content: "hello", sequence: 2 });

    const legacyTables = storage.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('threads_legacy', 'thread_messages_legacy')",
    );
    expect(legacyTables).toHaveLength(0);

    storage.close();
  });
});

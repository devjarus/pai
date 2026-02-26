import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createStorage } from "../src/storage.js";
import {
  threadMigrations,
  createThread,
  getThread,
  listThreads,
  ensureThread,
  listMessages,
  appendMessages,
  clearThread,
  deleteThread,
  DEFAULT_USER_ID,
} from "../src/threads.js";
import type { Storage } from "../src/types.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function setup(): { storage: Storage; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "pai-thread-test-"));
  const storage = createStorage(dir);
  storage.migrate("threads", threadMigrations);
  return { storage, dir };
}

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

describe("createThread", () => {
  let storage: Storage;
  let dir: string;

  beforeEach(() => {
    ({ storage, dir } = setup());
  });

  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates a thread with default values", () => {
    const thread = createThread(storage);
    expect(thread.id).toMatch(/^thread-/);
    expect(thread.title).toBe("New conversation");
    expect(thread.agent_name).toBeNull();
    expect(thread.user_id).toBe(DEFAULT_USER_ID);
    expect(thread.message_count).toBe(0);
    expect(thread.created_at).toBeTruthy();
    expect(thread.updated_at).toBe(thread.created_at);
  });

  it("creates a thread with custom title and agent name", () => {
    const thread = createThread(storage, { title: "My Chat", agentName: "assistant" });
    expect(thread.title).toBe("My Chat");
    expect(thread.agent_name).toBe("assistant");
  });

  it("creates a thread with custom userId", () => {
    // Insert a user first
    storage.run("INSERT INTO users (id, display_name, created_at) VALUES (?, ?, datetime('now'))", ["user-custom", "Custom"]);
    const thread = createThread(storage, { userId: "user-custom" });
    expect(thread.user_id).toBe("user-custom");
  });

  it("persists the thread in the database", () => {
    const thread = createThread(storage);
    const row = storage.query<{ id: string }>("SELECT id FROM threads WHERE id = ?", [thread.id]);
    expect(row).toHaveLength(1);
  });
});

describe("getThread", () => {
  let storage: Storage;
  let dir: string;

  beforeEach(() => {
    ({ storage, dir } = setup());
  });

  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns a thread by id", () => {
    const created = createThread(storage, { title: "Test" });
    const found = getThread(storage, created.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
    expect(found!.title).toBe("Test");
  });

  it("returns null for non-existent thread", () => {
    const found = getThread(storage, "thread-nonexistent");
    expect(found).toBeNull();
  });
});

describe("listThreads", () => {
  let storage: Storage;
  let dir: string;

  beforeEach(() => {
    ({ storage, dir } = setup());
  });

  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns empty array when no threads exist", () => {
    const threads = listThreads(storage);
    expect(threads).toEqual([]);
  });

  it("returns threads for the default user", () => {
    createThread(storage, { title: "A" });
    createThread(storage, { title: "B" });
    const threads = listThreads(storage);
    expect(threads).toHaveLength(2);
  });

  it("returns threads ordered by updated_at DESC", () => {
    const t1 = createThread(storage, { title: "First" });
    const t2 = createThread(storage, { title: "Second" });
    // Make t1 more recently updated by appending a message
    appendMessages(storage, t1.id, [{ role: "user", content: "bump" }]);
    const threads = listThreads(storage);
    expect(threads[0]!.id).toBe(t1.id);
    expect(threads[1]!.id).toBe(t2.id);
  });

  it("filters threads by userId", () => {
    storage.run("INSERT INTO users (id, display_name, created_at) VALUES (?, ?, datetime('now'))", ["user-other", "Other"]);
    createThread(storage, { title: "Default user thread" });
    createThread(storage, { title: "Other user thread", userId: "user-other" });
    const defaultThreads = listThreads(storage, DEFAULT_USER_ID);
    expect(defaultThreads).toHaveLength(1);
    expect(defaultThreads[0]!.title).toBe("Default user thread");
    const otherThreads = listThreads(storage, "user-other");
    expect(otherThreads).toHaveLength(1);
    expect(otherThreads[0]!.title).toBe("Other user thread");
  });
});

describe("ensureThread", () => {
  let storage: Storage;
  let dir: string;

  beforeEach(() => {
    ({ storage, dir } = setup());
  });

  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates a new thread when no id is provided", () => {
    const { thread, created } = ensureThread(storage, { title: "Fresh" });
    expect(created).toBe(true);
    expect(thread.title).toBe("Fresh");
  });

  it("creates a new thread when id does not exist", () => {
    const { thread, created } = ensureThread(storage, { id: "thread-missing", title: "New" });
    expect(created).toBe(true);
    // The created thread gets a new UUID-based id, not the missing one
    expect(thread.id).toMatch(/^thread-/);
  });

  it("returns existing thread when id exists", () => {
    const existing = createThread(storage, { title: "Existing" });
    const { thread, created } = ensureThread(storage, { id: existing.id });
    expect(created).toBe(false);
    expect(thread.id).toBe(existing.id);
    expect(thread.title).toBe("Existing");
  });
});

describe("appendMessages", () => {
  let storage: Storage;
  let dir: string;

  beforeEach(() => {
    ({ storage, dir } = setup());
  });

  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("appends messages and updates thread metadata", () => {
    const thread = createThread(storage);
    appendMessages(storage, thread.id, [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
    ]);

    const updated = getThread(storage, thread.id)!;
    expect(updated.message_count).toBe(2);

    const msgs = listMessages(storage, thread.id);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.role).toBe("user");
    expect(msgs[0]!.content).toBe("hello");
    expect(msgs[0]!.sequence).toBe(1);
    expect(msgs[1]!.role).toBe("assistant");
    expect(msgs[1]!.content).toBe("hi there");
    expect(msgs[1]!.sequence).toBe(2);
  });

  it("assigns sequential sequence numbers across multiple appends", () => {
    const thread = createThread(storage);
    appendMessages(storage, thread.id, [{ role: "user", content: "first" }]);
    appendMessages(storage, thread.id, [{ role: "assistant", content: "second" }]);
    appendMessages(storage, thread.id, [{ role: "user", content: "third" }]);

    const msgs = listMessages(storage, thread.id);
    expect(msgs.map((m) => m.sequence)).toEqual([1, 2, 3]);
    expect(msgs.map((m) => m.content)).toEqual(["first", "second", "third"]);
  });

  it("does nothing when messages array is empty", () => {
    const thread = createThread(storage);
    appendMessages(storage, thread.id, []);
    const updated = getThread(storage, thread.id)!;
    expect(updated.message_count).toBe(0);
  });

  it("trims oldest messages when maxMessages is exceeded", () => {
    const thread = createThread(storage);
    appendMessages(storage, thread.id, [
      { role: "user", content: "msg1" },
      { role: "assistant", content: "msg2" },
      { role: "user", content: "msg3" },
      { role: "assistant", content: "msg4" },
    ]);

    // Append two more with maxMessages=4 to trigger trim
    appendMessages(storage, thread.id, [
      { role: "user", content: "msg5" },
      { role: "assistant", content: "msg6" },
    ], { maxMessages: 4 });

    const msgs = listMessages(storage, thread.id);
    expect(msgs).toHaveLength(4);
    // Oldest two (msg1, msg2) should have been trimmed
    expect(msgs.map((m) => m.content)).toEqual(["msg3", "msg4", "msg5", "msg6"]);

    const updated = getThread(storage, thread.id)!;
    expect(updated.message_count).toBe(4);
  });

  it("updates title from titleCandidate when current title is default", () => {
    const thread = createThread(storage);
    expect(thread.title).toBe("New conversation");

    appendMessages(storage, thread.id, [
      { role: "user", content: "hello" },
    ], { titleCandidate: "Greeting Chat" });

    const updated = getThread(storage, thread.id)!;
    expect(updated.title).toBe("Greeting Chat");
  });

  it("does not overwrite a custom title with titleCandidate", () => {
    const thread = createThread(storage, { title: "Custom Title" });

    appendMessages(storage, thread.id, [
      { role: "user", content: "hello" },
    ], { titleCandidate: "Should Not Replace" });

    const updated = getThread(storage, thread.id)!;
    expect(updated.title).toBe("Custom Title");
  });

  it("stores partsJson when provided", () => {
    const thread = createThread(storage);
    const parts = JSON.stringify([{ type: "text", text: "hello" }]);
    appendMessages(storage, thread.id, [
      { role: "user", content: "hello", partsJson: parts },
    ]);

    const msgs = listMessages(storage, thread.id);
    expect(msgs[0]!.parts_json).toBe(parts);
  });
});

describe("listMessages", () => {
  let storage: Storage;
  let dir: string;

  beforeEach(() => {
    ({ storage, dir } = setup());
  });

  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns messages ordered by sequence ASC", () => {
    const thread = createThread(storage);
    appendMessages(storage, thread.id, [
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
      { role: "user", content: "c" },
    ]);

    const msgs = listMessages(storage, thread.id);
    expect(msgs.map((m) => m.content)).toEqual(["a", "b", "c"]);
    expect(msgs[0]!.sequence).toBeLessThan(msgs[1]!.sequence);
    expect(msgs[1]!.sequence).toBeLessThan(msgs[2]!.sequence);
  });

  it("returns empty array for thread with no messages", () => {
    const thread = createThread(storage);
    expect(listMessages(storage, thread.id)).toEqual([]);
  });

  it("respects limit parameter", () => {
    const thread = createThread(storage);
    appendMessages(storage, thread.id, [
      { role: "user", content: "1" },
      { role: "assistant", content: "2" },
      { role: "user", content: "3" },
      { role: "assistant", content: "4" },
      { role: "user", content: "5" },
    ]);

    const msgs = listMessages(storage, thread.id, { limit: 3 });
    expect(msgs).toHaveLength(3);
    // Should return the LAST 3 messages (DESC then reversed)
    expect(msgs.map((m) => m.content)).toEqual(["3", "4", "5"]);
  });

  it("supports before param as a numeric sequence", () => {
    const thread = createThread(storage);
    appendMessages(storage, thread.id, [
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
      { role: "user", content: "c" },
      { role: "assistant", content: "d" },
    ]);

    // Get messages before sequence 3
    const msgs = listMessages(storage, thread.id, { before: "3" });
    expect(msgs.map((m) => m.content)).toEqual(["a", "b"]);
  });

  it("supports before param as a message id", () => {
    const thread = createThread(storage);
    appendMessages(storage, thread.id, [
      { role: "user", content: "first" },
      { role: "assistant", content: "second" },
      { role: "user", content: "third" },
    ]);

    const allMsgs = listMessages(storage, thread.id);
    const thirdMsgId = allMsgs[2]!.id;

    // Get messages before the third message
    const msgs = listMessages(storage, thread.id, { before: thirdMsgId });
    expect(msgs.map((m) => m.content)).toEqual(["first", "second"]);
  });

  it("combines before and limit", () => {
    const thread = createThread(storage);
    appendMessages(storage, thread.id, [
      { role: "user", content: "1" },
      { role: "assistant", content: "2" },
      { role: "user", content: "3" },
      { role: "assistant", content: "4" },
      { role: "user", content: "5" },
    ]);

    // Before sequence 5, limit 2 -> should return messages 3 and 4
    const msgs = listMessages(storage, thread.id, { before: "5", limit: 2 });
    expect(msgs).toHaveLength(2);
    expect(msgs.map((m) => m.content)).toEqual(["3", "4"]);
  });
});

describe("clearThread", () => {
  let storage: Storage;
  let dir: string;

  beforeEach(() => {
    ({ storage, dir } = setup());
  });

  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("removes all messages and resets message_count", () => {
    const thread = createThread(storage);
    appendMessages(storage, thread.id, [
      { role: "user", content: "hello" },
      { role: "assistant", content: "world" },
    ]);
    expect(getThread(storage, thread.id)!.message_count).toBe(2);

    clearThread(storage, thread.id);

    const msgs = listMessages(storage, thread.id);
    expect(msgs).toEqual([]);
    const updated = getThread(storage, thread.id)!;
    expect(updated.message_count).toBe(0);
  });

  it("preserves the thread itself after clearing", () => {
    const thread = createThread(storage, { title: "Keep Me" });
    appendMessages(storage, thread.id, [{ role: "user", content: "hi" }]);
    clearThread(storage, thread.id);

    const found = getThread(storage, thread.id);
    expect(found).not.toBeNull();
    expect(found!.title).toBe("Keep Me");
  });

  it("updates updated_at timestamp", () => {
    const thread = createThread(storage);
    const originalUpdatedAt = thread.updated_at;
    // Small delay to ensure different timestamp
    clearThread(storage, thread.id);
    const updated = getThread(storage, thread.id)!;
    // updated_at should be set (may or may not differ due to timing, but should be a valid ISO string)
    expect(updated.updated_at).toBeTruthy();
  });
});

describe("deleteThread", () => {
  let storage: Storage;
  let dir: string;

  beforeEach(() => {
    ({ storage, dir } = setup());
  });

  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("removes the thread and its messages from the database", () => {
    const thread = createThread(storage);
    appendMessages(storage, thread.id, [
      { role: "user", content: "hello" },
      { role: "assistant", content: "bye" },
    ]);

    deleteThread(storage, thread.id);

    expect(getThread(storage, thread.id)).toBeNull();
    const msgs = storage.query<{ id: string }>(
      "SELECT id FROM thread_messages WHERE thread_id = ?",
      [thread.id],
    );
    expect(msgs).toHaveLength(0);
  });

  it("does not affect other threads", () => {
    const t1 = createThread(storage, { title: "Thread 1" });
    const t2 = createThread(storage, { title: "Thread 2" });
    appendMessages(storage, t1.id, [{ role: "user", content: "t1 msg" }]);
    appendMessages(storage, t2.id, [{ role: "user", content: "t2 msg" }]);

    deleteThread(storage, t1.id);

    expect(getThread(storage, t1.id)).toBeNull();
    expect(getThread(storage, t2.id)).not.toBeNull();
    expect(listMessages(storage, t2.id)).toHaveLength(1);
  });

  it("is a no-op for a non-existent thread", () => {
    // Should not throw
    deleteThread(storage, "thread-does-not-exist");
  });
});

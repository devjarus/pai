import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStorage, threadMigrations } from "@personal-ai/core";
import type { Storage } from "@personal-ai/core";
import { learningMigrations, getWatermark, updateWatermark, gatherSignals } from "../src/learning.js";

describe("learning watermarks", () => {
  let dir: string;
  let storage: Storage;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pai-learning-test-"));
    storage = createStorage(dir);
    storage.migrate("learning", learningMigrations);
  });

  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns a default watermark ~24h ago on first read", () => {
    const wm = getWatermark(storage, "threads");
    const age = Date.now() - new Date(wm).getTime();
    expect(age).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(age).toBeLessThan(25 * 60 * 60 * 1000);
  });

  it("updates and reads back a watermark", () => {
    const now = new Date().toISOString();
    updateWatermark(storage, "threads", now);
    const wm = getWatermark(storage, "threads");
    expect(wm).toBe(now);
  });

  it("handles multiple sources independently", () => {
    const t1 = "2026-01-01T00:00:00.000Z";
    const t2 = "2026-02-01T00:00:00.000Z";
    updateWatermark(storage, "threads", t1);
    updateWatermark(storage, "research", t2);
    expect(getWatermark(storage, "threads")).toBe(t1);
    expect(getWatermark(storage, "research")).toBe(t2);
  });
});

describe("gatherSignals", () => {
  let dir: string;
  let storage: Storage;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pai-learning-signals-test-"));
    storage = createStorage(dir);
    storage.migrate("learning", learningMigrations);
    storage.migrate("threads", threadMigrations);
  });

  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns isEmpty: true when no data exists", () => {
    const signals = gatherSignals(storage);
    expect(signals.isEmpty).toBe(true);
    expect(signals.threads).toHaveLength(0);
    expect(signals.research).toHaveLength(0);
    expect(signals.tasks).toHaveLength(0);
    expect(signals.knowledge).toHaveLength(0);
  });

  it("gathers thread messages newer than watermark", () => {
    storage.run("INSERT INTO threads (id, title, created_at, updated_at, message_count) VALUES ('t1', 'Test', datetime('now'), datetime('now'), 1)");
    storage.run("INSERT INTO thread_messages (id, thread_id, role, content, created_at, sequence) VALUES ('m1', 't1', 'user', 'I prefer React over Vue', datetime('now'), 1)");
    const signals = gatherSignals(storage);
    expect(signals.threads).toHaveLength(1);
    expect(signals.threads[0].messages).toHaveLength(1);
    expect(signals.isEmpty).toBe(false);
  });

  it("limits to 3 threads", () => {
    for (let t = 0; t < 5; t++) {
      storage.run(`INSERT INTO threads (id, title, created_at, updated_at, message_count) VALUES ('t${t}', 'Thread ${t}', datetime('now'), datetime('now'), 1)`);
      storage.run(`INSERT INTO thread_messages (id, thread_id, role, content, created_at, sequence) VALUES ('m${t}', 't${t}', 'user', 'msg', datetime('now'), 1)`);
    }
    const signals = gatherSignals(storage);
    expect(signals.threads.length).toBeLessThanOrEqual(3);
  });

  it("only gathers user messages, not assistant messages", () => {
    storage.run("INSERT INTO threads (id, title, created_at, updated_at, message_count) VALUES ('t1', 'Test', datetime('now'), datetime('now'), 2)");
    storage.run("INSERT INTO thread_messages (id, thread_id, role, content, created_at, sequence) VALUES ('m1', 't1', 'user', 'user msg', datetime('now'), 1)");
    storage.run("INSERT INTO thread_messages (id, thread_id, role, content, created_at, sequence) VALUES ('m2', 't1', 'assistant', 'assistant msg', datetime('now'), 2)");
    const signals = gatherSignals(storage);
    expect(signals.threads[0].messages).toHaveLength(1);
    expect(signals.threads[0].messages[0].role).toBe("user");
  });
});

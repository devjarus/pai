import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStorage } from "@personal-ai/core";
import type { Storage } from "@personal-ai/core";
import { learningMigrations, getWatermark, updateWatermark } from "../src/learning.js";

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

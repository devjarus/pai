import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStorage } from "../src/storage.js";
import type { Storage } from "../src/types.js";
import {
  backgroundJobMigrations,
  upsertJob,
  getJob,
  listJobs,
  updateJobStatus,
  clearCompletedBackgroundJobs,
} from "../src/background-jobs.js";
import type { BackgroundJob } from "../src/background-jobs.js";

describe("background-jobs", () => {
  let dir: string;
  let storage: Storage;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pai-bg-jobs-test-"));
    storage = createStorage(dir);
    storage.migrate("background_jobs", backgroundJobMigrations);
  });

  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const makeJob = (overrides?: Partial<BackgroundJob>): BackgroundJob => ({
    id: "job-1",
    type: "crawl",
    label: "https://example.com",
    status: "running",
    progress: "0/5",
    startedAt: new Date().toISOString(),
    ...overrides,
  });

  describe("upsertJob", () => {
    it("creates a new job", () => {
      const job = makeJob();
      upsertJob(storage, job);
      const stored = getJob(storage, "job-1");
      expect(stored).not.toBeNull();
      expect(stored!.id).toBe("job-1");
      expect(stored!.type).toBe("crawl");
      expect(stored!.label).toBe("https://example.com");
      expect(stored!.status).toBe("running");
    });

    it("updates an existing job on conflict", () => {
      upsertJob(storage, makeJob());
      upsertJob(storage, makeJob({ status: "done", result: "completed" }));
      const stored = getJob(storage, "job-1");
      expect(stored!.status).toBe("done");
      expect(stored!.result).toBe("completed");
    });
  });

  describe("getJob", () => {
    it("returns null for missing job", () => {
      expect(getJob(storage, "nonexistent")).toBeNull();
    });

    it("returns job with optional error field", () => {
      upsertJob(storage, makeJob({ status: "error", error: "LLM timeout" }));
      const stored = getJob(storage, "job-1");
      expect(stored!.error).toBe("LLM timeout");
    });
  });

  describe("listJobs", () => {
    it("returns all jobs sorted by started_at DESC", () => {
      upsertJob(storage, makeJob({ id: "old", startedAt: "2026-01-01T00:00:00Z" }));
      upsertJob(storage, makeJob({ id: "new", startedAt: "2026-02-01T00:00:00Z" }));
      const jobs = listJobs(storage);
      expect(jobs).toHaveLength(2);
      expect(jobs[0]!.id).toBe("new");
      expect(jobs[1]!.id).toBe("old");
    });

    it("returns empty array when no jobs", () => {
      expect(listJobs(storage)).toEqual([]);
    });
  });

  describe("updateJobStatus", () => {
    it("updates specific fields", () => {
      upsertJob(storage, makeJob());
      updateJobStatus(storage, "job-1", { progress: "3/5", status: "running" });
      const stored = getJob(storage, "job-1");
      expect(stored!.progress).toBe("3/5");
    });

    it("updates error and result", () => {
      upsertJob(storage, makeJob());
      updateJobStatus(storage, "job-1", { status: "done", result: "Learned: 5" });
      const stored = getJob(storage, "job-1");
      expect(stored!.status).toBe("done");
      expect(stored!.result).toBe("Learned: 5");
    });
  });

  describe("clearCompletedBackgroundJobs", () => {
    it("removes done and error jobs", () => {
      upsertJob(storage, makeJob({ id: "done1", status: "done" }));
      upsertJob(storage, makeJob({ id: "err1", status: "error" }));
      upsertJob(storage, makeJob({ id: "run1", status: "running" }));

      const cleared = clearCompletedBackgroundJobs(storage);
      expect(cleared).toBe(2);

      expect(getJob(storage, "run1")).not.toBeNull();
      expect(getJob(storage, "done1")).toBeNull();
      expect(getJob(storage, "err1")).toBeNull();
    });

    it("respects age cutoff", () => {
      const oldDate = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hour ago
      const recentDate = new Date().toISOString();

      upsertJob(storage, makeJob({ id: "old-done", status: "done", startedAt: oldDate }));
      upsertJob(storage, makeJob({ id: "recent-done", status: "done", startedAt: recentDate }));

      const cleared = clearCompletedBackgroundJobs(storage, 30 * 60 * 1000); // 30 min cutoff
      expect(cleared).toBe(1); // only old-done removed
      expect(getJob(storage, "old-done")).toBeNull();
      expect(getJob(storage, "recent-done")).not.toBeNull();
    });

    it("leaves running jobs untouched", () => {
      upsertJob(storage, makeJob({ id: "running", status: "running" }));
      const cleared = clearCompletedBackgroundJobs(storage);
      expect(cleared).toBe(0);
      expect(getJob(storage, "running")).not.toBeNull();
    });
  });
});

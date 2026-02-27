import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStorage } from "../src/storage.js";
import type { Storage } from "../src/types.js";
import { backgroundJobMigrations, upsertJob, getJob, listJobs } from "../src/background-jobs.js";
import type { BackgroundJob } from "../src/background-jobs.js";

describe("background jobs (DB-backed)", () => {
  let dir: string;
  let storage: Storage;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pai-jobs-test-"));
    storage = createStorage(dir);
    storage.migrate("background_jobs", backgroundJobMigrations);
  });

  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("stores and retrieves a job", () => {
    const job: BackgroundJob = {
      id: "test-1",
      type: "crawl",
      label: "https://example.com",
      status: "running",
      progress: "0/5",
      startedAt: new Date().toISOString(),
    };
    upsertJob(storage, job);
    const stored = getJob(storage, "test-1");
    expect(stored).not.toBeNull();
    expect(stored!.id).toBe("test-1");
    expect(stored!.type).toBe("crawl");
    expect(stored!.status).toBe("running");
  });

  it("supports research type", () => {
    const job: BackgroundJob = {
      id: "res-1",
      type: "research",
      label: "Best TypeScript frameworks",
      status: "done",
      progress: "3/5 searches",
      startedAt: new Date().toISOString(),
      result: "# Report\n\nFindings here.",
    };
    upsertJob(storage, job);
    const stored = getJob(storage, "res-1");
    expect(stored!.type).toBe("research");
    expect(stored!.result).toContain("Findings");
  });

  it("lists all jobs", () => {
    upsertJob(storage, {
      id: "j1", type: "crawl", label: "a", status: "running",
      progress: "", startedAt: "2026-01-01T00:00:00Z",
    });
    upsertJob(storage, {
      id: "j2", type: "research", label: "b", status: "done",
      progress: "", startedAt: "2026-02-01T00:00:00Z",
    });
    const jobs = listJobs(storage);
    expect(jobs).toHaveLength(2);
  });
});

import { describe, it, expect } from "vitest";
import { activeJobs } from "../src/index.js";
import type { BackgroundJob } from "../src/index.js";

describe("activeJobs", () => {
  it("is a Map that tracks background jobs", () => {
    expect(activeJobs).toBeInstanceOf(Map);
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
    activeJobs.set(job.id, job);
    expect(activeJobs.get("test-1")).toEqual(job);
    activeJobs.delete("test-1"); // cleanup
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
    activeJobs.set(job.id, job);
    expect(activeJobs.get("res-1")!.type).toBe("research");
    expect(activeJobs.get("res-1")!.result).toContain("Findings");
    activeJobs.delete("res-1");
  });
});

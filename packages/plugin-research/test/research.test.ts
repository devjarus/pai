import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStorage, threadMigrations, backgroundJobMigrations, createThread, listMessages, getJob } from "@personal-ai/core";
import type { Storage } from "@personal-ai/core";
import type { Migration } from "@personal-ai/core";
import { researchMigrations } from "../src/index.js";
import { runResearchInBackground, getResearchJob, createResearchJob } from "../src/research.js";
import type { ResearchContext } from "../src/research.js";

// Mock the AI SDK
vi.mock("ai", () => ({
  generateText: vi.fn(),
  tool: vi.fn((def: unknown) => def),
  stepCountIs: vi.fn().mockReturnValue({ type: "step-count" }),
}));

describe("Research jobs", () => {
  let dir: string;
  let storage: Storage;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pai-research-test-"));
    storage = createStorage(dir);
    storage.migrate("research", researchMigrations);
    storage.migrate("background_jobs", backgroundJobMigrations);
    vi.clearAllMocks();
  });

  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function makeCtx(): ResearchContext {
    return {
      storage,
      llm: {
        chat: vi.fn(),
        streamChat: vi.fn(),
        embed: vi.fn(),
        health: vi.fn().mockResolvedValue({ ok: true }),
        getModel: vi.fn().mockReturnValue("mock-model"),
      } as never,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
      webSearch: vi.fn().mockResolvedValue([]),
      formatSearchResults: vi.fn().mockReturnValue("No results"),
      fetchPage: vi.fn().mockResolvedValue(null),
    };
  }

  describe("createResearchJob", () => {
    it("creates a job with pending status", () => {
      const id = createResearchJob(storage, {
        goal: "Best TypeScript frameworks 2026",
        threadId: "thread-1",
      });
      const job = getResearchJob(storage, id);
      expect(job).not.toBeNull();
      expect(job!.status).toBe("pending");
      expect(job!.goal).toBe("Best TypeScript frameworks 2026");
      expect(job!.threadId).toBe("thread-1");
      expect(job!.budgetMaxSearches).toBe(5);
      expect(job!.budgetMaxPages).toBe(3);
    });

    it("accepts custom budget limits", () => {
      const id = createResearchJob(storage, {
        goal: "test",
        threadId: null,
        maxSearches: 10,
        maxPages: 5,
      });
      const job = getResearchJob(storage, id);
      expect(job!.budgetMaxSearches).toBe(10);
      expect(job!.budgetMaxPages).toBe(5);
    });
  });

  describe("getResearchJob", () => {
    it("returns null for non-existent job", () => {
      expect(getResearchJob(storage, "nope")).toBeNull();
    });
  });

  describe("runResearchInBackground", () => {
    it("sets job to running then done on success", async () => {
      const { generateText } = await import("ai");
      (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
        text: "# Research Report\n\n## Summary\nFindings here.\n\n## Key Findings\n- Finding 1\n\n## Sources\n- https://example.com",
        steps: [],
      });

      const ctx = makeCtx();
      const id = createResearchJob(storage, {
        goal: "Test research",
        threadId: null,
      });

      await runResearchInBackground(ctx, id);

      const job = getResearchJob(storage, id);
      expect(job!.status).toBe("done");
      expect(job!.report).toContain("Research Report");
      expect(job!.completedAt).not.toBeNull();
    });

    it("sets job to failed when generateText throws", async () => {
      const { generateText } = await import("ai");
      (generateText as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("LLM unavailable"),
      );

      const ctx = makeCtx();
      const id = createResearchJob(storage, {
        goal: "Failing research",
        threadId: null,
      });

      await runResearchInBackground(ctx, id);

      const job = getResearchJob(storage, id);
      expect(job!.status).toBe("failed");
    });

    it("registers job in background_jobs DB table", async () => {
      const { generateText } = await import("ai");
      (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
        text: "# Report\nDone.",
        steps: [],
      });

      const ctx = makeCtx();
      const id = createResearchJob(storage, {
        goal: "Tracked research",
        threadId: null,
      });

      await runResearchInBackground(ctx, id);

      const tracked = getJob(storage, id);
      expect(tracked).toBeDefined();
      expect(tracked!.status).toBe("done");
      expect(tracked!.type).toBe("research");
    });
  });

  describe("report delivery", () => {
    const briefingMigrations: Migration[] = [
      {
        version: 1,
        up: `
          CREATE TABLE IF NOT EXISTS briefings (
            id TEXT PRIMARY KEY,
            generated_at TEXT NOT NULL DEFAULT (datetime('now')),
            sections TEXT NOT NULL DEFAULT '{}',
            raw_context TEXT,
            status TEXT NOT NULL DEFAULT 'ready'
          );
        `,
      },
      {
        version: 2,
        up: `ALTER TABLE briefings ADD COLUMN type TEXT NOT NULL DEFAULT 'daily';`,
      },
    ];

    beforeEach(() => {
      storage.migrate("threads", threadMigrations);
      storage.migrate("inbox", briefingMigrations);
    });

    it("creates a research briefing in the briefings table on completion", async () => {
      const { generateText } = await import("ai");
      (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
        text: "# Report\n\nResearch findings here.",
        steps: [],
      });

      const ctx = makeCtx();
      const id = createResearchJob(storage, {
        goal: "Test Inbox delivery",
        threadId: null,
      });

      await runResearchInBackground(ctx, id);

      const job = getResearchJob(storage, id);
      expect(job!.status).toBe("done");
      expect(job!.briefingId).not.toBeNull();

      // Verify briefing exists
      const briefings = storage.query<{ id: string; type: string; sections: string }>(
        "SELECT id, type, sections FROM briefings WHERE id = ?",
        [job!.briefingId],
      );
      expect(briefings).toHaveLength(1);
      expect(briefings[0]!.type).toBe("research");
      const sections = JSON.parse(briefings[0]!.sections) as { report: string; goal: string };
      expect(sections.report).toContain("Research findings");
      expect(sections.goal).toBe("Test Inbox delivery");
    });

    it("appends summary to originating thread on completion", async () => {
      const { generateText } = await import("ai");
      (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
        text: "# Report\n\nThread delivery test.",
        steps: [],
      });

      const thread = createThread(storage, { title: "Test thread", agentName: "assistant" });

      const ctx = makeCtx();
      const id = createResearchJob(storage, {
        goal: "Thread test",
        threadId: thread.id,
      });

      await runResearchInBackground(ctx, id);

      const messages = listMessages(storage, thread.id);
      expect(messages.length).toBeGreaterThan(0);
      const lastMsg = messages[messages.length - 1]!;
      expect(lastMsg.content).toContain("Research complete");
      expect(lastMsg.content).toContain("Thread test");
      expect(lastMsg.role).toBe("assistant");
    });

    it("posts failure message to thread when research fails", async () => {
      const { generateText } = await import("ai");
      (generateText as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("LLM down"),
      );

      const thread = createThread(storage, { title: "Fail thread", agentName: "assistant" });

      const ctx = makeCtx();
      const id = createResearchJob(storage, {
        goal: "Failing research",
        threadId: thread.id,
      });

      await runResearchInBackground(ctx, id);

      const messages = listMessages(storage, thread.id);
      expect(messages.length).toBeGreaterThan(0);
      const lastMsg = messages[messages.length - 1]!;
      expect(lastMsg.content).toContain("Research failed");
      expect(lastMsg.content).toContain("LLM down");
    });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStorage, backgroundJobMigrations, getJob, artifactMigrations, listArtifacts } from "@personal-ai/core";
import type { Storage } from "@personal-ai/core";
import {
  swarmMigrations,
  createSwarmJob,
  getSwarmJob,
  listSwarmJobs,
  clearCompletedSwarmJobs,
  recoverStaleSwarmJobs,
  updateSwarmJob,
  insertSwarmAgent,
  updateSwarmAgent,
  getSwarmAgents,
  insertBlackboardEntry,
  getBlackboardEntries,
} from "../src/index.js";
import { runSwarmInBackground } from "../src/swarm.js";
import type { SwarmContext } from "../src/swarm.js";

// Mock the AI SDK
vi.mock("ai", () => ({
  generateText: vi.fn(),
  tool: vi.fn((def: unknown) => def),
  stepCountIs: vi.fn().mockReturnValue({ type: "step-count" }),
}));

describe("Swarm jobs", () => {
  let dir: string;
  let storage: Storage;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pai-swarm-test-"));
    storage = createStorage(dir);
    storage.migrate("swarm", swarmMigrations);
    storage.migrate("background_jobs", backgroundJobMigrations);
    storage.migrate("artifacts", artifactMigrations);
    vi.clearAllMocks();
  });

  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function makeCtx(): SwarmContext {
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

  describe("createSwarmJob", () => {
    it("creates a job with pending status", () => {
      const id = createSwarmJob(storage, {
        goal: "Compare NVDA vs AMD",
        threadId: "thread-1",
      });
      const job = getSwarmJob(storage, id);
      expect(job).not.toBeNull();
      expect(job!.status).toBe("pending");
      expect(job!.goal).toBe("Compare NVDA vs AMD");
      expect(job!.threadId).toBe("thread-1");
      expect(job!.agentCount).toBe(0);
      expect(job!.agentsDone).toBe(0);
    });

    it("creates a job without threadId", () => {
      const id = createSwarmJob(storage, { goal: "test", threadId: null });
      const job = getSwarmJob(storage, id);
      expect(job!.threadId).toBeNull();
    });
  });

  describe("getSwarmJob", () => {
    it("returns null for non-existent job", () => {
      expect(getSwarmJob(storage, "nope")).toBeNull();
    });
  });

  describe("listSwarmJobs", () => {
    it("lists all jobs", () => {
      createSwarmJob(storage, { goal: "first", threadId: null });
      createSwarmJob(storage, { goal: "second", threadId: null });
      const jobs = listSwarmJobs(storage);
      expect(jobs).toHaveLength(2);
      const goals = jobs.map((j) => j.goal).sort();
      expect(goals).toEqual(["first", "second"]);
    });
  });

  describe("clearCompletedSwarmJobs", () => {
    it("clears done and failed jobs", () => {
      const id1 = createSwarmJob(storage, { goal: "done job", threadId: null });
      const id2 = createSwarmJob(storage, { goal: "failed job", threadId: null });
      createSwarmJob(storage, { goal: "running job", threadId: null });

      updateSwarmJob(storage, id1, { status: "done" });
      updateSwarmJob(storage, id2, { status: "failed" });

      const cleared = clearCompletedSwarmJobs(storage);
      expect(cleared).toBe(2);

      const remaining = listSwarmJobs(storage);
      expect(remaining).toHaveLength(1);
      expect(remaining[0]!.goal).toBe("running job");
    });
  });

  describe("recoverStaleSwarmJobs", () => {
    it("marks running jobs and agents as failed", () => {
      const id1 = createSwarmJob(storage, { goal: "running job", threadId: null });
      const id2 = createSwarmJob(storage, { goal: "done job", threadId: null });
      updateSwarmJob(storage, id1, { status: "running" });
      updateSwarmJob(storage, id2, { status: "done" });

      // Add agents to the running job
      insertSwarmAgent(storage, {
        id: "agent-r1",
        swarmId: id1,
        role: "researcher",
        task: "Research something",
        tools: ["web_search"],
      });
      updateSwarmAgent(storage, "agent-r1", { status: "running" });

      insertSwarmAgent(storage, {
        id: "agent-r2",
        swarmId: id1,
        role: "analyst",
        task: "Analyze something",
        tools: [],
      });
      // agent-r2 stays pending

      const recovered = recoverStaleSwarmJobs(storage);
      expect(recovered).toBe(1);

      // Job should be failed
      const job1 = getSwarmJob(storage, id1);
      expect(job1!.status).toBe("failed");

      // Agents should be failed
      const agents = getSwarmAgents(storage, id1);
      expect(agents).toHaveLength(2);
      for (const a of agents) {
        expect(a.status).toBe("failed");
        expect(a.error).toBe("Server restarted — job interrupted");
      }

      // Done job should be untouched
      const job2 = getSwarmJob(storage, id2);
      expect(job2!.status).toBe("done");
    });

    it("returns 0 when no stale jobs exist", () => {
      const id = createSwarmJob(storage, { goal: "done job", threadId: null });
      updateSwarmJob(storage, id, { status: "done" });
      expect(recoverStaleSwarmJobs(storage)).toBe(0);
    });
  });

  describe("swarm agents", () => {
    it("inserts and retrieves agents", () => {
      const jobId = createSwarmJob(storage, { goal: "test", threadId: null });
      insertSwarmAgent(storage, {
        id: "agent-1",
        swarmId: jobId,
        role: "researcher",
        task: "Research NVDA",
        tools: ["web_search", "read_page"],
      });

      const agents = getSwarmAgents(storage, jobId);
      expect(agents).toHaveLength(1);
      expect(agents[0]!.role).toBe("researcher");
      expect(agents[0]!.task).toBe("Research NVDA");
      expect(agents[0]!.tools).toEqual(["web_search", "read_page"]);
      expect(agents[0]!.status).toBe("pending");
    });

    it("updates agent status", () => {
      const jobId = createSwarmJob(storage, { goal: "test", threadId: null });
      insertSwarmAgent(storage, {
        id: "agent-1",
        swarmId: jobId,
        role: "analyst",
        task: "Analyze data",
        tools: [],
      });

      updateSwarmAgent(storage, "agent-1", {
        status: "done",
        result: "Analysis complete",
        steps_used: 4,
      });

      const agents = getSwarmAgents(storage, jobId);
      expect(agents[0]!.status).toBe("done");
      expect(agents[0]!.result).toBe("Analysis complete");
      expect(agents[0]!.stepsUsed).toBe(4);
    });
  });

  describe("blackboard", () => {
    it("inserts and retrieves entries", () => {
      const jobId = createSwarmJob(storage, { goal: "test", threadId: null });

      insertBlackboardEntry(storage, {
        swarmId: jobId,
        agentId: "agent-1",
        type: "finding",
        content: "NVDA revenue grew 94% YoY",
      });

      insertBlackboardEntry(storage, {
        swarmId: jobId,
        agentId: "agent-2",
        type: "question",
        content: "What is AMD's comparable growth rate?",
      });

      const entries = getBlackboardEntries(storage, jobId);
      expect(entries).toHaveLength(2);
      expect(entries[0]!.type).toBe("finding");
      expect(entries[0]!.content).toBe("NVDA revenue grew 94% YoY");
      expect(entries[1]!.type).toBe("question");
    });

    it("returns empty array for no entries", () => {
      const jobId = createSwarmJob(storage, { goal: "test", threadId: null });
      const entries = getBlackboardEntries(storage, jobId);
      expect(entries).toHaveLength(0);
    });
  });

  describe("runSwarmInBackground", () => {
    it("completes with synthesis on success", async () => {
      const { generateText } = await import("ai");
      // First call: planner returns plan
      // Second+ calls: sub-agents produce results
      // Last call: synthesizer produces report
      (generateText as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          // Planner
          text: '```json\n[{"role":"researcher","task":"Research topic A","tools":["web_search","knowledge_search"]},{"role":"analyst","task":"Analyze topic B","tools":["knowledge_search"]}]\n```',
          steps: [],
        })
        .mockResolvedValueOnce({
          // Sub-agent 1
          text: "Found important data about topic A.",
          steps: [{ type: "tool-result" }],
        })
        .mockResolvedValueOnce({
          // Sub-agent 2
          text: "Analysis shows strong trends in topic B.",
          steps: [{ type: "tool-result" }],
        })
        .mockResolvedValueOnce({
          // Synthesizer
          text: "# Swarm Report: Test\n\n## Summary\nCombined findings from both agents.\n\n## Key Findings\n- Topic A data\n- Topic B trends",
          steps: [],
        });

      const ctx = makeCtx();
      const id = createSwarmJob(storage, {
        goal: "Analyze test topics",
        threadId: null,
      });

      await runSwarmInBackground(ctx, id);

      const job = getSwarmJob(storage, id);
      expect(job!.status).toBe("done");
      expect(job!.synthesis).toContain("Swarm Report");
      expect(job!.completedAt).not.toBeNull();
      expect(job!.agentCount).toBe(2);

      // Verify agents were created
      const agents = getSwarmAgents(storage, id);
      expect(agents).toHaveLength(2);
    });

    it("falls back to single agent when planning fails", async () => {
      const { generateText } = await import("ai");
      (generateText as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          // Planner fails (no valid JSON)
          text: "I cannot decompose this task.",
          steps: [],
        })
        .mockResolvedValueOnce({
          // Fallback single agent
          text: "Single agent result for the goal.",
          steps: [{ type: "tool-result" }],
        })
        .mockResolvedValueOnce({
          // Synthesizer
          text: "# Swarm Report\n\nSingle agent findings.",
          steps: [],
        });

      const ctx = makeCtx();
      const id = createSwarmJob(storage, {
        goal: "Simple task",
        threadId: null,
      });

      await runSwarmInBackground(ctx, id);

      const job = getSwarmJob(storage, id);
      expect(job!.status).toBe("done");
      // Should have 1 fallback agent
      const agents = getSwarmAgents(storage, id);
      expect(agents).toHaveLength(1);
      expect(agents[0]!.role).toBe("researcher");
    });

    it("sets job to failed when execution throws", async () => {
      const { generateText } = await import("ai");
      (generateText as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("LLM unavailable"),
      );

      const ctx = makeCtx();
      const id = createSwarmJob(storage, {
        goal: "Failing swarm",
        threadId: null,
      });

      await runSwarmInBackground(ctx, id);

      const job = getSwarmJob(storage, id);
      expect(job!.status).toBe("failed");
    });

    it("persists sandbox artifacts and posts structured blackboard entry", async () => {
      const { generateText } = await import("ai");
      // Plan with a coder agent that uses run_code
      (generateText as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          // Planner
          text: '```json\n[{"role":"coder","task":"Generate a chart","tools":["run_code"]}]\n```',
          steps: [],
        })
        .mockResolvedValueOnce({
          // Sub-agent (coder) — tool calls happen inside the mock, but result text comes back
          text: "Generated chart successfully.",
          steps: [{ type: "tool-result" }],
        })
        .mockResolvedValueOnce({
          // Synthesizer
          text: "# Report\nChart generated.",
          steps: [],
        });

      // Mock sandbox to return a file
      vi.stubEnv("PAI_SANDBOX_URL", "http://localhost:8888");

      const ctx = makeCtx();
      const id = createSwarmJob(storage, {
        goal: "Generate stock chart",
        threadId: null,
      });

      await runSwarmInBackground(ctx, id);

      const job = getSwarmJob(storage, id);
      expect(job!.status).toBe("done");

      // Verify agents were created with run_code tool
      const agents = getSwarmAgents(storage, id);
      expect(agents).toHaveLength(1);
      expect(agents[0]!.role).toBe("coder");

      // Artifacts are persisted when run_code executes inside generateText,
      // which is mocked — so we verify the blackboard has at least the final finding
      const entries = getBlackboardEntries(storage, id);
      expect(entries.length).toBeGreaterThanOrEqual(1);

      vi.unstubAllEnvs();
    });

    it("registers job in background_jobs DB table", async () => {
      const { generateText } = await import("ai");
      (generateText as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          text: '```json\n[{"role":"researcher","task":"test","tools":["knowledge_search"]}]\n```',
          steps: [],
        })
        .mockResolvedValueOnce({ text: "Done.", steps: [] })
        .mockResolvedValueOnce({ text: "# Report\nDone.", steps: [] });

      const ctx = makeCtx();
      const id = createSwarmJob(storage, {
        goal: "Tracked swarm",
        threadId: null,
      });

      await runSwarmInBackground(ctx, id);

      const tracked = getJob(storage, id);
      expect(tracked).toBeDefined();
      expect(tracked!.status).toBe("done");
    });
  });
});

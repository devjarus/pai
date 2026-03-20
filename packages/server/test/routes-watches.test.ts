import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { registerWatchesRoutes } from "../src/routes/watches.js";
import type { ServerContext } from "../src/index.js";

// ---------------------------------------------------------------------------
// Mock @personal-ai/watches
// ---------------------------------------------------------------------------
const mockListWatches = vi.fn();
const mockGetWatch = vi.fn();
const mockEnsureWatch = vi.fn();
const mockUpdateWatch = vi.fn();
const mockDeleteWatch = vi.fn();
const mockPauseWatch = vi.fn();
const mockResumeWatch = vi.fn();
const mockListTemplates = vi.fn();
const mockApplyTemplate = vi.fn();
const mockResolveDepthForWatch = vi.fn();

vi.mock("@personal-ai/watches", () => ({
  listWatches: (...args: unknown[]) => mockListWatches(...args),
  getWatch: (...args: unknown[]) => mockGetWatch(...args),
  ensureWatch: (...args: unknown[]) => mockEnsureWatch(...args),
  updateWatch: (...args: unknown[]) => mockUpdateWatch(...args),
  deleteWatch: (...args: unknown[]) => mockDeleteWatch(...args),
  pauseWatch: (...args: unknown[]) => mockPauseWatch(...args),
  resumeWatch: (...args: unknown[]) => mockResumeWatch(...args),
  listTemplates: (...args: unknown[]) => mockListTemplates(...args),
  applyTemplate: (...args: unknown[]) => mockApplyTemplate(...args),
  resolveDepthForWatch: (...args: unknown[]) => mockResolveDepthForWatch(...args),
}));

// ---------------------------------------------------------------------------
// Mock @personal-ai/core
// ---------------------------------------------------------------------------
vi.mock("@personal-ai/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@personal-ai/core")>();
  return {
    ...actual,
    recordProductEvent: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Mock @personal-ai/plugin-tasks
// ---------------------------------------------------------------------------
const mockListTasks = vi.fn();
vi.mock("@personal-ai/plugin-tasks", () => ({
  listTasks: (...args: unknown[]) => mockListTasks(...args),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const MOCK_WATCH = {
  id: "watch-1",
  title: "AI agents",
  question: "Latest developments in AI agents",
  status: "active",
  family: "general",
  executionMode: "research",
  intervalHours: 24,
  threadId: "thread-1",
  latestBriefId: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

function createMockServerCtx(): ServerContext {
  const backgroundDispatcher = {
    enqueueResearch: vi.fn().mockResolvedValue("job-research-1"),
    enqueueSwarm: vi.fn().mockResolvedValue("job-swarm-1"),
    enqueueBriefing: vi.fn().mockReturnValue("briefing-queued-1"),
    getJobQueueMetadata: vi.fn().mockReturnValue({ queuePosition: null, waitingReason: null }),
    getWorkState: vi.fn().mockReturnValue({
      startupDelayUntil: null,
      activeWorkId: null,
      activeKind: null,
      pending: [],
    }),
  };
  return {
    ctx: {
      config: {
        dataDir: "/tmp/test",
        sandboxUrl: "http://sandbox",
        browserUrl: "http://browser",
        logLevel: "silent" as const,
        llm: {
          provider: "ollama" as const,
          model: "llama3.2",
          baseUrl: "http://127.0.0.1:11434",
          fallbackMode: "local-first" as const,
        },
        plugins: ["memory", "tasks"],
      },
      storage: {
        query: vi.fn().mockReturnValue([]),
        run: vi.fn(),
      } as any,
      llm: {
        chat: vi.fn().mockResolvedValue({ text: "OK", usage: { inputTokens: 10, outputTokens: 5 } }),
        embed: vi.fn().mockResolvedValue({ embedding: [0.1, 0.2, 0.3] }),
        health: vi.fn().mockResolvedValue({ ok: true, provider: "ollama" }),
      },
      logger: {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
      },
    },
    agents: [],
    backgroundDispatcher: backgroundDispatcher as ServerContext["backgroundDispatcher"],
    reinitialize: vi.fn(),
    telegramBot: null,
    telegramStatus: { running: false },
    startTelegramBot: vi.fn(),
    stopTelegramBot: vi.fn(),
    authEnabled: false,
  };
}

function addTestErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: { statusCode?: number; message: string }, _request, reply) => {
    const statusCode = error.statusCode ?? 500;
    reply.status(statusCode).send({
      error: statusCode >= 500 ? "Internal server error" : error.message,
    });
  });
}

// ==========================================================================
// Watches Routes
// ==========================================================================

describe("watches routes", () => {
  let app: FastifyInstance;
  let serverCtx: ServerContext;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockListTasks.mockReturnValue([]);
    app = Fastify();
    addTestErrorHandler(app);
    serverCtx = createMockServerCtx();
    registerWatchesRoutes(app, serverCtx);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  // --- GET /api/watches ---

  it("GET /api/watches returns list of watches", async () => {
    mockListWatches.mockReturnValue([MOCK_WATCH]);

    const res = await app.inject({ method: "GET", url: "/api/watches" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe("watch-1");
    expect(body[0].actionSummary).toBeDefined();
  });

  it("GET /api/watches returns empty list when no watches", async () => {
    mockListWatches.mockReturnValue([]);

    const res = await app.inject({ method: "GET", url: "/api/watches" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  // --- GET /api/watches/:id ---

  it("GET /api/watches/:id returns a watch", async () => {
    mockGetWatch.mockReturnValue(MOCK_WATCH);

    const res = await app.inject({ method: "GET", url: "/api/watches/watch-1" });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe("watch-1");
  });

  it("GET /api/watches/:id returns 404 for unknown watch", async () => {
    mockGetWatch.mockReturnValue(null);

    const res = await app.inject({ method: "GET", url: "/api/watches/nonexistent" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("Watch not found");
  });

  // --- POST /api/watches ---

  it("POST /api/watches creates a watch", async () => {
    mockEnsureWatch.mockReturnValue({ program: MOCK_WATCH, created: true, duplicateReason: null });

    const res = await app.inject({
      method: "POST",
      url: "/api/watches",
      payload: { title: "AI agents", question: "Latest developments in AI agents" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.watch.id).toBe("watch-1");
    expect(body.created).toBe(true);
  });

  it("POST /api/watches validates required fields", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/watches",
      payload: { title: "" },
    });
    expect(res.statusCode).toBe(400);
  });

  // --- POST /api/watches/follow ---

  it("POST /api/watches/follow creates a watch and triggers research", async () => {
    mockEnsureWatch.mockReturnValue({ program: MOCK_WATCH, created: true, duplicateReason: null });

    const res = await app.inject({
      method: "POST",
      url: "/api/watches/follow",
      payload: { topic: "AI agents" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.watch).toBeDefined();
    expect(body.created).toBe(true);
    // Should trigger background research
    expect(serverCtx.backgroundDispatcher.enqueueResearch).toHaveBeenCalled();
  });

  it("POST /api/watches/follow returns existing watch without triggering research", async () => {
    mockEnsureWatch.mockReturnValue({ program: MOCK_WATCH, created: false, duplicateReason: "similar_question" });

    const res = await app.inject({
      method: "POST",
      url: "/api/watches/follow",
      payload: { topic: "AI agents" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.created).toBe(false);
    expect(body.duplicateReason).toBe("similar_question");
    // Should NOT trigger research for duplicates
    expect(serverCtx.backgroundDispatcher.enqueueResearch).not.toHaveBeenCalled();
  });

  it("POST /api/watches/follow validates topic is required", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/watches/follow",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  // --- PATCH /api/watches/:id ---

  it("PATCH /api/watches/:id updates a watch", async () => {
    const updated = { ...MOCK_WATCH, title: "Updated title" };
    mockUpdateWatch.mockReturnValue(updated);

    const res = await app.inject({
      method: "PATCH",
      url: "/api/watches/watch-1",
      payload: { title: "Updated title" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().title).toBe("Updated title");
  });

  it("PATCH /api/watches/:id returns 404 for unknown watch", async () => {
    mockUpdateWatch.mockReturnValue(null);

    const res = await app.inject({
      method: "PATCH",
      url: "/api/watches/nonexistent",
      payload: { title: "x" },
    });
    expect(res.statusCode).toBe(404);
  });

  // --- DELETE /api/watches/:id ---

  it("DELETE /api/watches/:id deletes a watch", async () => {
    mockDeleteWatch.mockReturnValue(true);

    const res = await app.inject({ method: "DELETE", url: "/api/watches/watch-1" });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  // --- PATCH /api/watches/:id/status ---

  it("PATCH /api/watches/:id/status pauses a watch", async () => {
    mockPauseWatch.mockReturnValue(true);

    const res = await app.inject({
      method: "PATCH",
      url: "/api/watches/watch-1/status",
      payload: { action: "pause" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it("PATCH /api/watches/:id/status resumes a watch", async () => {
    mockResumeWatch.mockReturnValue(true);

    const res = await app.inject({
      method: "PATCH",
      url: "/api/watches/watch-1/status",
      payload: { action: "resume" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  // --- POST /api/watches/:id/run ---

  it("POST /api/watches/:id/run triggers research for a watch", async () => {
    mockGetWatch.mockReturnValue(MOCK_WATCH);
    mockResolveDepthForWatch.mockReturnValue("standard");

    const res = await app.inject({ method: "POST", url: "/api/watches/watch-1/run" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.jobId).toBe("job-research-1");
    expect(serverCtx.backgroundDispatcher.enqueueResearch).toHaveBeenCalled();
  });

  it("POST /api/watches/:id/run triggers swarm for analysis mode watch", async () => {
    mockGetWatch.mockReturnValue({ ...MOCK_WATCH, executionMode: "analysis" });
    mockResolveDepthForWatch.mockReturnValue("deep");

    const res = await app.inject({ method: "POST", url: "/api/watches/watch-1/run" });
    expect(res.statusCode).toBe(200);
    expect(res.json().jobId).toBe("job-swarm-1");
    expect(serverCtx.backgroundDispatcher.enqueueSwarm).toHaveBeenCalled();
  });

  it("POST /api/watches/:id/run returns 404 for unknown watch", async () => {
    mockGetWatch.mockReturnValue(null);

    const res = await app.inject({ method: "POST", url: "/api/watches/watch-1/run" });
    expect(res.statusCode).toBe(404);
  });

  // --- GET /api/watches/templates ---

  it("GET /api/watches/templates returns templates", async () => {
    mockListTemplates.mockReturnValue([{ id: "t1", label: "Weekly newsletter" }]);

    const res = await app.inject({ method: "GET", url: "/api/watches/templates" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
  });

  // --- POST /api/watches/from-template ---

  it("POST /api/watches/from-template creates a watch from template", async () => {
    mockApplyTemplate.mockReturnValue({
      label: "Weekly AI News",
      goal: "Latest AI developments",
      intervalHours: 168,
      deliveryMode: "always",
      depthLevel: "standard",
    });
    mockEnsureWatch.mockReturnValue({ program: MOCK_WATCH, created: true, duplicateReason: null });

    const res = await app.inject({
      method: "POST",
      url: "/api/watches/from-template",
      payload: { templateId: "ai-news", subject: "AI" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.watch).toBeDefined();
    expect(body.created).toBe(true);
    expect(body.template.id).toBe("ai-news");
  });

  it("POST /api/watches/from-template returns 404 for unknown template", async () => {
    mockApplyTemplate.mockReturnValue(null);

    const res = await app.inject({
      method: "POST",
      url: "/api/watches/from-template",
      payload: { templateId: "nonexistent", subject: "test" },
    });
    expect(res.statusCode).toBe(404);
  });

  // --- GET /api/watches/:id/history ---

  it("GET /api/watches/:id/history returns watch history with briefings, tasks, and jobs", async () => {
    mockGetWatch.mockReturnValue(MOCK_WATCH);
    mockListTasks.mockReturnValue([
      {
        id: "task-1",
        title: "Check latest updates",
        status: "open",
        priority: "medium",
        due_date: null,
        created_at: "2026-01-01T00:00:00Z",
        completed_at: null,
        source_type: "program",
        source_id: "watch-1",
      },
    ]);
    // Mock storage.query for briefings, research_jobs, swarm_jobs
    const mockQuery = serverCtx.ctx.storage.query as ReturnType<typeof vi.fn>;
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes("FROM briefings")) {
        return [{
          id: "brief-1",
          generated_at: "2026-01-02T00:00:00Z",
          type: "research",
          status: "delivered",
          signal_hash: "abc",
          source_job_id: "job-1",
          source_job_kind: "research",
          sections: JSON.stringify({ recommendation: { summary: "AI is advancing" } }),
        }];
      }
      if (sql.includes("FROM research_jobs")) {
        return [{
          id: "rj-1",
          status: "completed",
          goal: "Latest AI developments",
          created_at: "2026-01-01T00:00:00Z",
          queued_at: "2026-01-01T00:00:01Z",
          completed_at: "2026-01-01T00:05:00Z",
          briefing_id: "brief-1",
          result_type: "general",
        }];
      }
      if (sql.includes("FROM swarm_jobs")) {
        return [];
      }
      return [];
    });

    const res = await app.inject({ method: "GET", url: "/api/watches/watch-1/history" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.watch.id).toBe("watch-1");
    expect(body.history.briefings).toHaveLength(1);
    expect(body.history.briefings[0].recommendationSummary).toBe("AI is advancing");
    expect(body.history.actions).toHaveLength(1);
    expect(body.history.actions[0].id).toBe("task-1");
    expect(body.history.researchJobs).toHaveLength(1);
    expect(body.history.researchJobs[0].goal).toBe("Latest AI developments");
    expect(body.history.analysisJobs).toEqual([]);
  });

  it("GET /api/watches/:id/history returns 404 for unknown watch", async () => {
    mockGetWatch.mockReturnValue(null);

    const res = await app.inject({ method: "GET", url: "/api/watches/nonexistent/history" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("Watch not found");
  });

  it("GET /api/watches/:id/history returns empty history when no data", async () => {
    mockGetWatch.mockReturnValue(MOCK_WATCH);
    mockListTasks.mockReturnValue([]);
    const mockQuery = serverCtx.ctx.storage.query as ReturnType<typeof vi.fn>;
    mockQuery.mockReturnValue([]);

    const res = await app.inject({ method: "GET", url: "/api/watches/watch-1/history" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.history.briefings).toEqual([]);
    expect(body.history.actions).toEqual([]);
    expect(body.history.researchJobs).toEqual([]);
    expect(body.history.analysisJobs).toEqual([]);
  });
});

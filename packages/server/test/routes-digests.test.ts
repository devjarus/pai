import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { registerDigestRoutes } from "../src/routes/digests.js";
import type { ServerContext } from "../src/index.js";

// ---------------------------------------------------------------------------
// Mock @personal-ai/core
// ---------------------------------------------------------------------------
const mockRecordProductEvent = vi.fn();

vi.mock("@personal-ai/core", () => ({
  recordProductEvent: (...args: unknown[]) => mockRecordProductEvent(...args),
}));

// ---------------------------------------------------------------------------
// Mock ../src/briefing.js
// ---------------------------------------------------------------------------
const mockGetLatestBriefing = vi.fn();
const mockGetBriefingById = vi.fn();
const mockListAllBriefings = vi.fn();
const mockGetDailyBriefingState = vi.fn().mockReturnValue({ generating: false, pending: false });
const mockGetBriefBeliefs = vi.fn();

vi.mock("../src/briefing.js", () => ({
  getLatestBriefing: (...args: unknown[]) => mockGetLatestBriefing(...args),
  getBriefingById: (...args: unknown[]) => mockGetBriefingById(...args),
  listAllBriefings: (...args: unknown[]) => mockListAllBriefings(...args),
  getDailyBriefingState: (...args: unknown[]) => mockGetDailyBriefingState(...args),
  getBriefBeliefs: (...args: unknown[]) => mockGetBriefBeliefs(...args),
}));

// ---------------------------------------------------------------------------
// Mock ../src/digest-ratings.js
// ---------------------------------------------------------------------------
const mockRateDigest = vi.fn();

vi.mock("../src/digest-ratings.js", () => ({
  rateDigest: (...args: unknown[]) => mockRateDigest(...args),
}));

// ---------------------------------------------------------------------------
// Mock @personal-ai/library
// ---------------------------------------------------------------------------
const mockIngestCorrection = vi.fn();

vi.mock("@personal-ai/library", () => ({
  ingestCorrection: (...args: unknown[]) => mockIngestCorrection(...args),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const MOCK_BRIEFING = {
  id: "briefing-1",
  generated_at: "2026-03-01T10:00:00Z",
  type: "daily",
  status: "delivered",
  program_id: null,
  sections: JSON.stringify({
    recommendation: { summary: "Consider upgrading to Node 22" },
    goal: "Latest Node.js updates",
    next_actions: [
      { title: "Test Node 22 compat", timing: "this week", detail: "Run CI with Node 22" },
    ],
  }),
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
// Digest Routes
// ==========================================================================

describe("digest routes", () => {
  let app: FastifyInstance;
  let serverCtx: ServerContext;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    addTestErrorHandler(app);
    serverCtx = createMockServerCtx();
    registerDigestRoutes(app, serverCtx);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  // --- GET /api/digests ---

  it("GET /api/digests returns all digests with state", async () => {
    mockListAllBriefings.mockReturnValue([MOCK_BRIEFING]);

    const res = await app.inject({ method: "GET", url: "/api/digests" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.briefings).toHaveLength(1);
    expect(body.generating).toBe(false);
    expect(body.pending).toBe(false);
  });

  it("GET /api/digests returns empty list", async () => {
    mockListAllBriefings.mockReturnValue([]);

    const res = await app.inject({ method: "GET", url: "/api/digests" });
    expect(res.statusCode).toBe(200);
    expect(res.json().briefings).toEqual([]);
  });

  // --- GET /api/digests/latest ---

  it("GET /api/digests/latest returns latest briefing", async () => {
    mockGetLatestBriefing.mockReturnValue(MOCK_BRIEFING);

    const res = await app.inject({ method: "GET", url: "/api/digests/latest" });
    expect(res.statusCode).toBe(200);
    expect(res.json().briefing.id).toBe("briefing-1");
  });

  it("GET /api/digests/latest returns null when no briefing exists", async () => {
    mockGetLatestBriefing.mockReturnValue(null);

    const res = await app.inject({ method: "GET", url: "/api/digests/latest" });
    expect(res.statusCode).toBe(200);
    expect(res.json().briefing).toBeNull();
  });

  // --- POST /api/digests/refresh ---

  it("POST /api/digests/refresh queues a new briefing", async () => {
    const res = await app.inject({ method: "POST", url: "/api/digests/refresh" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.briefingId).toBe("briefing-queued-1");
    expect(serverCtx.backgroundDispatcher.enqueueBriefing).toHaveBeenCalledWith({
      sourceKind: "manual",
      reason: "digest-refresh",
    });
  });

  // --- GET /api/digests/:id ---

  it("GET /api/digests/:id returns a specific digest", async () => {
    mockGetBriefingById.mockReturnValue(MOCK_BRIEFING);

    const res = await app.inject({ method: "GET", url: "/api/digests/briefing-1" });
    expect(res.statusCode).toBe(200);
    expect(res.json().briefing.id).toBe("briefing-1");
    expect(mockRecordProductEvent).toHaveBeenCalledWith(serverCtx.ctx.storage, {
      eventType: "brief_opened",
      briefId: "briefing-1",
      programId: null,
      threadId: null,
      channel: "web",
      metadata: { type: "daily" },
    });
  });

  it("GET /api/digests/:id returns 404 for unknown digest", async () => {
    mockGetBriefingById.mockReturnValue(null);

    const res = await app.inject({ method: "GET", url: "/api/digests/nonexistent" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("Digest not found");
  });

  // --- GET /api/digests/:id/sources ---

  it("GET /api/digests/:id/sources returns beliefs for a digest", async () => {
    mockGetBriefingById.mockReturnValue(MOCK_BRIEFING);
    mockGetBriefBeliefs.mockReturnValue([{ id: "b1", statement: "User likes Node.js" }]);

    const res = await app.inject({ method: "GET", url: "/api/digests/briefing-1/sources" });
    expect(res.statusCode).toBe(200);
    expect(res.json().sources).toHaveLength(1);
  });

  it("GET /api/digests/:id/sources returns 404 for unknown digest", async () => {
    mockGetBriefingById.mockReturnValue(null);

    const res = await app.inject({ method: "GET", url: "/api/digests/nonexistent/sources" });
    expect(res.statusCode).toBe(404);
  });

  // --- POST /api/digests/:id/correct ---

  it("POST /api/digests/:id/correct corrects a belief", async () => {
    mockGetBriefingById.mockReturnValue(MOCK_BRIEFING);
    mockIngestCorrection.mockResolvedValue({ corrected: true, replacementBeliefId: "belief-new-1" });

    const res = await app.inject({
      method: "POST",
      url: "/api/digests/briefing-1/correct",
      payload: {
        beliefId: "b1",
        correctedStatement: "Node 22 is actually already supported",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(mockIngestCorrection).toHaveBeenCalledWith(
      serverCtx.ctx.storage,
      serverCtx.ctx.llm,
      {
        beliefId: "b1",
        correctedStatement: "Node 22 is actually already supported",
        digestId: "briefing-1",
        note: undefined,
      },
    );
    expect(mockRecordProductEvent).toHaveBeenCalledWith(
      serverCtx.ctx.storage,
      expect.objectContaining({
        eventType: "belief_corrected",
        briefId: "briefing-1",
        beliefId: "belief-new-1",
        channel: "web",
      }),
    );
  });

  it("POST /api/digests/:id/correct returns 400 when correction is invalid", async () => {
    mockGetBriefingById.mockReturnValue(MOCK_BRIEFING);
    mockIngestCorrection.mockResolvedValue({ corrected: false, error: "Correction must change the belief statement" });

    const res = await app.inject({
      method: "POST",
      url: "/api/digests/briefing-1/correct",
      payload: {
        beliefId: "b1",
        correctedStatement: "Node 22 is actually already supported",
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("must change");
    expect(mockRecordProductEvent).not.toHaveBeenCalled();
  });

  it("POST /api/digests/:id/correct returns 404 when the target belief is missing", async () => {
    mockGetBriefingById.mockReturnValue(MOCK_BRIEFING);
    mockIngestCorrection.mockResolvedValue({ corrected: false, error: "Belief not found" });

    const res = await app.inject({
      method: "POST",
      url: "/api/digests/briefing-1/correct",
      payload: {
        beliefId: "missing-belief",
        correctedStatement: "Node 22 is actually already supported",
      },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("Belief not found");
    expect(mockRecordProductEvent).not.toHaveBeenCalled();
  });

  it("POST /api/digests/:id/correct returns 404 for unknown digest", async () => {
    mockGetBriefingById.mockReturnValue(null);

    const res = await app.inject({
      method: "POST",
      url: "/api/digests/nonexistent/correct",
      payload: { beliefId: "b1", correctedStatement: "fixed" },
    });
    expect(res.statusCode).toBe(404);
  });

  // --- POST /api/digests/:id/rate ---

  it("POST /api/digests/:id/rate rates a digest", async () => {
    mockGetBriefingById.mockReturnValue(MOCK_BRIEFING);
    mockRateDigest.mockReturnValue({ id: "rating-1", digestId: "briefing-1", rating: 4 });

    const res = await app.inject({
      method: "POST",
      url: "/api/digests/briefing-1/rate",
      payload: { rating: 4, feedback: "Good digest" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().rating).toBe(4);
  });

  it("POST /api/digests/:id/rate returns 404 for unknown digest", async () => {
    mockGetBriefingById.mockReturnValue(null);

    const res = await app.inject({
      method: "POST",
      url: "/api/digests/nonexistent/rate",
      payload: { rating: 3 },
    });
    expect(res.statusCode).toBe(404);
  });

  it("POST /api/digests/:id/rate validates rating range", async () => {
    mockGetBriefingById.mockReturnValue(MOCK_BRIEFING);

    const res = await app.inject({
      method: "POST",
      url: "/api/digests/briefing-1/rate",
      payload: { rating: 10 },
    });
    expect(res.statusCode).toBe(400);
  });

  // --- POST /api/digests/:id/accept ---

  it("POST /api/digests/:id/accept records recommendation acceptance once", async () => {
    mockGetBriefingById.mockReturnValue(MOCK_BRIEFING);

    const res = await app.inject({ method: "POST", url: "/api/digests/briefing-1/accept" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, alreadyAccepted: false });
    expect(mockRecordProductEvent).toHaveBeenCalledWith(serverCtx.ctx.storage, {
      eventType: "recommendation_accepted",
      channel: "web",
      programId: null,
      briefId: "briefing-1",
      threadId: null,
      metadata: { type: "daily" },
    });
  });

  it("POST /api/digests/:id/accept is idempotent for an already accepted digest", async () => {
    mockGetBriefingById.mockReturnValue(MOCK_BRIEFING);
    (serverCtx.ctx.storage.query as ReturnType<typeof vi.fn>).mockReturnValueOnce([{ id: "event-1" }]);

    const res = await app.inject({ method: "POST", url: "/api/digests/briefing-1/accept" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, alreadyAccepted: true });
    expect(mockRecordProductEvent).not.toHaveBeenCalled();
  });

  it("POST /api/digests/:id/accept returns 404 for unknown digest", async () => {
    mockGetBriefingById.mockReturnValue(null);

    const res = await app.inject({ method: "POST", url: "/api/digests/nonexistent/accept" });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("Digest not found");
  });

  // --- POST /api/digests/:id/rerun ---

  it("POST /api/digests/:id/rerun reruns research for a digest", async () => {
    mockGetBriefingById.mockReturnValue(MOCK_BRIEFING);

    const res = await app.inject({ method: "POST", url: "/api/digests/briefing-1/rerun" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.jobId).toBe("job-research-1");
  });

  it("POST /api/digests/:id/rerun returns 404 for unknown digest", async () => {
    mockGetBriefingById.mockReturnValue(null);

    const res = await app.inject({ method: "POST", url: "/api/digests/nonexistent/rerun" });
    expect(res.statusCode).toBe(404);
  });

  it("POST /api/digests/:id/rerun dispatches swarm for analysis type", async () => {
    const analysisBriefing = {
      ...MOCK_BRIEFING,
      id: "swarm-briefing-1",
      sections: JSON.stringify({ goal: "Analyze market trends", execution: "analysis" }),
    };
    mockGetBriefingById.mockReturnValue(analysisBriefing);

    const res = await app.inject({ method: "POST", url: "/api/digests/swarm-briefing-1/rerun" });
    expect(res.statusCode).toBe(200);
    expect(res.json().jobId).toBe("job-swarm-1");
    expect(serverCtx.backgroundDispatcher.enqueueSwarm).toHaveBeenCalled();
  });

  it("POST /api/digests/:id/rerun returns 400 when no goal in sections", async () => {
    const noGoalBriefing = {
      ...MOCK_BRIEFING,
      sections: JSON.stringify({ recommendation: { summary: "Something" } }),
    };
    mockGetBriefingById.mockReturnValue(noGoalBriefing);

    const res = await app.inject({ method: "POST", url: "/api/digests/briefing-1/rerun" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("No research goal found in digest");
  });

  // --- GET /api/digests/:id/suggestions ---

  it("GET /api/digests/:id/suggestions returns next_actions", async () => {
    mockGetBriefingById.mockReturnValue(MOCK_BRIEFING);

    const res = await app.inject({ method: "GET", url: "/api/digests/briefing-1/suggestions" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.suggestions).toHaveLength(1);
    expect(body.suggestions[0].title).toBe("Test Node 22 compat");
  });

  it("GET /api/digests/:id/suggestions returns 404 for unknown digest", async () => {
    mockGetBriefingById.mockReturnValue(null);

    const res = await app.inject({ method: "GET", url: "/api/digests/nonexistent/suggestions" });
    expect(res.statusCode).toBe(404);
  });

  it("GET /api/digests/:id/suggestions returns empty when no next_actions", async () => {
    const noActionsBriefing = {
      ...MOCK_BRIEFING,
      sections: JSON.stringify({ recommendation: { summary: "All good" } }),
    };
    mockGetBriefingById.mockReturnValue(noActionsBriefing);

    const res = await app.inject({ method: "GET", url: "/api/digests/briefing-1/suggestions" });
    expect(res.statusCode).toBe(200);
    expect(res.json().suggestions).toEqual([]);
  });
});

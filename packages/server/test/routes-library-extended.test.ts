import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { registerLibraryRoutes } from "../src/routes/library.js";
import type { ServerContext } from "../src/index.js";

// ---------------------------------------------------------------------------
// Mock @personal-ai/library
// ---------------------------------------------------------------------------
const mockListBeliefs = vi.fn();
const mockSearchBeliefs = vi.fn();
const mockSemanticSearch = vi.fn();
const mockForgetBelief = vi.fn();
const mockCorrectBelief = vi.fn();
const mockRemember = vi.fn();
const mockMemoryStats = vi.fn();
const mockListSources = vi.fn();
const mockGetSourceChunks = vi.fn();
const mockLearnFromContent = vi.fn();
const mockForgetSource = vi.fn();
const mockListFindings = vi.fn();
const mockListFindingsForWatch = vi.fn();
const mockGetFinding = vi.fn();
const mockDeleteFinding = vi.fn();
const mockGetBeliefHistory = vi.fn();
const mockListBeliefProvenance = vi.fn();
const mockUnifiedSearch = vi.fn();

vi.mock("@personal-ai/library", () => ({
  listBeliefs: (...args: unknown[]) => mockListBeliefs(...args),
  searchBeliefs: (...args: unknown[]) => mockSearchBeliefs(...args),
  semanticSearch: (...args: unknown[]) => mockSemanticSearch(...args),
  forgetBelief: (...args: unknown[]) => mockForgetBelief(...args),
  correctBelief: (...args: unknown[]) => mockCorrectBelief(...args),
  remember: (...args: unknown[]) => mockRemember(...args),
  memoryStats: (...args: unknown[]) => mockMemoryStats(...args),
  listSources: (...args: unknown[]) => mockListSources(...args),
  getSourceChunks: (...args: unknown[]) => mockGetSourceChunks(...args),
  learnFromContent: (...args: unknown[]) => mockLearnFromContent(...args),
  forgetSource: (...args: unknown[]) => mockForgetSource(...args),
  listFindings: (...args: unknown[]) => mockListFindings(...args),
  listFindingsForWatch: (...args: unknown[]) => mockListFindingsForWatch(...args),
  getFinding: (...args: unknown[]) => mockGetFinding(...args),
  deleteFinding: (...args: unknown[]) => mockDeleteFinding(...args),
  getBeliefHistory: (...args: unknown[]) => mockGetBeliefHistory(...args),
  listBeliefProvenance: (...args: unknown[]) => mockListBeliefProvenance(...args),
  unifiedSearch: (...args: unknown[]) => mockUnifiedSearch(...args),
}));

// ---------------------------------------------------------------------------
// Mock @personal-ai/core
// ---------------------------------------------------------------------------
const mockRecordProductEvent = vi.fn();
const mockUpdateBeliefContent = vi.fn();
const mockKnowledgeSearch = vi.fn();
const mockReindexSource = vi.fn();
const mockReindexAllSources = vi.fn();
const mockIsBinaryDocument = vi.fn();
const mockParseBinaryDocument = vi.fn();
const mockListJobs = vi.fn();
const mockClearCompletedBackgroundJobs = vi.fn();

vi.mock("@personal-ai/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@personal-ai/core")>();
  return {
    ...actual,
    recordProductEvent: (...args: unknown[]) => mockRecordProductEvent(...args),
    updateBeliefContent: (...args: unknown[]) => mockUpdateBeliefContent(...args),
    knowledgeSearch: (...args: unknown[]) => mockKnowledgeSearch(...args),
    reindexSource: (...args: unknown[]) => mockReindexSource(...args),
    reindexAllSources: (...args: unknown[]) => mockReindexAllSources(...args),
    isBinaryDocument: (...args: unknown[]) => mockIsBinaryDocument(...args),
    parseBinaryDocument: (...args: unknown[]) => mockParseBinaryDocument(...args),
    listJobs: (...args: unknown[]) => mockListJobs(...args),
    clearCompletedBackgroundJobs: (...args: unknown[]) => mockClearCompletedBackgroundJobs(...args),
  };
});

// ---------------------------------------------------------------------------
// Mock page-fetch and tools
// ---------------------------------------------------------------------------
const mockFetchPageAsMarkdown = vi.fn();
const mockDiscoverSubPages = vi.fn();
vi.mock("@personal-ai/plugin-assistant/page-fetch", () => ({
  fetchPageAsMarkdown: (...args: unknown[]) => mockFetchPageAsMarkdown(...args),
  discoverSubPages: (...args: unknown[]) => mockDiscoverSubPages(...args),
}));

const mockRunCrawlInBackground = vi.fn();
vi.mock("@personal-ai/plugin-assistant/tools", () => ({
  runCrawlInBackground: (...args: unknown[]) => mockRunCrawlInBackground(...args),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const MOCK_BELIEF = {
  id: "belief_abc123",
  statement: "User prefers Vitest over Jest",
  confidence: 0.9,
  status: "active",
  type: "preference",
  created_at: "2026-01-15T10:00:00Z",
  updated_at: "2026-02-01T12:00:00Z",
  superseded_by: null,
  supersedes: null,
  importance: 0.8,
  last_accessed: "2026-02-10T08:00:00Z",
  access_count: 5,
  stability: 2.5,
  subject: "owner",
};

const MOCK_SOURCE = {
  id: "src-1",
  title: "Test Doc",
  url: "https://example.com/doc",
  chunk_count: 3,
  fetched_at: "2026-01-01T00:00:00Z",
  tags: "test",
  max_age_days: 30,
};

const MOCK_FINDING = {
  id: "finding-1",
  summary: "AI models are improving",
  sources: ["https://example.com"],
  confidence: 0.9,
  watch_id: "watch-1",
  created_at: "2026-01-01T00:00:00Z",
};

function createMockServerCtx(): ServerContext {
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
        chat: vi.fn().mockResolvedValue({ text: "Analysis result", usage: { inputTokens: 10, outputTokens: 5 } }),
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
    backgroundDispatcher: {
      enqueueResearch: vi.fn().mockResolvedValue("job-1"),
      enqueueSwarm: vi.fn().mockResolvedValue("job-2"),
      enqueueBriefing: vi.fn().mockReturnValue("briefing-1"),
      getJobQueueMetadata: vi.fn().mockReturnValue({ queuePosition: null, waitingReason: null }),
      getWorkState: vi.fn().mockReturnValue({
        startupDelayUntil: null,
        activeWorkId: null,
        activeKind: null,
        pending: [],
      }),
    } as ServerContext["backgroundDispatcher"],
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
// Library Routes — Extended Coverage (documents, findings, profile, etc.)
// ==========================================================================

describe("library routes — extended", () => {
  let app: FastifyInstance;
  let serverCtx: ServerContext;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockListBeliefs.mockReturnValue([]);
    mockListSources.mockReturnValue([]);
    mockListFindings.mockReturnValue([]);
    mockListJobs.mockReturnValue([]);
    app = Fastify();
    addTestErrorHandler(app);
    serverCtx = createMockServerCtx();
    registerLibraryRoutes(app, serverCtx);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  // --- GET /api/library/memories/:id/history ---

  it("GET /api/library/memories/:id/history returns belief history", async () => {
    mockListBeliefs.mockReturnValue([MOCK_BELIEF]);
    mockGetBeliefHistory.mockReturnValue([
      { change_type: "created", changed_at: "2026-01-15T10:00:00Z" },
    ]);

    const res = await app.inject({ method: "GET", url: `/api/library/memories/${MOCK_BELIEF.id}/history` });
    expect(res.statusCode).toBe(200);
    expect(res.json().history).toHaveLength(1);
    expect(res.json().history[0].change_type).toBe("created");
  });

  it("GET /api/library/memories/:id/history returns 404 for unknown belief", async () => {
    mockListBeliefs.mockReturnValue([]);

    const res = await app.inject({ method: "GET", url: "/api/library/memories/nonexistent/history" });
    expect(res.statusCode).toBe(404);
  });

  // --- GET /api/library/memories/:id/provenance ---

  it("GET /api/library/memories/:id/provenance returns provenance", async () => {
    mockListBeliefs.mockReturnValue([MOCK_BELIEF]);
    mockListBeliefProvenance.mockReturnValue([
      { origin: "conversation", source: "thread-1" },
    ]);

    const res = await app.inject({ method: "GET", url: `/api/library/memories/${MOCK_BELIEF.id}/provenance` });
    expect(res.statusCode).toBe(200);
    expect(res.json().provenance).toHaveLength(1);
  });

  it("GET /api/library/memories/:id/provenance returns 404 for unknown belief", async () => {
    mockListBeliefs.mockReturnValue([]);

    const res = await app.inject({ method: "GET", url: "/api/library/memories/nonexistent/provenance" });
    expect(res.statusCode).toBe(404);
  });

  // --- PATCH /api/library/memories/:id ---

  it("PATCH /api/library/memories/:id updates belief statement", async () => {
    mockUpdateBeliefContent.mockResolvedValue({ id: MOCK_BELIEF.id, statement: "Updated statement" });

    const res = await app.inject({
      method: "PATCH",
      url: `/api/library/memories/${MOCK_BELIEF.id}`,
      payload: { statement: "Updated statement" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().statement).toBe("Updated statement");
  });

  it("PATCH /api/library/memories/:id returns 404 when belief not found", async () => {
    mockUpdateBeliefContent.mockRejectedValue(new Error("Belief not found"));

    const res = await app.inject({
      method: "PATCH",
      url: "/api/library/memories/nonexistent",
      payload: { statement: "Updated" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("PATCH /api/library/memories/:id returns 500 for generic error", async () => {
    mockUpdateBeliefContent.mockRejectedValue(new Error("Database error"));

    const res = await app.inject({
      method: "PATCH",
      url: `/api/library/memories/${MOCK_BELIEF.id}`,
      payload: { statement: "Updated" },
    });
    expect(res.statusCode).toBe(500);
  });

  // --- GET /api/library/documents ---

  it("GET /api/library/documents returns document list", async () => {
    mockListSources.mockReturnValue([MOCK_SOURCE]);

    const res = await app.inject({ method: "GET", url: "/api/library/documents" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe("src-1");
    expect(body[0].title).toBe("Test Doc");
    expect(body[0].chunks).toBe(3);
  });

  it("GET /api/library/documents returns empty list", async () => {
    mockListSources.mockReturnValue([]);

    const res = await app.inject({ method: "GET", url: "/api/library/documents" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  // --- GET /api/library/documents/:id/chunks ---

  it("GET /api/library/documents/:id/chunks returns chunks", async () => {
    mockGetSourceChunks.mockReturnValue([
      { id: "chunk-1", content: "Hello world", chunk_index: 0 },
    ]);

    const res = await app.inject({ method: "GET", url: "/api/library/documents/src-1/chunks" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].content).toBe("Hello world");
  });

  it("GET /api/library/documents/:id/chunks returns 404 when source not found", async () => {
    mockGetSourceChunks.mockReturnValue([]);
    mockListSources.mockReturnValue([]);

    const res = await app.inject({ method: "GET", url: "/api/library/documents/nonexistent/chunks" });
    expect(res.statusCode).toBe(404);
  });

  it("GET /api/library/documents/:id/chunks returns empty when source exists but no chunks", async () => {
    mockGetSourceChunks.mockReturnValue([]);
    mockListSources.mockReturnValue([MOCK_SOURCE]);

    const res = await app.inject({ method: "GET", url: "/api/library/documents/src-1/chunks" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  // --- PATCH /api/library/documents/:id ---

  it("PATCH /api/library/documents/:id updates source metadata", async () => {
    mockListSources.mockReturnValue([MOCK_SOURCE]);

    const res = await app.inject({
      method: "PATCH",
      url: "/api/library/documents/src-1",
      payload: { tags: "updated-tag", maxAgeDays: 60 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(serverCtx.ctx.storage.run).toHaveBeenCalled();
  });

  it("PATCH /api/library/documents/:id returns 404 for unknown source", async () => {
    mockListSources.mockReturnValue([]);

    const res = await app.inject({
      method: "PATCH",
      url: "/api/library/documents/nonexistent",
      payload: { tags: "test" },
    });
    expect(res.statusCode).toBe(404);
  });

  // --- DELETE /api/library/documents/:id ---

  it("DELETE /api/library/documents/:id deletes a source", async () => {
    mockForgetSource.mockReturnValue(true);

    const res = await app.inject({ method: "DELETE", url: "/api/library/documents/src-1" });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it("DELETE /api/library/documents/:id returns 404 for unknown source", async () => {
    mockForgetSource.mockReturnValue(false);

    const res = await app.inject({ method: "DELETE", url: "/api/library/documents/nonexistent" });
    expect(res.statusCode).toBe(404);
  });

  // --- POST /api/library/documents/upload ---

  it("POST /api/library/documents/upload stores a text document", async () => {
    mockIsBinaryDocument.mockReturnValue(false);
    mockLearnFromContent.mockResolvedValue({
      source: { id: "src-new", title: "test.txt" },
      chunksStored: 2,
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/library/documents/upload",
      payload: { fileName: "test.txt", content: "Hello world content" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.chunks).toBe(2);
  });

  it("POST /api/library/documents/upload with analyze returns analysis", async () => {
    mockIsBinaryDocument.mockReturnValue(false);
    mockLearnFromContent.mockResolvedValue({
      source: { id: "src-new", title: "test.md" },
      chunksStored: 1,
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/library/documents/upload",
      payload: { fileName: "test.md", content: "# Document content", analyze: true },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.analysis).toBeDefined();
  });

  it("POST /api/library/documents/upload rejects unsupported file type", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/library/documents/upload",
      payload: { fileName: "test.exe", content: "binary" },
    });
    expect(res.statusCode).toBe(415);
  });

  it("POST /api/library/documents/upload handles binary documents", async () => {
    mockIsBinaryDocument.mockReturnValue(true);
    mockParseBinaryDocument.mockResolvedValue("Extracted text from PDF");
    mockLearnFromContent.mockResolvedValue({
      source: { id: "src-pdf", title: "test.pdf" },
      chunksStored: 5,
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/library/documents/upload",
      payload: {
        fileName: "test.pdf",
        content: Buffer.from("fake pdf content").toString("base64"),
        mimeType: "application/pdf",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it("POST /api/library/documents/upload returns 422 when binary extraction yields empty text", async () => {
    mockIsBinaryDocument.mockReturnValue(true);
    mockParseBinaryDocument.mockResolvedValue("   ");

    const res = await app.inject({
      method: "POST",
      url: "/api/library/documents/upload",
      payload: {
        fileName: "empty.pdf",
        content: Buffer.from("fake").toString("base64"),
        mimeType: "application/pdf",
      },
    });
    expect(res.statusCode).toBe(422);
  });

  // --- POST /api/library/documents/url ---

  it("POST /api/library/documents/url learns from a URL", async () => {
    mockFetchPageAsMarkdown.mockResolvedValue({ title: "Example", markdown: "# Hello" });
    mockLearnFromContent.mockResolvedValue({
      source: { id: "src-url", title: "Example", url: "https://example.com" },
      chunksStored: 2,
      skipped: false,
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/library/documents/url",
      payload: { url: "https://example.com" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.chunks).toBe(2);
  });

  it("POST /api/library/documents/url returns 422 when page cannot be fetched", async () => {
    mockFetchPageAsMarkdown.mockResolvedValue(null);

    const res = await app.inject({
      method: "POST",
      url: "/api/library/documents/url",
      payload: { url: "https://example.com/bad" },
    });
    expect(res.statusCode).toBe(422);
  });

  it("POST /api/library/documents/url with crawl discovers sub-pages", async () => {
    mockFetchPageAsMarkdown.mockResolvedValue({ title: "Docs", markdown: "# Docs" });
    mockLearnFromContent.mockResolvedValue({
      source: { id: "src-url", title: "Docs", url: "https://docs.example.com" },
      chunksStored: 1,
      skipped: false,
    });
    mockDiscoverSubPages.mockResolvedValue(["https://docs.example.com/page1", "https://docs.example.com/page2"]);
    mockRunCrawlInBackground.mockResolvedValue(undefined);

    const res = await app.inject({
      method: "POST",
      url: "/api/library/documents/url",
      payload: { url: "https://docs.example.com", crawl: true },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.crawling).toBe(true);
    expect(body.subPages).toBe(2);
  });

  it("POST /api/library/documents/url shows skipped when already learned", async () => {
    mockFetchPageAsMarkdown.mockResolvedValue({ title: "Example", markdown: "# Hello" });
    mockLearnFromContent.mockResolvedValue({
      source: { id: "src-url", title: "Example", url: "https://example.com" },
      chunksStored: 0,
      skipped: true,
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/library/documents/url",
      payload: { url: "https://example.com" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().skipped).toBe(true);
  });

  // --- GET /api/library/documents/crawl-status ---

  it("GET /api/library/documents/crawl-status returns crawl jobs", async () => {
    mockListJobs.mockReturnValue([
      { type: "crawl", label: "https://example.com", status: "running", progress: 50, startedAt: "2026-01-01" },
    ]);

    const res = await app.inject({ method: "GET", url: "/api/library/documents/crawl-status" });
    expect(res.statusCode).toBe(200);
    expect(res.json().jobs).toHaveLength(1);
    expect(res.json().jobs[0].status).toBe("running");
  });

  // --- POST /api/library/documents/reindex ---

  it("POST /api/library/documents/reindex re-indexes all sources", async () => {
    mockReindexAllSources.mockResolvedValue(5);

    const res = await app.inject({ method: "POST", url: "/api/library/documents/reindex" });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(res.json().reindexed).toBe(5);
  });

  it("POST /api/library/documents/reindex handles error", async () => {
    mockReindexAllSources.mockRejectedValue(new Error("Reindex failed"));

    const res = await app.inject({ method: "POST", url: "/api/library/documents/reindex" });
    expect(res.statusCode).toBe(500);
  });

  // --- POST /api/library/documents/:id/crawl ---

  it("POST /api/library/documents/:id/crawl triggers crawl for source", async () => {
    mockListSources.mockReturnValue([MOCK_SOURCE]);
    mockDiscoverSubPages.mockResolvedValue(["https://example.com/sub1"]);
    mockRunCrawlInBackground.mockResolvedValue(undefined);

    const res = await app.inject({ method: "POST", url: "/api/library/documents/src-1/crawl" });
    expect(res.statusCode).toBe(200);
    expect(res.json().crawling).toBe(true);
  });

  it("POST /api/library/documents/:id/crawl returns 404 for unknown source", async () => {
    mockListSources.mockReturnValue([]);

    const res = await app.inject({ method: "POST", url: "/api/library/documents/nonexistent/crawl" });
    expect(res.statusCode).toBe(404);
  });

  it("POST /api/library/documents/:id/crawl reports no sub-pages", async () => {
    mockListSources.mockReturnValue([MOCK_SOURCE]);
    mockDiscoverSubPages.mockResolvedValue([]);

    const res = await app.inject({ method: "POST", url: "/api/library/documents/src-1/crawl" });
    expect(res.statusCode).toBe(200);
    expect(res.json().subPages).toBe(0);
  });

  // --- POST /api/library/documents/:id/reindex ---

  it("POST /api/library/documents/:id/reindex re-indexes a single source", async () => {
    mockReindexSource.mockResolvedValue(3);

    const res = await app.inject({ method: "POST", url: "/api/library/documents/src-1/reindex" });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(res.json().chunks).toBe(3);
  });

  it("POST /api/library/documents/:id/reindex returns 404 when source not found", async () => {
    mockReindexSource.mockRejectedValue(new Error("Source not found: nonexistent"));

    const res = await app.inject({ method: "POST", url: "/api/library/documents/nonexistent/reindex" });
    expect(res.statusCode).toBe(404);
  });

  // --- GET /api/library/findings ---

  it("GET /api/library/findings returns all findings", async () => {
    mockListFindings.mockReturnValue([MOCK_FINDING]);

    const res = await app.inject({ method: "GET", url: "/api/library/findings" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe("finding-1");
  });

  it("GET /api/library/findings?watchId=x filters by watch", async () => {
    mockListFindingsForWatch.mockReturnValue([MOCK_FINDING]);

    const res = await app.inject({ method: "GET", url: "/api/library/findings?watchId=watch-1" });
    expect(res.statusCode).toBe(200);
    expect(mockListFindingsForWatch).toHaveBeenCalledWith(expect.anything(), "watch-1");
  });

  // --- GET /api/library/findings/:id ---

  it("GET /api/library/findings/:id returns a finding", async () => {
    mockGetFinding.mockReturnValue(MOCK_FINDING);

    const res = await app.inject({ method: "GET", url: "/api/library/findings/finding-1" });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe("finding-1");
  });

  it("GET /api/library/findings/:id returns 404 for unknown finding", async () => {
    mockGetFinding.mockReturnValue(null);

    const res = await app.inject({ method: "GET", url: "/api/library/findings/nonexistent" });
    expect(res.statusCode).toBe(404);
  });

  // --- DELETE /api/library/findings/:id ---

  it("DELETE /api/library/findings/:id deletes a finding", async () => {
    mockGetFinding.mockReturnValue(MOCK_FINDING);

    const res = await app.inject({ method: "DELETE", url: "/api/library/findings/finding-1" });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(mockDeleteFinding).toHaveBeenCalled();
  });

  it("DELETE /api/library/findings/:id returns 404 for unknown finding", async () => {
    mockGetFinding.mockReturnValue(null);

    const res = await app.inject({ method: "DELETE", url: "/api/library/findings/nonexistent" });
    expect(res.statusCode).toBe(404);
  });

  // --- GET /api/library/profile ---

  it("GET /api/library/profile returns profile summary", async () => {
    mockListBeliefs.mockReturnValue([
      { ...MOCK_BELIEF, statement: "User name is Alex, lives in SF", type: "factual" },
      { ...MOCK_BELIEF, id: "b2", statement: "User prefers concise reports", type: "preference" },
      { ...MOCK_BELIEF, id: "b3", statement: "User is interested in crypto and bitcoin", type: "preference" },
      { ...MOCK_BELIEF, id: "b4", statement: "User has a visa appointment pending", type: "factual" },
      { ...MOCK_BELIEF, id: "b5", statement: "User is married, wife Monica", type: "factual" },
    ]);

    const res = await app.inject({ method: "GET", url: "/api/library/profile" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totalBeliefs).toBe(5);
    expect(body.summary).toContain("**Identity:**");
    expect(body.summary).toContain("**Relationships:**");
    expect(body.summary).toContain("**Interests:**");
    expect(body.summary).toContain("**Style:**");
    expect(body.summary).toContain("**Current:**");
    expect(body.categories).toBeDefined();
  });

  it("GET /api/library/profile returns empty when no beliefs", async () => {
    mockListBeliefs.mockReturnValue([]);

    const res = await app.inject({ method: "GET", url: "/api/library/profile" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totalBeliefs).toBe(0);
    expect(body.summary).toBe("");
  });

  // --- GET /api/library/stats ---

  it("GET /api/library/stats returns combined stats", async () => {
    mockMemoryStats.mockReturnValue({ totalBeliefs: 10, activeBeliefs: 8 });
    mockListSources.mockReturnValue([MOCK_SOURCE, MOCK_SOURCE]);
    mockListFindings.mockReturnValue([MOCK_FINDING]);

    const res = await app.inject({ method: "GET", url: "/api/library/stats" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totalBeliefs).toBe(10);
    expect(body.documentsCount).toBe(2);
    expect(body.findingsCount).toBe(1);
  });
});

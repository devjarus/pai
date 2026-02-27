import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import { registerMemoryRoutes } from "../src/routes/memory.js";
import { registerAgentRoutes, threadMigrations } from "../src/routes/agents.js";
import { registerConfigRoutes } from "../src/routes/config.js";
import { registerTaskRoutes } from "../src/routes/tasks.js";
import { registerAuthRoutes } from "../src/routes/auth.js";
import { registerInboxRoutes } from "../src/routes/inbox.js";
import { registerJobRoutes } from "../src/routes/jobs.js";
import type { ServerContext } from "../src/index.js";
import jwt from "jsonwebtoken";

// ---------------------------------------------------------------------------
// Mock @personal-ai/core — isolate route handlers from real storage/LLM
// ---------------------------------------------------------------------------
vi.mock("@personal-ai/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@personal-ai/core")>();
  const threadHelpers = await import("../../core/src/threads.js");
  return {
    ...actual,
    // Explicitly forward thread helpers to avoid mock export issues
    ensureThread: threadHelpers.ensureThread,
    listMessages: threadHelpers.listMessages,
    listThreads: threadHelpers.listThreads,
    createThread: threadHelpers.createThread,
    appendMessages: threadHelpers.appendMessages,
    clearThread: threadHelpers.clearThread,
    deleteThread: threadHelpers.deleteThread,
    getThread: threadHelpers.getThread,
    withThreadLock: threadHelpers.withThreadLock,
    threadMigrations: threadHelpers.threadMigrations,
    consolidateConversation: actual.consolidateConversation,
    listBeliefs: vi.fn(),
    searchBeliefs: vi.fn(),
    semanticSearch: vi.fn(),
    forgetBelief: vi.fn(),
    memoryStats: vi.fn(),
    remember: vi.fn(),
    getMemoryContext: vi.fn().mockResolvedValue(""),
    hasOwner: (...args: unknown[]) => mockHasOwner(...args),
    createOwner: (...args: unknown[]) => mockCreateOwner(...args),
    getOwner: (...args: unknown[]) => mockGetOwner(...args),
    verifyOwnerPassword: (...args: unknown[]) => mockVerifyOwnerPassword(...args),
    getJwtSecret: (...args: unknown[]) => mockGetJwtSecret(...args),
    authMigrations: [],
    writeConfig: (...args: unknown[]) => mockWriteConfig(...args),
    loadConfigFile: (...args: unknown[]) => mockLoadConfigFile(...args),
  };
});

// ---------------------------------------------------------------------------
// Auth mock functions
// ---------------------------------------------------------------------------
const mockHasOwner = vi.fn();
const mockCreateOwner = vi.fn();
const mockGetOwner = vi.fn();
const mockVerifyOwnerPassword = vi.fn();
const mockGetJwtSecret = vi.fn().mockReturnValue("test-secret-key-for-jwt-testing-1234567890");

// ---------------------------------------------------------------------------
// Config mock functions
// ---------------------------------------------------------------------------
const mockWriteConfig = vi.fn();
const mockLoadConfigFile = vi.fn().mockReturnValue({});

// ---------------------------------------------------------------------------
// Mock @personal-ai/plugin-tasks — isolate task route handlers
// ---------------------------------------------------------------------------
const mockAddTask = vi.fn();
const mockListTasks = vi.fn();
const mockCompleteTask = vi.fn();
const mockEditTask = vi.fn();
const mockReopenTask = vi.fn();
const mockDeleteTask = vi.fn();
const mockAddGoal = vi.fn();
const mockListGoals = vi.fn();
const mockCompleteGoal = vi.fn();
const mockDeleteGoal = vi.fn();

vi.mock("@personal-ai/plugin-tasks", () => ({
  addTask: (...args: unknown[]) => mockAddTask(...args),
  listTasks: (...args: unknown[]) => mockListTasks(...args),
  completeTask: (...args: unknown[]) => mockCompleteTask(...args),
  editTask: (...args: unknown[]) => mockEditTask(...args),
  reopenTask: (...args: unknown[]) => mockReopenTask(...args),
  deleteTask: (...args: unknown[]) => mockDeleteTask(...args),
  addGoal: (...args: unknown[]) => mockAddGoal(...args),
  listGoals: (...args: unknown[]) => mockListGoals(...args),
  completeGoal: (...args: unknown[]) => mockCompleteGoal(...args),
  deleteGoal: (...args: unknown[]) => mockDeleteGoal(...args),
}));

// ---------------------------------------------------------------------------
// Mock "ai" module — streamText + createUIMessageStream used by chat route
// ---------------------------------------------------------------------------
const mockStreamText = vi.fn();
const mockCreateUIMessageStream = vi.fn();
const mockStepCountIs = vi.fn().mockReturnValue(() => false);

vi.mock("ai", () => ({
  streamText: (...args: unknown[]) => mockStreamText(...args),
  createUIMessageStream: (...args: unknown[]) => mockCreateUIMessageStream(...args),
  createUIMessageStreamResponse: ({ stream }: { stream: ReadableStream }) =>
    new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8" } }),
  stepCountIs: (...args: unknown[]) => mockStepCountIs(...args),
  generateText: vi.fn().mockResolvedValue({ text: "" }),
  tool: (def: unknown) => def,
}));

// ---------------------------------------------------------------------------
// Mock briefing module — isolate inbox route handlers
// ---------------------------------------------------------------------------
const mockGetLatestBriefing = vi.fn();
const mockGetBriefingById = vi.fn();
const mockListBriefings = vi.fn();
const mockGenerateBriefing = vi.fn();
const mockClearAllBriefings = vi.fn();
const mockListAllBriefings = vi.fn();
const mockGetResearchBriefings = vi.fn();

vi.mock("../src/briefing.js", () => ({
  getLatestBriefing: (...args: unknown[]) => mockGetLatestBriefing(...args),
  getBriefingById: (...args: unknown[]) => mockGetBriefingById(...args),
  listBriefings: (...args: unknown[]) => mockListBriefings(...args),
  generateBriefing: (...args: unknown[]) => mockGenerateBriefing(...args),
  clearAllBriefings: (...args: unknown[]) => mockClearAllBriefings(...args),
  listAllBriefings: (...args: unknown[]) => mockListAllBriefings(...args),
  getResearchBriefings: (...args: unknown[]) => mockGetResearchBriefings(...args),
  briefingMigrations: [],
}));

// ---------------------------------------------------------------------------
// Mock @personal-ai/plugin-research — isolate job route handlers
// ---------------------------------------------------------------------------
const mockListResearchJobs = vi.fn();
const mockGetResearchJob = vi.fn();
const mockClearCompletedJobs = vi.fn();

vi.mock("@personal-ai/plugin-research", () => ({
  listResearchJobs: (...args: unknown[]) => mockListResearchJobs(...args),
  getResearchJob: (...args: unknown[]) => mockGetResearchJob(...args),
  clearCompletedJobs: (...args: unknown[]) => mockClearCompletedJobs(...args),
}));

/**
 * Set up the default AI SDK mocks. `streamText` triggers `onFinish` synchronously
 * so that conversation history is saved, and returns a mock `toUIMessageStream`.
 * `createUIMessageStream` calls the `execute` callback then returns a Node-friendly
 * ReadableStream that Fastify's inject can consume.
 */
function setupDefaultAIMocks(responseText = "Hello from AI"): void {
  mockStreamText.mockImplementation((opts: Record<string, unknown>) => {
    // Trigger onFinish so history gets saved
    const onFinish = opts?.onFinish as ((result: { text: string; steps: unknown[] }) => void) | undefined;
    if (onFinish) {
      onFinish({ text: responseText, steps: [{}] });
    }
    return {
      toUIMessageStream: vi.fn().mockReturnValue(
        new ReadableStream({
          start(controller) {
            controller.enqueue(`0:${JSON.stringify(responseText)}\n`);
            controller.close();
          },
        }),
      ),
    };
  });

  mockCreateUIMessageStream.mockImplementation(
    ({ execute, onError }: { execute: (ctx: { writer: { write: unknown; merge: unknown } }) => Promise<void>; onError?: (e: unknown) => string }) => {
      const chunks: string[] = [];
      const mockWriter = {
        write: vi.fn(),
        merge: vi.fn().mockImplementation((stream: ReadableStream) => {
          // Read the stream and collect chunks
          const reader = stream.getReader();
          const pump = (): Promise<void> =>
            reader.read().then(({ done, value }) => {
              if (done) return;
              chunks.push(typeof value === "string" ? value : new TextDecoder().decode(value));
              return pump();
            });
          pump().catch(() => {});
        }),
      };

      // Execute the callback (async but we handle errors)
      try {
        const result = execute({ writer: mockWriter });
        if (result && typeof result.then === "function") {
          result.catch((e: unknown) => {
            if (onError) onError(e);
          });
        }
      } catch (e) {
        if (onError) onError(e);
      }

      // Return a simple ReadableStream with the collected text
      const encoder = new TextEncoder();
      return new ReadableStream({
        start(controller) {
          // Use a microtask to let the execute callback's async merge run
          queueMicrotask(() => {
            const body = chunks.length > 0 ? chunks.join("") : `0:${JSON.stringify(responseText)}\n`;
            controller.enqueue(encoder.encode(body));
            controller.close();
          });
        },
      });
    },
  );
}

import {
  listBeliefs,
  searchBeliefs,
  semanticSearch,
  forgetBelief,
  memoryStats,
  remember,
  activeJobs,
} from "@personal-ai/core";

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
};

const MOCK_BELIEF_FACTUAL = {
  ...MOCK_BELIEF,
  id: "belief_def456",
  statement: "Project uses SQLite with WAL mode",
  type: "factual",
  confidence: 0.95,
};

/**
 * Create an in-memory SQLite-like storage mock that supports threads.
 * Uses simple Maps to simulate tables for testing.
 */
function createMockStorage() {
  const threads = new Map<string, Record<string, unknown>>();
  const threadMessages = new Map<string, Array<Record<string, unknown>>>();

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query: vi.fn().mockImplementation((sql: string, params?: unknown[]): any[] => {
      if (sql.includes("FROM threads") && sql.includes("ORDER BY")) {
        const userId = params?.[0] as string | undefined;
        const all = [...threads.values()].filter((t) => !userId || t.user_id === userId);
        return all.sort(
          (a, b) => new Date(b.updated_at as string).getTime() - new Date(a.updated_at as string).getTime(),
        );
      }
      if (sql.includes("FROM threads") && sql.includes("WHERE id")) {
        const id = params?.[0] as string;
        const t = threads.get(id);
        if (sql.includes("SELECT *")) return t ? [t] : [];
        return t ? [{ id: t.id }] : [];
      }
      if (sql.includes("FROM thread_messages") && sql.includes("MAX(sequence)")) {
        const id = params?.[0] as string;
        const msgs = threadMessages.get(id) ?? [];
        const maxSeq = msgs.reduce((max, m) => Math.max(max, (m.sequence as number) ?? 0), 0);
        return [{ seq: maxSeq }];
      }
      if (sql.includes("FROM thread_messages") && sql.includes("COUNT(*)") && sql.includes("role = 'user'")) {
        const id = params?.[0] as string;
        const msgs = threadMessages.get(id) ?? [];
        const count = msgs.filter((m) => m.role === "user").length;
        return [{ count }];
      }
      if (sql.includes("FROM thread_messages") && sql.includes("COUNT(*)")) {
        const id = params?.[0] as string;
        const msgs = threadMessages.get(id) ?? [];
        return [{ count: msgs.length }];
      }
      if (sql.includes("FROM thread_messages") && sql.includes("SELECT sequence")) {
        const id = params?.[0] as string;
        for (const msgs of threadMessages.values()) {
          const match = msgs.find((m) => m.id === id);
          if (match) return [{ sequence: match.sequence }];
        }
        return [];
      }
      if (sql.includes("FROM thread_messages") && sql.includes("ORDER BY sequence DESC")) {
        const threadId = params?.[0] as string;
        const hasBefore = sql.includes("sequence < ?");
        const before = hasBefore ? (params?.[1] as number | undefined) : undefined;
        const limit = hasBefore ? (params?.[2] as number | undefined) : (params?.[1] as number | undefined);
        let msgs = (threadMessages.get(threadId) ?? []).slice();
        if (before) msgs = msgs.filter((m) => (m.sequence as number) < before);
        msgs.sort((a, b) => (b.sequence as number) - (a.sequence as number));
        if (limit) msgs = msgs.slice(0, limit);
        return msgs;
      }
      return [];
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    run: vi.fn().mockImplementation((sql: string, params?: unknown[]): any => {
      if (sql.startsWith("INSERT INTO threads")) {
        const [id, title, agent_name, user_id, created_at, updated_at] = params as string[];
        threads.set(id, { id, title, agent_name, user_id, created_at, updated_at, message_count: 0 });
      }
      if (sql.startsWith("INSERT INTO thread_messages")) {
        const [id, thread_id, role, content, parts_json, created_at, sequence] = params as [string, string, string, string, string | null, string, number];
        const msgs = threadMessages.get(thread_id) ?? [];
        msgs.push({ id, thread_id, role, content, parts_json, created_at, sequence });
        threadMessages.set(thread_id, msgs);
      }
      if (sql.includes("DELETE FROM thread_messages WHERE thread_id")) {
        const id = params?.[0] as string;
        threadMessages.delete(id);
      }
      if (sql.includes("DELETE FROM thread_messages WHERE id IN")) {
        const [threadId, toDelete] = params as [string, number];
        const msgs = (threadMessages.get(threadId) ?? []).slice().sort((a, b) => (a.sequence as number) - (b.sequence as number));
        const remaining = msgs.slice(toDelete);
        threadMessages.set(threadId, remaining);
      }
      if (sql.includes("DELETE FROM threads")) {
        const id = params?.[0] as string;
        threads.delete(id);
        threadMessages.delete(id);
      }
      if (sql.includes("UPDATE threads SET title")) {
        const [title, id] = params as string[];
        const t = threads.get(id);
        if (t) t.title = title;
      }
      if (sql.includes("UPDATE threads SET updated_at") && sql.includes("message_count = 0")) {
        const [updated_at, id] = params as [string, string];
        const t = threads.get(id);
        if (t) {
          t.updated_at = updated_at;
          t.message_count = 0;
        }
      } else if (sql.includes("UPDATE threads SET updated_at") && sql.includes("title = CASE")) {
        const [updated_at, message_count, title, id] = params as [string, number, string, string];
        const t = threads.get(id);
        if (t) {
          t.updated_at = updated_at;
          t.message_count = message_count;
          if (t.title === "New conversation") t.title = title;
        }
      } else if (sql.includes("UPDATE threads SET updated_at")) {
        const [updated_at, message_count, id] = params as [string, number, string];
        const t = threads.get(id);
        if (t) {
          t.updated_at = updated_at;
          t.message_count = message_count;
        }
      }
      return { changes: 1 };
    }),
    close: vi.fn(),
    migrate: vi.fn(),
    db: {
      transaction: (fn: () => void) => () => fn(),
    },
  };
}

function createMockServerCtx(): ServerContext {
  const storage = createMockStorage();
  return {
    ctx: {
      config: {
        dataDir: "/tmp/test",
        logLevel: "silent" as const,
        llm: {
          provider: "ollama" as const,
          model: "llama3.2",
          baseUrl: "http://127.0.0.1:11434",
          fallbackMode: "local-first" as const,
        },
        plugins: ["memory", "tasks"],
      },
      storage: storage as any,
      llm: {
        chat: vi.fn().mockResolvedValue({
          text: "Hello from AI",
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        }),
        streamChat: vi.fn(),
        embed: vi.fn().mockResolvedValue({ embedding: [0.1, 0.2, 0.3] }),
        health: vi.fn().mockResolvedValue({ ok: true, provider: "ollama" }),
        getModel: vi.fn().mockReturnValue({}),
      },
      logger: {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
      },
    },
    agents: [
      {
        name: "assistant",
        version: "0.1.0",
        migrations: [],
        commands: () => [],
        agent: {
          displayName: "Test Assistant",
          description: "A test assistant for unit tests",
          systemPrompt: "You are a helpful assistant.",
          capabilities: ["general", "memory"],
          createTools: vi.fn().mockReturnValue(undefined),
          afterResponse: vi.fn().mockResolvedValue(undefined),
        },
      },
    ],
    reinitialize: vi.fn(),
    telegramBot: null,
    telegramStatus: { running: false },
    startTelegramBot: vi.fn(),
    stopTelegramBot: vi.fn(),
    authEnabled: true,
  };
}

/** Mirror the production error handler so thrown Zod validation errors return { error: message }. */
function addTestErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: { statusCode?: number; message: string }, _request, reply) => {
    const statusCode = error.statusCode ?? 500;
    reply.status(statusCode).send({
      error: statusCode >= 500 ? "Internal server error" : error.message,
    });
  });
}

// ==========================================================================
// Memory Routes
// ==========================================================================

describe("memory routes", () => {
  let app: FastifyInstance;
  let serverCtx: ServerContext;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    addTestErrorHandler(app);
    serverCtx = createMockServerCtx();
    registerMemoryRoutes(app, serverCtx);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  // -- GET /api/beliefs ----------------------------------------------------

  it("GET /api/beliefs returns beliefs list", async () => {
    vi.mocked(listBeliefs).mockReturnValue([MOCK_BELIEF, MOCK_BELIEF_FACTUAL]);

    const res = await app.inject({ method: "GET", url: "/api/beliefs" });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body).toHaveLength(2);
    expect(body[0].statement).toBe("User prefers Vitest over Jest");
    expect(listBeliefs).toHaveBeenCalledWith(serverCtx.ctx.storage, "active");
  });

  it("GET /api/beliefs defaults to status=active", async () => {
    vi.mocked(listBeliefs).mockReturnValue([]);

    await app.inject({ method: "GET", url: "/api/beliefs" });

    expect(listBeliefs).toHaveBeenCalledWith(serverCtx.ctx.storage, "active");
  });

  it("GET /api/beliefs?status=forgotten passes status through", async () => {
    vi.mocked(listBeliefs).mockReturnValue([]);

    await app.inject({ method: "GET", url: "/api/beliefs?status=forgotten" });

    expect(listBeliefs).toHaveBeenCalledWith(serverCtx.ctx.storage, "forgotten");
  });

  it("GET /api/beliefs?type=preference filters by type", async () => {
    vi.mocked(listBeliefs).mockReturnValue([MOCK_BELIEF, MOCK_BELIEF_FACTUAL]);

    const res = await app.inject({
      method: "GET",
      url: "/api/beliefs?type=preference",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body).toHaveLength(1);
    expect(body[0].type).toBe("preference");
  });

  it("GET /api/beliefs?type=procedural returns empty when no match", async () => {
    vi.mocked(listBeliefs).mockReturnValue([MOCK_BELIEF, MOCK_BELIEF_FACTUAL]);

    const res = await app.inject({
      method: "GET",
      url: "/api/beliefs?type=procedural",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body).toHaveLength(0);
  });

  // -- GET /api/beliefs/:id ------------------------------------------------

  it("GET /api/beliefs/:id returns single belief by full ID", async () => {
    vi.mocked(listBeliefs).mockReturnValue([MOCK_BELIEF, MOCK_BELIEF_FACTUAL]);

    const res = await app.inject({
      method: "GET",
      url: `/api/beliefs/${MOCK_BELIEF.id}`,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.id).toBe(MOCK_BELIEF.id);
    expect(body.statement).toBe("User prefers Vitest over Jest");
  });

  it("GET /api/beliefs/:id supports prefix matching", async () => {
    vi.mocked(listBeliefs).mockReturnValue([MOCK_BELIEF, MOCK_BELIEF_FACTUAL]);

    const res = await app.inject({
      method: "GET",
      url: "/api/beliefs/belief_abc",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.id).toBe(MOCK_BELIEF.id);
  });

  it("GET /api/beliefs/:id returns 404 when not found", async () => {
    vi.mocked(listBeliefs).mockReturnValue([MOCK_BELIEF]);

    const res = await app.inject({
      method: "GET",
      url: "/api/beliefs/nonexistent_id",
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.payload);
    expect(body.error).toBe("Belief not found");
  });

  // -- GET /api/search -----------------------------------------------------

  it("GET /api/search?q=test returns semantic search results", async () => {
    // semanticSearch returns { beliefId, similarity, ... }
    vi.mocked(semanticSearch).mockReturnValue([
      { beliefId: MOCK_BELIEF.id, similarity: 0.85 },
    ]);
    // The route then queries storage for full belief objects
    vi.mocked(serverCtx.ctx.storage.query).mockImplementation((sql: string, params?: unknown[]) => {
      if (typeof sql === "string" && sql.includes("FROM beliefs WHERE id")) {
        const id = (params as string[])?.[0];
        if (id === MOCK_BELIEF.id) return [MOCK_BELIEF];
      }
      return [];
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/search?q=testing+framework",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body).toHaveLength(1);
    expect(body[0].similarity).toBe(0.85);
    expect(body[0].statement).toBe(MOCK_BELIEF.statement);
    expect(serverCtx.ctx.llm.embed).toHaveBeenCalledWith("testing framework");
  });

  it("GET /api/search filters out low-similarity results", async () => {
    vi.mocked(semanticSearch).mockReturnValue([
      { beliefId: MOCK_BELIEF.id, similarity: 0.85 },
      { beliefId: MOCK_BELIEF_FACTUAL.id, similarity: 0.1 }, // below threshold
    ]);
    // The route queries storage for full beliefs — only high-similarity ones should appear
    vi.mocked(serverCtx.ctx.storage.query).mockImplementation((sql: string, params?: unknown[]) => {
      if (typeof sql === "string" && sql.includes("FROM beliefs WHERE id")) {
        const id = (params as string[])?.[0];
        if (id === MOCK_BELIEF.id) return [MOCK_BELIEF];
        if (id === MOCK_BELIEF_FACTUAL.id) return [MOCK_BELIEF_FACTUAL];
      }
      return [];
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/search?q=test",
    });

    const body = JSON.parse(res.payload);
    expect(body).toHaveLength(2);
    expect(body[0].similarity).toBe(0.85);
    expect(body[1].similarity).toBe(0.1);
  });

  it("GET /api/search falls back to FTS when embedding fails", async () => {
    vi.mocked(serverCtx.ctx.llm.embed).mockRejectedValueOnce(new Error("Embedding unavailable"));
    vi.mocked(searchBeliefs).mockReturnValue([MOCK_BELIEF]);

    const res = await app.inject({
      method: "GET",
      url: "/api/search?q=vitest",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body).toHaveLength(1);
    expect(searchBeliefs).toHaveBeenCalledWith(serverCtx.ctx.storage, "vitest");
  });

  it("GET /api/search with no query returns empty array", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/search",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body).toEqual([]);
    expect(serverCtx.ctx.llm.embed).not.toHaveBeenCalled();
  });

  it("GET /api/search?q= with empty string returns empty array", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/search?q=",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body).toEqual([]);
  });

  // -- GET /api/stats ------------------------------------------------------

  it("GET /api/stats returns memory stats", async () => {
    const stats = {
      totalBeliefs: 42,
      activeBeliefs: 38,
      forgottenBeliefs: 4,
      totalEpisodes: 100,
      averageConfidence: 0.75,
    };
    vi.mocked(memoryStats).mockReturnValue(stats);

    const res = await app.inject({ method: "GET", url: "/api/stats" });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.totalBeliefs).toBe(42);
    expect(body.activeBeliefs).toBe(38);
    expect(memoryStats).toHaveBeenCalledWith(serverCtx.ctx.storage);
  });

  // -- POST /api/remember --------------------------------------------------

  it("POST /api/remember stores observation and returns result", async () => {
    const rememberResult = {
      episode: { id: "ep_001", content: "test observation" },
      beliefs: [MOCK_BELIEF],
    };
    vi.mocked(remember).mockResolvedValue(rememberResult);

    const res = await app.inject({
      method: "POST",
      url: "/api/remember",
      payload: { text: "test observation" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.episode.id).toBe("ep_001");
    expect(body.beliefs).toHaveLength(1);
    expect(remember).toHaveBeenCalledWith(
      serverCtx.ctx.storage,
      serverCtx.ctx.llm,
      "test observation",
      serverCtx.ctx.logger,
    );
  });

  it("POST /api/remember without text returns 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/remember",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.error.toLowerCase()).toContain("required");
    expect(remember).not.toHaveBeenCalled();
  });

  it("POST /api/remember with null body returns 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/remember",
      headers: { "content-type": "application/json" },
      payload: "null",
    });

    expect(res.statusCode).toBe(400);
  });

  // -- POST /api/forget/:id ------------------------------------------------

  it("POST /api/forget/:id calls forgetBelief and returns ok", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/forget/belief_abc123",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.ok).toBe(true);
    expect(forgetBelief).toHaveBeenCalledWith(serverCtx.ctx.storage, "belief_abc123");
  });
});

// ==========================================================================
// Agent Routes
// ==========================================================================

describe("agent routes", () => {
  let app: FastifyInstance;
  let serverCtx: ServerContext;

  beforeEach(async () => {
    vi.clearAllMocks();
    setupDefaultAIMocks();
    app = Fastify();
    // Fastify needs an error hook to gracefully handle streaming response errors in inject mode
    app.addHook("onError", (_req, _reply, _error, done) => { done(); });
    serverCtx = createMockServerCtx();
    registerAgentRoutes(app, serverCtx);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  // -- GET /api/agents -----------------------------------------------------

  it("GET /api/agents returns agent list", async () => {
    const res = await app.inject({ method: "GET", url: "/api/agents" });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body).toHaveLength(1);
    expect(body[0]).toEqual({
      name: "assistant",
      displayName: "Test Assistant",
      description: "A test assistant for unit tests",
      capabilities: ["general", "memory"],
    });
  });

  it("GET /api/agents with multiple agents returns all", async () => {
    serverCtx.agents.push({
      name: "coder",
      version: "0.1.0",
      migrations: [],
      commands: () => [],
      agent: {
        displayName: "Code Agent",
        description: "Writes code",
        systemPrompt: "You write code.",
        capabilities: ["coding"],
      },
    });

    // Re-create app with updated context
    await app.close();
    app = Fastify();
    registerAgentRoutes(app, serverCtx);
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/api/agents" });
    const body = JSON.parse(res.payload);
    expect(body).toHaveLength(2);
    expect(body[1].name).toBe("coder");
    expect(body[1].capabilities).toEqual(["coding"]);
  });

  // -- POST /api/chat ------------------------------------------------------

  it("POST /api/chat returns stream response", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: "Hello, how are you?" },
    });

    expect(res.statusCode).toBe(200);
    expect(mockCreateUIMessageStream).toHaveBeenCalled();
    expect(mockStreamText).toHaveBeenCalled();
  });

  it("POST /api/chat auto-creates thread and returns X-Thread-Id", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: "Hello from new thread" },
    });

    expect(res.statusCode).toBe(200);
    const headerId = res.headers["x-thread-id"] as string | undefined;
    expect(headerId).toBeDefined();
    expect(headerId).toMatch(/^thread-/);

    const threadsRes = await app.inject({ method: "GET", url: "/api/threads" });
    const threads = JSON.parse(threadsRes.payload) as Array<{ id: string }>;
    expect(threads.some((t) => t.id === headerId)).toBe(true);
  });

  it("POST /api/chat calls createTools on agent", async () => {
    await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: "test message" },
    });

    const createTools = serverCtx.agents[0].agent.createTools;
    expect(createTools).toHaveBeenCalled();
  });

  it("POST /api/chat passes tools from agent to streamText", async () => {
    const mockTools = { memory_recall: { description: "Recall memory", parameters: {} } };
    vi.mocked(serverCtx.agents[0].agent.createTools!).mockReturnValue(mockTools as any);

    await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: "What do I like?" },
    });

    expect(mockStreamText).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.objectContaining(mockTools),
        toolChoice: "auto",
      }),
    );
  });

  it("POST /api/chat without message returns 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.error).toBe("message is required");
  });

  it("POST /api/chat handles LLM error gracefully", async () => {
    mockStreamText.mockImplementation(() => {
      throw new Error("LLM timeout");
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: "test" },
    });

    // Stream is still returned (200) — error is handled via onError callback
    expect(res.statusCode).toBe(200);
    expect(mockCreateUIMessageStream).toHaveBeenCalledWith(
      expect.objectContaining({
        onError: expect.any(Function),
      }),
    );
  });

  it("POST /api/chat selects agent by name", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: "hi", agent: "assistant" },
    });

    expect(res.statusCode).toBe(200);
    expect(mockStreamText).toHaveBeenCalled();
  });

  it("POST /api/chat returns 404 for unknown agent", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: "hi", agent: "nonexistent" },
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.payload);
    expect(body.error).toBe("Agent not found");
  });

  it("POST /api/chat works when createTools returns undefined", async () => {
    vi.mocked(serverCtx.agents[0].agent.createTools!).mockReturnValue(undefined as any);

    const res = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: "test" },
    });

    expect(res.statusCode).toBe(200);
    expect(mockStreamText).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: undefined,
        toolChoice: undefined,
      }),
    );
  });

  // -- Thread persistence --------------------------------------------------

  it("POST /api/chat uses pre-created thread", async () => {
    // Create thread first via POST /api/threads
    const createRes = await app.inject({
      method: "POST",
      url: "/api/threads",
      payload: { title: "Test Thread" },
    });
    const thread = JSON.parse(createRes.payload);

    await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: "Hello", sessionId: thread.id },
    });

    // Should have called streamText
    expect(mockStreamText).toHaveBeenCalled();
  });

  it("POST /api/chat persists messages to thread_messages", async () => {
    // Pre-create thread
    const createRes = await app.inject({
      method: "POST",
      url: "/api/threads",
      payload: { title: "Persist Test" },
    });
    const thread = JSON.parse(createRes.payload);

    await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: "Hello", sessionId: thread.id },
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/threads/${thread.id}/messages`,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body).toHaveLength(2); // user + assistant
    expect(body[0].role).toBe("user");
    expect(body[0].content).toBe("Hello");
    expect(body[1].role).toBe("assistant");
    expect(body[1].content).toBe("Hello from AI");
  });

  // -- GET /api/threads ----------------------------------------------------

  it("GET /api/threads returns persisted threads", async () => {
    // Create a thread first via POST /api/threads
    await app.inject({
      method: "POST",
      url: "/api/threads",
      payload: { title: "Thread List Test" },
    });

    const res = await app.inject({ method: "GET", url: "/api/threads" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.length).toBeGreaterThan(0);
  });

  // -- POST /api/threads ---------------------------------------------------

  it("POST /api/threads creates new thread in storage", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/threads",
      payload: { title: "Test Thread" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.title).toBe("Test Thread");
    expect(body.id).toMatch(/^thread-/);
    expect(body.messageCount).toBe(0);
  });

  // -- DELETE /api/threads/:id ---------------------------------------------

  it("DELETE /api/threads/:id removes thread from storage", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/threads",
      payload: { title: "Delete Me" },
    });
    const thread = JSON.parse(createRes.payload);
    const res = await app.inject({
      method: "DELETE",
      url: `/api/threads/${thread.id}`,
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ ok: true });
    const threadsRes = await app.inject({ method: "GET", url: "/api/threads" });
    const threads = JSON.parse(threadsRes.payload) as Array<{ id: string }>;
    expect(threads.some((t) => t.id === thread.id)).toBe(false);
  });

  // -- GET /api/chat/history -----------------------------------------------

  it("GET /api/chat/history returns empty array initially", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/chat/history?sessionId=fresh-empty",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body).toEqual([]);
  });

  it("GET /api/chat/history returns messages after chat", async () => {
    // Pre-create thread
    const createRes = await app.inject({
      method: "POST",
      url: "/api/threads",
      payload: { title: "History Test" },
    });
    const thread = JSON.parse(createRes.payload);

    await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: "Hello", sessionId: thread.id },
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/chat/history?sessionId=${thread.id}`,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body).toHaveLength(2); // user + assistant
    expect(body[0]).toEqual({ role: "user", content: "Hello" });
    expect(body[1]).toEqual({ role: "assistant", content: "Hello from AI" });
  });

  it("GET /api/chat/history supports sessionId", async () => {
    // Pre-create threads
    const createA = await app.inject({ method: "POST", url: "/api/threads", payload: { title: "A" } });
    const threadA = JSON.parse(createA.payload);
    const createB = await app.inject({ method: "POST", url: "/api/threads", payload: { title: "B" } });
    const threadB = JSON.parse(createB.payload);

    // Chat in session A
    await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: "msg A", sessionId: threadA.id },
    });

    // Chat in session B
    await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: "msg B", sessionId: threadB.id },
    });

    // Fetch session A history
    const resA = await app.inject({
      method: "GET",
      url: `/api/chat/history?sessionId=${threadA.id}`,
    });
    const bodyA = JSON.parse(resA.payload);
    expect(bodyA).toHaveLength(2);
    expect(bodyA[0].content).toBe("msg A");

    // Fetch session B history
    const resB = await app.inject({
      method: "GET",
      url: `/api/chat/history?sessionId=${threadB.id}`,
    });
    const bodyB = JSON.parse(resB.payload);
    expect(bodyB).toHaveLength(2);
    expect(bodyB[0].content).toBe("msg B");
  });

  // -- DELETE /api/chat/history --------------------------------------------

  it("DELETE /api/chat/history clears conversation and returns ok", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/threads",
      payload: { title: "Clear Test" },
    });
    const thread = JSON.parse(createRes.payload);
    await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: "test", sessionId: thread.id },
    });

    // Clear
    const delRes = await app.inject({
      method: "DELETE",
      url: `/api/chat/history?sessionId=${thread.id}`,
    });
    expect(delRes.statusCode).toBe(200);
    expect(JSON.parse(delRes.payload)).toEqual({ ok: true });

    const historyRes = await app.inject({
      method: "GET",
      url: `/api/chat/history?sessionId=${thread.id}`,
    });
    const history = JSON.parse(historyRes.payload);
    expect(history).toEqual([]);
  });

  it("DELETE /api/chat/history with sessionId deletes only that session", async () => {
    const createA = await app.inject({ method: "POST", url: "/api/threads", payload: { title: "A" } });
    const threadA = JSON.parse(createA.payload);
    const createB = await app.inject({ method: "POST", url: "/api/threads", payload: { title: "B" } });
    const threadB = JSON.parse(createB.payload);

    await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: "msg A", sessionId: threadA.id },
    });
    await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: "msg B", sessionId: threadB.id },
    });

    await app.inject({
      method: "DELETE",
      url: `/api/chat/history?sessionId=${threadA.id}`,
    });

    const historyA = await app.inject({
      method: "GET",
      url: `/api/chat/history?sessionId=${threadA.id}`,
    });
    const historyB = await app.inject({
      method: "GET",
      url: `/api/chat/history?sessionId=${threadB.id}`,
    });

    expect(JSON.parse(historyA.payload)).toEqual([]);
    expect(JSON.parse(historyB.payload)).toHaveLength(2);
  });
});

// ==========================================================================
// Config Routes
// ==========================================================================

describe("config routes", () => {
  let app: FastifyInstance;
  let serverCtx: ServerContext;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    serverCtx = createMockServerCtx();
    registerConfigRoutes(app, serverCtx);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("GET /api/config returns config with provider, model, baseUrl", async () => {
    const res = await app.inject({ method: "GET", url: "/api/config" });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.llm.provider).toBe("ollama");
    expect(body.llm.model).toBe("llama3.2");
    expect(body.llm.baseUrl).toBe("http://127.0.0.1:11434");
  });

  it("GET /api/config includes dataDir", async () => {
    const res = await app.inject({ method: "GET", url: "/api/config" });

    const body = JSON.parse(res.payload);
    expect(body.dataDir).toBe("/tmp/test");
  });

  it("GET /api/config omits fallbackMode", async () => {
    const res = await app.inject({ method: "GET", url: "/api/config" });

    const body = JSON.parse(res.payload);
    expect(body.llm.fallbackMode).toBeUndefined();
  });

  it("GET /api/config omits apiKey", async () => {
    // Add an apiKey to config to ensure it's stripped
    (serverCtx.ctx.config.llm as any).apiKey = "sk-secret-key-12345";

    // Re-create app with updated context
    await app.close();
    app = Fastify();
    registerConfigRoutes(app, serverCtx);
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/api/config" });

    const body = JSON.parse(res.payload);
    expect(body.llm.apiKey).toBeUndefined();
    expect(body.llm.provider).toBe("ollama"); // other fields still present
  });

  it("GET /api/config includes logLevel", async () => {
    const res = await app.inject({ method: "GET", url: "/api/config" });

    const body = JSON.parse(res.payload);
    expect(body.logLevel).toBe("silent");
  });
});

// ==========================================================================
// Task Routes
// ==========================================================================

describe("task routes", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify();
    const serverCtx = createMockServerCtx();
    registerTaskRoutes(app, serverCtx);
    await app.ready();

    mockAddTask.mockReset();
    mockListTasks.mockReset();
    mockCompleteTask.mockReset();
    mockEditTask.mockReset();
    mockReopenTask.mockReset();
    mockDeleteTask.mockReset();
    mockAddGoal.mockReset();
    mockListGoals.mockReset();
    mockCompleteGoal.mockReset();
    mockDeleteGoal.mockReset();
  });

  afterEach(async () => {
    await app.close();
  });

  it("GET /api/tasks returns task list", async () => {
    const mockTask = { id: "t1", title: "Test", status: "open", priority: "medium", goal_id: null, due_date: null, created_at: "2026-01-01", completed_at: null, description: null };
    mockListTasks.mockReturnValue([mockTask]);

    const res = await app.inject({ method: "GET", url: "/api/tasks" });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual([mockTask]);
    expect(mockListTasks).toHaveBeenCalledWith(expect.anything(), "open");
  });

  it("GET /api/tasks?status=done filters by status", async () => {
    mockListTasks.mockReturnValue([]);
    const res = await app.inject({ method: "GET", url: "/api/tasks?status=done" });
    expect(res.statusCode).toBe(200);
    expect(mockListTasks).toHaveBeenCalledWith(expect.anything(), "done");
  });

  it("GET /api/tasks?goalId=g1 filters by goal", async () => {
    const task1 = { id: "t1", title: "Task 1", status: "open", priority: "medium", goal_id: "g1", due_date: null, created_at: "2026-01-01", completed_at: null, description: null };
    const task2 = { id: "t2", title: "Task 2", status: "open", priority: "medium", goal_id: "g2", due_date: null, created_at: "2026-01-01", completed_at: null, description: null };
    mockListTasks.mockReturnValue([task1, task2]);

    const res = await app.inject({ method: "GET", url: "/api/tasks?goalId=g1" });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual([task1]);
  });

  it("POST /api/tasks creates a task", async () => {
    const newTask = { id: "t2", title: "New Task", status: "open", priority: "high", goal_id: null, due_date: null, created_at: "2026-01-01", completed_at: null, description: null };
    mockAddTask.mockReturnValue(newTask);

    const res = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { title: "New Task", priority: "high" },
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.payload)).toEqual(newTask);
  });

  it("POST /api/tasks returns 400 on error", async () => {
    mockAddTask.mockImplementation(() => { throw new Error("Title cannot be empty"); });

    const res = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { title: "" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH /api/tasks/:id updates a task", async () => {
    mockEditTask.mockReturnValue(undefined);
    const res = await app.inject({
      method: "PATCH",
      url: "/api/tasks/t1",
      payload: { title: "Updated" },
    });
    expect(res.statusCode).toBe(200);
    expect(mockEditTask).toHaveBeenCalledWith(expect.anything(), "t1", { title: "Updated" });
  });

  it("POST /api/tasks/:id/done completes a task", async () => {
    mockCompleteTask.mockReturnValue(undefined);
    const res = await app.inject({ method: "POST", url: "/api/tasks/t1/done" });
    expect(res.statusCode).toBe(200);
    expect(mockCompleteTask).toHaveBeenCalledWith(expect.anything(), "t1");
  });

  it("POST /api/tasks/:id/reopen reopens a task", async () => {
    mockReopenTask.mockReturnValue(undefined);
    const res = await app.inject({ method: "POST", url: "/api/tasks/t1/reopen" });
    expect(res.statusCode).toBe(200);
    expect(mockReopenTask).toHaveBeenCalledWith(expect.anything(), "t1");
  });

  it("DELETE /api/tasks/:id deletes a task", async () => {
    mockDeleteTask.mockReturnValue(undefined);
    const res = await app.inject({ method: "DELETE", url: "/api/tasks/t1" });
    expect(res.statusCode).toBe(200);
    expect(mockDeleteTask).toHaveBeenCalledWith(expect.anything(), "t1");
  });

  it("GET /api/goals returns goals", async () => {
    const mockGoal = { id: "g1", title: "Goal 1", description: null, status: "active", created_at: "2026-01-01" };
    mockListGoals.mockReturnValue([mockGoal]);

    const res = await app.inject({ method: "GET", url: "/api/goals" });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual([mockGoal]);
  });

  it("POST /api/goals creates a goal", async () => {
    const newGoal = { id: "g2", title: "New Goal", description: null, status: "active", created_at: "2026-01-01" };
    mockAddGoal.mockReturnValue(newGoal);

    const res = await app.inject({
      method: "POST",
      url: "/api/goals",
      payload: { title: "New Goal" },
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.payload)).toEqual(newGoal);
  });

  it("POST /api/goals/:id/done completes a goal", async () => {
    mockCompleteGoal.mockReturnValue(undefined);
    const res = await app.inject({ method: "POST", url: "/api/goals/g1/done" });
    expect(res.statusCode).toBe(200);
  });

  it("DELETE /api/goals/:id deletes a goal", async () => {
    mockDeleteGoal.mockReturnValue(undefined);
    const res = await app.inject({ method: "DELETE", url: "/api/goals/g1" });
    expect(res.statusCode).toBe(200);
  });
});

// ==========================================================================
// Auth Routes
// ==========================================================================

describe("Auth routes", () => {
  let app: FastifyInstance;
  let serverCtx: ServerContext;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockHasOwner.mockReset();
    mockCreateOwner.mockReset();
    mockGetOwner.mockReset();
    mockVerifyOwnerPassword.mockReset();
    mockGetJwtSecret.mockReset().mockReturnValue("test-secret-key-for-jwt-testing-1234567890");

    app = Fastify();
    addTestErrorHandler(app);
    serverCtx = createMockServerCtx();
    await app.register(cookie);
    registerAuthRoutes(app, serverCtx);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("GET /api/auth/status returns setup:true when no owner", async () => {
    mockHasOwner.mockReturnValue(false);
    const res = await app.inject({ method: "GET", url: "/api/auth/status" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ setup: true, authenticated: false });
  });

  it("GET /api/auth/status returns setup:false when owner exists", async () => {
    mockHasOwner.mockReturnValue(true);
    const res = await app.inject({ method: "GET", url: "/api/auth/status" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ setup: false });
  });

  it("POST /api/auth/setup creates owner and returns tokens", async () => {
    mockHasOwner.mockReturnValue(false);
    mockCreateOwner.mockResolvedValue({ id: "owner-1", email: "test@example.com", name: "Test" });
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/setup",
      payload: { email: "test@example.com", password: "securepassword", name: "Test" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(res.json().accessToken).toBeUndefined();
    expect(res.cookies.find((c: { name: string }) => c.name === "pai_access")).toBeDefined();
  });

  it("POST /api/auth/setup fails if owner already exists", async () => {
    mockHasOwner.mockReturnValue(true);
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/setup",
      payload: { email: "test@example.com", password: "securepassword" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /api/auth/setup fails with short password", async () => {
    mockHasOwner.mockReturnValue(false);
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/setup",
      payload: { name: "Test", email: "test@example.com", password: "short" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("8 characters");
  });

  it("POST /api/auth/login returns tokens for valid credentials", async () => {
    mockVerifyOwnerPassword.mockResolvedValue(true);
    mockGetOwner.mockReturnValue({ id: "owner-1", email: "test@example.com", name: "Test" });
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "test@example.com", password: "correctpassword" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(res.json().accessToken).toBeUndefined();
    expect(res.cookies.find((c: { name: string }) => c.name === "pai_access")).toBeDefined();
  });

  it("POST /api/auth/login rejects invalid credentials", async () => {
    mockVerifyOwnerPassword.mockResolvedValue(false);
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "test@example.com", password: "wrongpassword" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("POST /api/auth/logout clears cookies", async () => {
    const res = await app.inject({ method: "POST", url: "/api/auth/logout", payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  const TEST_SECRET = "test-secret-key-for-jwt-testing-1234567890";

  it("POST /api/auth/setup with missing fields returns 400", async () => {
    mockHasOwner.mockReturnValue(false);
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/setup",
      payload: { email: "test@example.com" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.toLowerCase()).toContain("required");
  });

  it("POST /api/auth/login with missing fields returns 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "test@example.com" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.toLowerCase()).toContain("required");
  });

  it("POST /api/auth/refresh without cookie returns 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      payload: {},
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toContain("No refresh token");
  });

  it("POST /api/auth/refresh with valid refresh token returns new tokens", async () => {
    const refreshToken = jwt.sign(
      { sub: "owner-1", email: "test@example.com", type: "refresh" },
      TEST_SECRET,
      { expiresIn: "7d" },
    );
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      cookies: { pai_refresh: refreshToken },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(res.json().accessToken).toBeUndefined();
    expect(res.cookies.find((c: { name: string }) => c.name === "pai_access")).toBeDefined();
  });

  it("POST /api/auth/refresh rejects token without refresh type", async () => {
    const badToken = jwt.sign(
      { sub: "owner-1", email: "test@example.com" },
      TEST_SECRET,
      { expiresIn: "7d" },
    );
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      cookies: { pai_refresh: badToken },
      payload: {},
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toContain("Invalid token type");
  });

  it("GET /api/auth/me without token returns 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/me",
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toContain("Not authenticated");
  });

  it("GET /api/auth/me with valid token returns owner", async () => {
    const accessToken = jwt.sign(
      { sub: "owner-1", email: "test@example.com" },
      TEST_SECRET,
      { expiresIn: "15m" },
    );
    mockGetOwner.mockReturnValue({ id: "owner-1", email: "test@example.com", name: "Test" });
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().owner).toMatchObject({ id: "owner-1", email: "test@example.com", name: "Test" });
  });

  it("GET /api/auth/me with mismatched owner returns 401", async () => {
    const accessToken = jwt.sign(
      { sub: "owner-999", email: "other@example.com" },
      TEST_SECRET,
      { expiresIn: "15m" },
    );
    mockGetOwner.mockReturnValue({ id: "owner-1", email: "test@example.com", name: "Test" });
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("POST /api/auth/login returns 401 when getOwner returns null", async () => {
    mockVerifyOwnerPassword.mockResolvedValue(true);
    mockGetOwner.mockReturnValue(null);
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "test@example.com", password: "correctpassword" },
    });
    expect(res.statusCode).toBe(401);
  });
});

// ==========================================================================
// Config Routes
// ==========================================================================

describe("Config routes", () => {
  let app: FastifyInstance;
  let serverCtx: ServerContext;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockLoadConfigFile.mockReturnValue({});
    app = Fastify();
    addTestErrorHandler(app);
    serverCtx = createMockServerCtx();
    registerConfigRoutes(app, serverCtx);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  // -- GET /api/config ------------------------------------------------------

  it("GET /api/config returns hasApiKey: false when no key set", async () => {
    const res = await app.inject({ method: "GET", url: "/api/config" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.llm.hasApiKey).toBe(false);
    // apiKey should not be exposed in the response
    expect(body.llm.apiKey).toBeUndefined();
  });

  // -- PUT /api/config ------------------------------------------------------

  it("PUT /api/config saves model and returns updated config", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/config",
      payload: { model: "gpt-4o" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.llm.model).toBe("gpt-4o");
    expect(mockWriteConfig).toHaveBeenCalledTimes(1);
    expect(serverCtx.reinitialize).toHaveBeenCalledTimes(1);
  });

  it("PUT /api/config with apiKey then GET shows hasApiKey: true", async () => {
    // PUT with an API key
    const putRes = await app.inject({
      method: "PUT",
      url: "/api/config",
      payload: { apiKey: "sk-test-key-12345" },
    });

    expect(putRes.statusCode).toBe(200);
    const putBody = putRes.json();
    expect(putBody.llm.hasApiKey).toBe(true);

    // GET should also reflect hasApiKey: true (since reinitialize was called
    // and the config was mutated via Object.assign)
    const getRes = await app.inject({ method: "GET", url: "/api/config" });
    expect(getRes.statusCode).toBe(200);
    const getBody = getRes.json();
    expect(getBody.llm.hasApiKey).toBe(true);
  });

  it("PUT /api/config without apiKey preserves existing key", async () => {
    // Set up the server context with an existing API key
    (serverCtx.ctx.config.llm as Record<string, unknown>).apiKey = "sk-existing-key";

    const res = await app.inject({
      method: "PUT",
      url: "/api/config",
      payload: { model: "gpt-4o-mini" },
    });

    expect(res.statusCode).toBe(200);
    // The writeConfig call should have merged with existing config including the key
    const writeCall = mockWriteConfig.mock.calls[0];
    const writtenConfig = writeCall[1] as Record<string, unknown>;
    const writtenLlm = writtenConfig.llm as Record<string, unknown>;
    expect(writtenLlm.apiKey).toBe("sk-existing-key");
    expect(writtenLlm.model).toBe("gpt-4o-mini");
  });

  it("PUT /api/config rejects invalid provider", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/config",
      payload: { provider: "invalid-provider" },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toMatch(/Invalid enum value/);
    // Should not write config or reinitialize on validation error
    expect(mockWriteConfig).not.toHaveBeenCalled();
    expect(serverCtx.reinitialize).not.toHaveBeenCalled();
  });
});

// ==========================================================================
// Zod Validation Error Tests
// ==========================================================================

describe("Zod validation errors", () => {
  let app: FastifyInstance;
  let serverCtx: ServerContext;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    addTestErrorHandler(app);
    serverCtx = createMockServerCtx();
    registerMemoryRoutes(app, serverCtx);
    registerAuthRoutes(app, serverCtx);
    registerTaskRoutes(app, serverCtx);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns 400 for POST /api/remember with empty text", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/remember",
      payload: { text: "" },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBeDefined();
  });

  it("returns 400 for POST /api/remember with missing text", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/remember",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for POST /api/auth/setup with short password", async () => {
    mockHasOwner.mockReturnValue(false);
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/setup",
      payload: { name: "Test", email: "test@example.com", password: "short" },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toMatch(/8 characters/);
  });

  it("returns 400 for POST /api/auth/setup with missing fields", async () => {
    mockHasOwner.mockReturnValue(false);
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/setup",
      payload: { email: "test@example.com" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for POST /api/tasks with missing title", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { description: "no title" },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBeDefined();
  });

  it("returns 400 for POST /api/tasks with invalid priority", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { title: "Test task", priority: "critical" },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ==========================================================================
// Inbox Routes
// ==========================================================================

describe("Inbox routes", () => {
  let app: FastifyInstance;
  let serverCtx: ServerContext;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    serverCtx = createMockServerCtx();
    registerInboxRoutes(app, serverCtx);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("GET /api/inbox returns null when no briefing exists", async () => {
    mockGetLatestBriefing.mockReturnValue(null);
    const res = await app.inject({ method: "GET", url: "/api/inbox" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ briefing: null });
  });

  it("GET /api/inbox returns the latest briefing", async () => {
    const mockBriefing = {
      id: "brief_123",
      generatedAt: "2026-02-25T08:00:00Z",
      sections: {
        greeting: "Hello!",
        taskFocus: { summary: "", items: [] },
        memoryInsights: { summary: "", highlights: [] },
        suggestions: [],
      },
      status: "ready",
    };
    mockGetLatestBriefing.mockReturnValue(mockBriefing);
    const res = await app.inject({ method: "GET", url: "/api/inbox" });
    expect(res.statusCode).toBe(200);
    expect(res.json().briefing.id).toBe("brief_123");
  });

  it("POST /api/inbox/refresh triggers generation", async () => {
    mockGenerateBriefing.mockResolvedValue(null);
    const res = await app.inject({ method: "POST", url: "/api/inbox/refresh", payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it("GET /api/inbox/history returns list", async () => {
    mockListBriefings.mockReturnValue([{ id: "b1", generatedAt: "2026-02-25T08:00:00Z" }]);
    const res = await app.inject({ method: "GET", url: "/api/inbox/history" });
    expect(res.statusCode).toBe(200);
    expect(res.json().briefings).toHaveLength(1);
  });

  it("GET /api/inbox/:id returns 404 for missing briefing", async () => {
    mockGetBriefingById.mockReturnValue(null);
    const res = await app.inject({ method: "GET", url: "/api/inbox/nonexistent" });
    expect(res.statusCode).toBe(404);
  });

  it("GET /api/inbox/:id returns briefing by id", async () => {
    const mockBriefing = {
      id: "brief_456",
      generatedAt: "2026-02-25T10:00:00Z",
      sections: {
        greeting: "Good morning!",
        taskFocus: { summary: "Focus on tasks", items: [] },
        memoryInsights: { summary: "No insights", highlights: [] },
        suggestions: [],
      },
      status: "ready",
    };
    mockGetBriefingById.mockReturnValue(mockBriefing);
    const res = await app.inject({ method: "GET", url: "/api/inbox/brief_456" });
    expect(res.statusCode).toBe(200);
    expect(res.json().briefing.id).toBe("brief_456");
  });

  it("POST /api/inbox/clear clears all briefings", async () => {
    mockClearAllBriefings.mockReturnValue(3);
    const res = await app.inject({ method: "POST", url: "/api/inbox/clear", payload: {} });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.cleared).toBe(3);
  });

  it("GET /api/inbox/all returns briefings and generating status", async () => {
    mockListAllBriefings.mockReturnValue([
      { id: "b1", generatedAt: "2026-02-25T08:00:00Z", status: "ready" },
      { id: "b2", generatedAt: "2026-02-25T10:00:00Z", status: "ready" },
    ]);
    const res = await app.inject({ method: "GET", url: "/api/inbox/all" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.briefings).toHaveLength(2);
    expect(body.generating).toBe(false);
  });

  it("GET /api/inbox/research returns research briefings", async () => {
    mockGetResearchBriefings.mockReturnValue([
      { id: "rb1", generatedAt: "2026-02-25T08:00:00Z", type: "research" },
    ]);
    const res = await app.inject({ method: "GET", url: "/api/inbox/research" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.briefings).toHaveLength(1);
    expect(body.briefings[0].id).toBe("rb1");
  });
});

// ==========================================================================
// Jobs Routes
// ==========================================================================

describe("jobs routes", () => {
  let app: FastifyInstance;
  let serverCtx: ServerContext;

  beforeEach(async () => {
    vi.clearAllMocks();
    activeJobs.clear();
    app = Fastify();
    serverCtx = createMockServerCtx();
    registerJobRoutes(app, serverCtx);
    await app.ready();
  });

  afterEach(async () => {
    activeJobs.clear();
    await app.close();
  });

  it("GET /api/jobs returns empty list when no jobs exist", async () => {
    mockListResearchJobs.mockReturnValue([]);
    const res = await app.inject({ method: "GET", url: "/api/jobs" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.jobs).toEqual([]);
  });

  it("GET /api/jobs returns in-memory active jobs", async () => {
    activeJobs.set("job1", {
      id: "job1",
      type: "crawl",
      label: "Crawling example.com",
      status: "running",
      progress: "3/10 pages",
      startedAt: "2026-02-25T08:00:00Z",
    });
    mockListResearchJobs.mockReturnValue([]);

    const res = await app.inject({ method: "GET", url: "/api/jobs" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.jobs).toHaveLength(1);
    expect(body.jobs[0].id).toBe("job1");
    expect(body.jobs[0].type).toBe("crawl");
    expect(body.jobs[0].status).toBe("running");
  });

  it("GET /api/jobs returns persisted research jobs", async () => {
    mockListResearchJobs.mockReturnValue([
      {
        id: "rj1",
        goal: "Research AI trends",
        status: "done",
        searchesUsed: 5,
        budgetMaxSearches: 10,
        pagesLearned: 3,
        budgetMaxPages: 20,
        createdAt: "2026-02-25T08:00:00Z",
        completedAt: "2026-02-25T09:00:00Z",
        report: "AI is advancing rapidly in multiple domains...",
      },
    ]);

    const res = await app.inject({ method: "GET", url: "/api/jobs" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.jobs).toHaveLength(1);
    expect(body.jobs[0].id).toBe("rj1");
    expect(body.jobs[0].type).toBe("research");
    expect(body.jobs[0].label).toBe("Research AI trends");
    expect(body.jobs[0].progress).toBe("5/10 searches, 3/20 pages");
  });

  it("GET /api/jobs deduplicates active and persisted jobs by id", async () => {
    activeJobs.set("rj1", {
      id: "rj1",
      type: "research",
      label: "Research AI trends (active)",
      status: "running",
      progress: "2/10 searches",
      startedAt: "2026-02-25T08:00:00Z",
    });
    mockListResearchJobs.mockReturnValue([
      {
        id: "rj1",
        goal: "Research AI trends",
        status: "done",
        searchesUsed: 5,
        budgetMaxSearches: 10,
        pagesLearned: 3,
        budgetMaxPages: 20,
        createdAt: "2026-02-25T08:00:00Z",
        completedAt: "2026-02-25T09:00:00Z",
        report: null,
      },
    ]);

    const res = await app.inject({ method: "GET", url: "/api/jobs" });
    const body = res.json();
    // Should only have 1 job (active version wins, persisted deduped)
    expect(body.jobs).toHaveLength(1);
    expect(body.jobs[0].label).toBe("Research AI trends (active)");
  });

  it("GET /api/jobs/:id returns a research job by id", async () => {
    mockGetResearchJob.mockReturnValue({
      id: "rj1",
      goal: "Research AI trends",
      status: "done",
      report: "Full detailed report...",
    });

    const res = await app.inject({ method: "GET", url: "/api/jobs/rj1" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.job.id).toBe("rj1");
    expect(body.job.report).toBe("Full detailed report...");
  });

  it("GET /api/jobs/:id returns 404 when job not found", async () => {
    mockGetResearchJob.mockReturnValue(null);

    const res = await app.inject({ method: "GET", url: "/api/jobs/nonexistent" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("Job not found");
  });

  it("POST /api/jobs/clear clears completed jobs from DB and memory", async () => {
    activeJobs.set("done1", {
      id: "done1",
      type: "crawl",
      label: "Done crawl",
      status: "done",
      progress: "10/10",
      startedAt: "2026-02-25T08:00:00Z",
    });
    activeJobs.set("err1", {
      id: "err1",
      type: "research",
      label: "Failed research",
      status: "error",
      progress: "0/10",
      startedAt: "2026-02-25T08:00:00Z",
      error: "LLM timeout",
    });
    activeJobs.set("running1", {
      id: "running1",
      type: "crawl",
      label: "Still running",
      status: "running",
      progress: "5/10",
      startedAt: "2026-02-25T08:00:00Z",
    });
    mockClearCompletedJobs.mockReturnValue(2);

    const res = await app.inject({ method: "POST", url: "/api/jobs/clear", payload: {} });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    // 2 from DB + 2 from memory (done1 + err1)
    expect(body.cleared).toBe(4);
    // running1 should still be in activeJobs
    expect(activeJobs.has("running1")).toBe(true);
    expect(activeJobs.has("done1")).toBe(false);
    expect(activeJobs.has("err1")).toBe(false);
  });
});

// ==========================================================================
// Clear All Threads (agent route)
// ==========================================================================

describe("clear all threads", () => {
  let app: FastifyInstance;
  let serverCtx: ServerContext;

  beforeEach(async () => {
    vi.clearAllMocks();
    setupDefaultAIMocks();
    app = Fastify();
    app.addHook("onError", (_req, _reply, _error, done) => { done(); });
    serverCtx = createMockServerCtx();
    registerAgentRoutes(app, serverCtx);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("POST /api/threads/clear clears all threads and returns count", async () => {
    // Create some threads first
    await app.inject({
      method: "POST",
      url: "/api/threads",
      payload: { title: "Thread 1" },
    });
    await app.inject({
      method: "POST",
      url: "/api/threads",
      payload: { title: "Thread 2" },
    });

    // Verify threads exist
    const listRes = await app.inject({ method: "GET", url: "/api/threads" });
    expect(JSON.parse(listRes.payload)).toHaveLength(2);

    // Clear all threads
    const res = await app.inject({ method: "POST", url: "/api/threads/clear", payload: {} });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.cleared).toBe("number");
  });

  it("POST /api/threads/clear returns 0 when no threads exist", async () => {
    const res = await app.inject({ method: "POST", url: "/api/threads/clear", payload: {} });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.cleared).toBe(0);
  });
});

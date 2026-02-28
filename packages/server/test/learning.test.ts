import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStorage, threadMigrations } from "@personal-ai/core";
import type { Storage } from "@personal-ai/core";
import { learningMigrations, getWatermark, updateWatermark, gatherSignals, buildLearningPrompt, parseLearningResponse, runBackgroundLearning } from "../src/learning.js";
import type { GatheredSignals } from "../src/learning.js";
import type { PluginContext } from "@personal-ai/core";

// ---------------------------------------------------------------------------
// Mock external dependencies for orchestrator tests
// ---------------------------------------------------------------------------
const mockGenerateText = vi.fn();
vi.mock("ai", () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
}));

const mockRemember = vi.fn();
vi.mock("@personal-ai/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@personal-ai/core")>();
  return {
    ...actual,
    remember: (...args: unknown[]) => mockRemember(...args),
  };
});

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

describe("gatherSignals", () => {
  let dir: string;
  let storage: Storage;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pai-learning-signals-test-"));
    storage = createStorage(dir);
    storage.migrate("learning", learningMigrations);
    storage.migrate("threads", threadMigrations);
  });

  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns isEmpty: true when no data exists", () => {
    const signals = gatherSignals(storage);
    expect(signals.isEmpty).toBe(true);
    expect(signals.threads).toHaveLength(0);
    expect(signals.research).toHaveLength(0);
    expect(signals.tasks).toHaveLength(0);
    expect(signals.knowledge).toHaveLength(0);
  });

  it("gathers thread messages newer than watermark", () => {
    storage.run("INSERT INTO threads (id, title, created_at, updated_at, message_count) VALUES ('t1', 'Test', datetime('now'), datetime('now'), 1)");
    storage.run("INSERT INTO thread_messages (id, thread_id, role, content, created_at, sequence) VALUES ('m1', 't1', 'user', 'I prefer React over Vue', datetime('now'), 1)");
    const signals = gatherSignals(storage);
    expect(signals.threads).toHaveLength(1);
    expect(signals.threads[0].messages).toHaveLength(1);
    expect(signals.isEmpty).toBe(false);
  });

  it("limits to 3 threads", () => {
    for (let t = 0; t < 5; t++) {
      storage.run(`INSERT INTO threads (id, title, created_at, updated_at, message_count) VALUES ('t${t}', 'Thread ${t}', datetime('now'), datetime('now'), 1)`);
      storage.run(`INSERT INTO thread_messages (id, thread_id, role, content, created_at, sequence) VALUES ('m${t}', 't${t}', 'user', 'msg', datetime('now'), 1)`);
    }
    const signals = gatherSignals(storage);
    expect(signals.threads.length).toBeLessThanOrEqual(3);
  });

  it("only gathers user messages, not assistant messages", () => {
    storage.run("INSERT INTO threads (id, title, created_at, updated_at, message_count) VALUES ('t1', 'Test', datetime('now'), datetime('now'), 2)");
    storage.run("INSERT INTO thread_messages (id, thread_id, role, content, created_at, sequence) VALUES ('m1', 't1', 'user', 'user msg', datetime('now'), 1)");
    storage.run("INSERT INTO thread_messages (id, thread_id, role, content, created_at, sequence) VALUES ('m2', 't1', 'assistant', 'assistant msg', datetime('now'), 2)");
    const signals = gatherSignals(storage);
    expect(signals.threads[0].messages).toHaveLength(1);
    expect(signals.threads[0].messages[0].role).toBe("user");
  });
});

describe("buildLearningPrompt", () => {
  it("builds prompt with all signal types", () => {
    const signals: GatheredSignals = {
      threads: [{ threadId: "t1", messages: [{ role: "user", content: "I prefer React", createdAt: "2026-01-01" }] }],
      research: [{ id: "r1", goal: "Bitcoin analysis", reportSnippet: "BTC is..." }],
      tasks: [{ title: "Setup CI", priority: "high", completedAt: "2026-01-01" }],
      knowledge: [{ title: "React docs", url: "https://react.dev", firstChunk: "React is..." }],
      isEmpty: false,
    };
    const prompt = buildLearningPrompt(signals);
    expect(prompt).toContain("RECENT CONVERSATIONS");
    expect(prompt).toContain("COMPLETED RESEARCH");
    expect(prompt).toContain("COMPLETED TASKS");
    expect(prompt).toContain("NEW KNOWLEDGE SOURCES");
    expect(prompt).toContain("Maximum 10 facts");
  });

  it("omits empty sections", () => {
    const signals: GatheredSignals = {
      threads: [], research: [], tasks: [],
      knowledge: [{ title: "React docs", url: "https://react.dev", firstChunk: "React is..." }],
      isEmpty: false,
    };
    const prompt = buildLearningPrompt(signals);
    expect(prompt).not.toContain("RECENT CONVERSATIONS");
    expect(prompt).not.toContain("COMPLETED RESEARCH");
    expect(prompt).not.toContain("COMPLETED TASKS");
    expect(prompt).toContain("NEW KNOWLEDGE SOURCES");
  });
});

describe("parseLearningResponse", () => {
  it("parses valid JSON array", () => {
    const input = '[{"fact":"User prefers TypeScript","factType":"preference","importance":7,"subject":"owner"}]';
    const facts = parseLearningResponse(input);
    expect(facts).toHaveLength(1);
    expect(facts[0].fact).toBe("User prefers TypeScript");
    expect(facts[0].factType).toBe("preference");
  });

  it("handles markdown-wrapped JSON", () => {
    const input = '```json\n[{"fact":"test","factType":"factual","importance":5,"subject":"owner"}]\n```';
    const facts = parseLearningResponse(input);
    expect(facts).toHaveLength(1);
  });

  it("returns empty array for invalid JSON", () => {
    expect(parseLearningResponse("not json")).toEqual([]);
    expect(parseLearningResponse("{}")).toEqual([]);
  });

  it("caps at 10 facts", () => {
    const items = Array.from({ length: 20 }, (_, i) => ({
      fact: `Fact ${i}`, factType: "factual", importance: 5, subject: "owner",
    }));
    expect(parseLearningResponse(JSON.stringify(items))).toHaveLength(10);
  });

  it("filters out items with missing fields", () => {
    const input = '[{"fact":"good","factType":"factual","importance":5,"subject":"owner"},{"bad":true}]';
    expect(parseLearningResponse(input)).toHaveLength(1);
  });
});

describe("runBackgroundLearning", () => {
  let dir: string;
  let storage: Storage;

  beforeEach(() => {
    vi.clearAllMocks();
    dir = mkdtempSync(join(tmpdir(), "pai-learning-orchestrator-test-"));
    storage = createStorage(dir);
    storage.migrate("learning", learningMigrations);
    storage.migrate("threads", threadMigrations);
  });

  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("updates watermarks and skips LLM when no signals exist", async () => {
    const mockCtx = {
      storage,
      llm: {
        health: async () => ({ ok: true }),
        getModel: () => ({}),
        embed: async () => [],
      },
      logger: {
        info: () => {},
        debug: () => {},
        warn: () => {},
        error: () => {},
      },
    } as unknown as PluginContext;

    await runBackgroundLearning(mockCtx);

    // Watermarks should be updated (not the 24h-ago default anymore)
    const wm = getWatermark(storage, "threads");
    const age = Date.now() - new Date(wm).getTime();
    // Should be very recent (within last 5 seconds)
    expect(age).toBeLessThan(5000);
  });

  it("skips when LLM is unhealthy", async () => {
    const mockCtx = {
      storage,
      llm: { health: async () => ({ ok: false }) },
      logger: { info: () => {}, debug: () => {}, warn: () => {}, error: () => {} },
    } as unknown as PluginContext;

    await runBackgroundLearning(mockCtx);

    // Watermarks should NOT be updated (still 24h ago default)
    const wm = getWatermark(storage, "threads");
    const age = Date.now() - new Date(wm).getTime();
    expect(age).toBeGreaterThan(23 * 60 * 60 * 1000);
  });

  it("extracts facts from signals and stores them via remember()", async () => {
    // Insert thread data so signals are non-empty
    storage.run("INSERT INTO threads (id, title, created_at, updated_at, message_count) VALUES ('t1', 'Test', datetime('now'), datetime('now'), 1)");
    storage.run("INSERT INTO thread_messages (id, thread_id, role, content, created_at, sequence) VALUES ('m1', 't1', 'user', 'I prefer TypeScript over JavaScript', datetime('now'), 1)");

    // Mock LLM to return extracted facts
    const llmResponse = JSON.stringify([
      { fact: "User prefers TypeScript over JavaScript", factType: "preference", importance: 7, subject: "owner" },
      { fact: "User works with web technologies", factType: "factual", importance: 5, subject: "owner" },
    ]);
    mockGenerateText.mockResolvedValue({ text: llmResponse });
    mockRemember.mockResolvedValue({ episodeId: "ep1", beliefIds: ["b1"], isReinforcement: false });

    const mockCtx = {
      storage,
      llm: {
        health: async () => ({ ok: true }),
        getModel: () => ({}),
        embed: async () => [],
      },
      logger: { info: () => {}, debug: () => {}, warn: () => {}, error: () => {} },
    } as unknown as PluginContext;

    await runBackgroundLearning(mockCtx);

    // generateText should have been called
    expect(mockGenerateText).toHaveBeenCalledTimes(1);
    // remember should have been called for each extracted fact
    expect(mockRemember).toHaveBeenCalledTimes(2);
    expect(mockRemember).toHaveBeenCalledWith(
      storage,
      expect.anything(),
      "User prefers TypeScript over JavaScript",
      expect.anything(),
    );

    // Watermarks should be updated (recent)
    const wm = getWatermark(storage, "threads");
    const age = Date.now() - new Date(wm).getTime();
    expect(age).toBeLessThan(5000);
  });

  it("does not update watermarks when LLM extraction fails", async () => {
    // Insert thread data so signals are non-empty
    storage.run("INSERT INTO threads (id, title, created_at, updated_at, message_count) VALUES ('t2', 'Fail test', datetime('now'), datetime('now'), 1)");
    storage.run("INSERT INTO thread_messages (id, thread_id, role, content, created_at, sequence) VALUES ('m2', 't2', 'user', 'Some user message', datetime('now'), 1)");

    // Mock LLM to throw an error
    mockGenerateText.mockRejectedValue(new Error("LLM connection timeout"));

    const mockCtx = {
      storage,
      llm: {
        health: async () => ({ ok: true }),
        getModel: () => ({}),
        embed: async () => [],
      },
      logger: { info: () => {}, debug: () => {}, warn: () => {}, error: () => {} },
    } as unknown as PluginContext;

    await runBackgroundLearning(mockCtx);

    // generateText should have been called (signals were non-empty)
    expect(mockGenerateText).toHaveBeenCalledTimes(1);
    // remember should NOT have been called (LLM failed)
    expect(mockRemember).not.toHaveBeenCalled();

    // Watermarks should NOT be updated (still 24h ago default)
    const wm = getWatermark(storage, "threads");
    const age = Date.now() - new Date(wm).getTime();
    expect(age).toBeGreaterThan(23 * 60 * 60 * 1000);
  });

  it("counts reinforced vs created beliefs correctly", async () => {
    // Insert thread data so signals are non-empty
    storage.run("INSERT INTO threads (id, title, created_at, updated_at, message_count) VALUES ('t3', 'Count test', datetime('now'), datetime('now'), 1)");
    storage.run("INSERT INTO thread_messages (id, thread_id, role, content, created_at, sequence) VALUES ('m3', 't3', 'user', 'I like Vitest', datetime('now'), 1)");

    const llmResponse = JSON.stringify([
      { fact: "User likes Vitest", factType: "preference", importance: 6, subject: "owner" },
      { fact: "User uses pnpm", factType: "procedural", importance: 5, subject: "owner" },
    ]);
    mockGenerateText.mockResolvedValue({ text: llmResponse });
    // First fact is new, second is reinforcement
    mockRemember
      .mockResolvedValueOnce({ episodeId: "ep1", beliefIds: ["b1"], isReinforcement: false })
      .mockResolvedValueOnce({ episodeId: "ep2", beliefIds: ["b2"], isReinforcement: true });

    const logInfo = vi.fn();
    const mockCtx = {
      storage,
      llm: {
        health: async () => ({ ok: true }),
        getModel: () => ({}),
        embed: async () => [],
      },
      logger: { info: logInfo, debug: () => {}, warn: () => {}, error: () => {} },
    } as unknown as PluginContext;

    await runBackgroundLearning(mockCtx);

    // Check the final log message includes correct counts
    const completionLog = logInfo.mock.calls.find(
      (call: unknown[]) => typeof call[0] === "string" && call[0].includes("complete"),
    );
    expect(completionLog).toBeDefined();
    expect(completionLog![1]).toMatchObject({
      factsExtracted: 2,
      beliefsCreated: 1,
      beliefsReinforced: 1,
    });
  });
});

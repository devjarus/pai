import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStorage } from "@personal-ai/core";
import type { Storage } from "@personal-ai/core";
import {
  briefingMigrations,
  getLatestBriefing,
  getBriefingById,
  listBriefings,
  clearAllBriefings,
  generateBriefing,
  getResearchBriefings,
} from "../src/briefing.js";
import type { BriefingSection } from "../src/briefing.js";

// ---------------------------------------------------------------------------
// Mocks for generateBriefing tests
// ---------------------------------------------------------------------------
vi.mock("ai", () => ({
  generateText: vi.fn(),
}));

vi.mock("@personal-ai/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@personal-ai/core")>();
  return {
    ...actual,
    listBeliefs: vi.fn().mockReturnValue([]),
    memoryStats: vi.fn().mockReturnValue({
      beliefs: { active: 0, forgotten: 0, invalidated: 0 },
      avgConfidence: 0,
      episodes: 0,
    }),
    listSources: vi.fn().mockReturnValue([]),
  };
});

vi.mock("@personal-ai/plugin-tasks", () => ({
  listTasks: vi.fn().mockReturnValue([]),
  listGoals: vi.fn().mockReturnValue([]),
}));

// ---------------------------------------------------------------------------
// CRUD tests — real SQLite, no mocks needed
// ---------------------------------------------------------------------------
describe("Briefing CRUD", () => {
  let dir: string;
  let storage: Storage;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pai-briefing-test-"));
    storage = createStorage(dir);
    storage.migrate("briefing", briefingMigrations);
  });

  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  // Helper to insert a briefing row directly
  function insertBriefing(
    id: string,
    sections: Record<string, unknown>,
    status = "ready",
    generatedAt?: string,
  ) {
    storage.run(
      "INSERT INTO briefings (id, generated_at, sections, raw_context, status) VALUES (?, ?, ?, ?, ?)",
      [
        id,
        generatedAt ?? new Date().toISOString().replace("T", " ").slice(0, 19),
        JSON.stringify(sections),
        null,
        status,
      ],
    );
  }

  describe("getLatestBriefing", () => {
    it("returns null when no briefings exist", () => {
      expect(getLatestBriefing(storage)).toBeNull();
    });

    it("returns the most recent ready briefing", () => {
      insertBriefing("old-1", { greeting: "old" }, "ready", "2025-01-01 00:00:00");
      insertBriefing("new-1", { greeting: "new" }, "ready", "2025-06-01 00:00:00");

      const result = getLatestBriefing(storage);
      expect(result).not.toBeNull();
      expect(result!.id).toBe("new-1");
      expect(result!.sections).toEqual({ greeting: "new" });
      expect(result!.status).toBe("ready");
    });

    it("ignores non-ready briefings", () => {
      insertBriefing("failed-1", { greeting: "fail" }, "failed", "2025-12-01 00:00:00");
      insertBriefing("ready-1", { greeting: "ok" }, "ready", "2025-01-01 00:00:00");

      const result = getLatestBriefing(storage);
      expect(result).not.toBeNull();
      expect(result!.id).toBe("ready-1");
    });
  });

  describe("getBriefingById", () => {
    it("returns null for non-existent id", () => {
      expect(getBriefingById(storage, "nope")).toBeNull();
    });

    it("returns briefing by exact id", () => {
      insertBriefing("abc-123", { greeting: "hello" });

      const result = getBriefingById(storage, "abc-123");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("abc-123");
      expect(result!.sections).toEqual({ greeting: "hello" });
    });

    it("returns briefings regardless of status", () => {
      insertBriefing("fail-id", { greeting: "x" }, "failed");

      const result = getBriefingById(storage, "fail-id");
      expect(result).not.toBeNull();
      expect(result!.status).toBe("failed");
    });
  });

  describe("listBriefings", () => {
    it("returns empty array when no briefings exist", () => {
      expect(listBriefings(storage)).toEqual([]);
    });

    it("returns briefings ordered by most recent first", () => {
      insertBriefing("a", {}, "ready", "2025-01-01 00:00:00");
      insertBriefing("b", {}, "ready", "2025-06-01 00:00:00");
      insertBriefing("c", {}, "ready", "2025-03-01 00:00:00");

      const list = listBriefings(storage);
      expect(list).toHaveLength(3);
      expect(list[0]!.id).toBe("b");
      expect(list[1]!.id).toBe("c");
      expect(list[2]!.id).toBe("a");
    });

    it("only includes ready briefings", () => {
      insertBriefing("ok", {}, "ready", "2025-01-01 00:00:00");
      insertBriefing("bad", {}, "failed", "2025-06-01 00:00:00");
      insertBriefing("gen", {}, "generating", "2025-06-02 00:00:00");

      const list = listBriefings(storage);
      expect(list).toHaveLength(1);
      expect(list[0]!.id).toBe("ok");
    });

    it("limits to 30 results", () => {
      for (let i = 0; i < 35; i++) {
        const date = `2025-01-${String(i + 1).padStart(2, "0")} 00:00:00`;
        insertBriefing(`item-${i}`, {}, "ready", i < 31 ? date : `2025-02-${String(i - 30).padStart(2, "0")} 00:00:00`);
      }

      const list = listBriefings(storage);
      expect(list).toHaveLength(30);
    });
  });

  describe("briefing type column", () => {
    it("defaults to 'daily' for existing briefings", () => {
      insertBriefing("daily-1", { greeting: "hi" });
      const row = storage.query<{ type: string }>("SELECT type FROM briefings WHERE id = 'daily-1'");
      expect(row[0]!.type).toBe("daily");
    });

    it("stores research type briefings", () => {
      storage.run(
        "INSERT INTO briefings (id, generated_at, sections, raw_context, status, type) VALUES (?, datetime('now'), ?, null, 'ready', 'research')",
        ["res-1", JSON.stringify({ report: "findings" })],
      );
      const row = storage.query<{ type: string }>("SELECT type FROM briefings WHERE id = 'res-1'");
      expect(row[0]!.type).toBe("research");
    });

    it("getLatestBriefing only returns daily type", () => {
      insertBriefing("daily-old", { greeting: "old" }, "ready", "2025-01-01 00:00:00");
      storage.run(
        "INSERT INTO briefings (id, generated_at, sections, raw_context, status, type) VALUES (?, '2025-12-01 00:00:00', ?, null, 'ready', 'research')",
        ["res-latest", JSON.stringify({ report: "findings" })],
      );
      const result = getLatestBriefing(storage);
      expect(result).not.toBeNull();
      expect(result!.id).toBe("daily-old");
    });

    it("getResearchBriefings returns only research type", () => {
      insertBriefing("daily-x", { greeting: "hi" }, "ready", "2025-01-01 00:00:00");
      storage.run(
        "INSERT INTO briefings (id, generated_at, sections, raw_context, status, type) VALUES (?, '2025-06-01 00:00:00', ?, null, 'ready', 'research')",
        ["res-x", JSON.stringify({ report: "research findings", goal: "test goal" })],
      );
      const results = getResearchBriefings(storage);
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe("res-x");
    });
  });

  describe("clearAllBriefings", () => {
    it("returns 0 when no briefings exist", () => {
      expect(clearAllBriefings(storage)).toBe(0);
    });

    it("deletes all briefings and returns count", () => {
      insertBriefing("x1", {});
      insertBriefing("x2", {}, "failed");
      insertBriefing("x3", {}, "generating");

      const count = clearAllBriefings(storage);
      expect(count).toBe(3);
      expect(listBriefings(storage)).toEqual([]);
      expect(getBriefingById(storage, "x1")).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// generateBriefing tests — mocked LLM and data functions
// ---------------------------------------------------------------------------
describe("generateBriefing", () => {
  let dir: string;
  let storage: Storage;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pai-briefing-gen-"));
    storage = createStorage(dir);
    storage.migrate("briefing", briefingMigrations);
    vi.clearAllMocks();
  });

  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function makeCtx(healthOk = true) {
    return {
      config: {} as never,
      storage,
      llm: {
        health: vi.fn().mockResolvedValue({ ok: healthOk }),
        getModel: vi.fn().mockReturnValue("mock-model"),
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
    } as never;
  }

  const sampleSections: BriefingSection = {
    greeting: "Good morning!",
    taskFocus: {
      summary: "You have tasks.",
      items: [{ id: "t1", title: "Do stuff", priority: "high", insight: "Important" }],
    },
    memoryInsights: {
      summary: "Memory is growing.",
      highlights: [{ statement: "You like TS", type: "preference", detail: "Noted" }],
    },
    suggestions: [{ title: "Review beliefs", reason: "Some are stale" }],
  };

  it("returns null when LLM health check fails", async () => {
    const ctx = makeCtx(false);
    const result = await generateBriefing(ctx);
    expect(result).toBeNull();
  });

  it("returns null when LLM health check throws", async () => {
    const ctx = makeCtx();
    (ctx as { llm: { health: ReturnType<typeof vi.fn> } }).llm.health = vi.fn().mockRejectedValue(new Error("connection refused"));
    const result = await generateBriefing(ctx);
    expect(result).toBeNull();
  });

  it("generates a briefing successfully with plain JSON response", async () => {
    const { generateText } = await import("ai");
    (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: JSON.stringify(sampleSections),
    });

    const ctx = makeCtx(true);
    const result = await generateBriefing(ctx);

    expect(result).not.toBeNull();
    expect(result!.status).toBe("ready");
    expect(result!.sections.greeting).toBe("Good morning!");
    expect(result!.sections.taskFocus.items).toHaveLength(1);
    expect(result!.sections.suggestions).toHaveLength(1);

    // Verify it was persisted in the DB
    const fromDb = getBriefingById(storage, result!.id);
    expect(fromDb).not.toBeNull();
    expect(fromDb!.status).toBe("ready");
  });

  it("handles JSON wrapped in markdown code fences", async () => {
    const { generateText } = await import("ai");
    (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: "```json\n" + JSON.stringify(sampleSections) + "\n```",
    });

    const ctx = makeCtx(true);
    const result = await generateBriefing(ctx);

    expect(result).not.toBeNull();
    expect(result!.sections.greeting).toBe("Good morning!");
  });

  it("marks briefing as failed when generateText throws", async () => {
    const { generateText } = await import("ai");
    (generateText as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("LLM unavailable"));

    const ctx = makeCtx(true);
    const result = await generateBriefing(ctx);

    expect(result).toBeNull();

    // The row should exist with status 'failed'
    const rows = storage.query<{ id: string; status: string }>(
      "SELECT id, status FROM briefings WHERE status = 'failed'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("failed");
  });

  it("marks briefing as failed when response is invalid JSON", async () => {
    const { generateText } = await import("ai");
    (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: "This is not JSON at all",
    });

    const ctx = makeCtx(true);
    const result = await generateBriefing(ctx);

    expect(result).toBeNull();

    const rows = storage.query<{ status: string }>(
      "SELECT status FROM briefings WHERE status = 'failed'",
    );
    expect(rows).toHaveLength(1);
  });

  it("calls generateText with the LLM model from context", async () => {
    const { generateText } = await import("ai");
    (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: JSON.stringify(sampleSections),
    });

    const ctx = makeCtx(true);
    await generateBriefing(ctx);

    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "mock-model",
        maxRetries: 1,
      }),
    );
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStorage, listBeliefs, memoryMigrations } from "@personal-ai/core";
import type { Storage } from "@personal-ai/core";
import { createProgram, scheduleMigrations } from "@personal-ai/plugin-schedules";
import {
  briefingMigrations,
  getLatestBriefing,
  getBriefingById,
  listBriefings,
  clearAllBriefings,
  generateBriefing,
  enqueueBriefingGeneration,
  getResearchBriefings,
  selectBriefingBeliefs,
  linkBriefBeliefs,
  getBriefBeliefs,
  buildBriefingDelta,
} from "../src/briefing.js";
import type { BriefingSection, BriefingDelta } from "../src/briefing.js";
import { findingsMigrations, createFinding } from "@personal-ai/library";
import type { Belief } from "@personal-ai/core";

// ---------------------------------------------------------------------------
// Mocks for generateBriefing tests
// ---------------------------------------------------------------------------
vi.mock("ai", () => ({
  generateText: vi.fn(),
}));

const { mockListTasks, mockListGoals, mockListBeliefs, mockMemoryStats, mockListSources } = vi.hoisted(() => ({
  mockListTasks: vi.fn(),
  mockListGoals: vi.fn(),
  mockListBeliefs: vi.fn(),
  mockMemoryStats: vi.fn(),
  mockListSources: vi.fn(),
}));

vi.mock("@personal-ai/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@personal-ai/core")>();
  return {
    ...actual,
    listBeliefs: mockListBeliefs,
    memoryStats: mockMemoryStats,
    listSources: mockListSources,
  };
});

vi.mock("@personal-ai/plugin-tasks", () => ({
  listTasks: mockListTasks,
  listGoals: mockListGoals,
}));

beforeEach(() => {
  mockListBeliefs.mockReturnValue([]);
  mockMemoryStats.mockReturnValue({
    beliefs: { active: 0, forgotten: 0, invalidated: 0 },
    avgConfidence: 0,
    episodes: 0,
  });
  mockListSources.mockReturnValue([]);
  mockListTasks.mockReturnValue([]);
  mockListGoals.mockReturnValue([]);
});

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
    rawContext?: Record<string, unknown> | null,
  ) {
    storage.run(
      "INSERT INTO briefings (id, generated_at, sections, raw_context, status) VALUES (?, ?, ?, ?, ?)",
      [
        id,
        generatedAt ?? new Date().toISOString().replace("T", " ").slice(0, 19),
        JSON.stringify(sections),
        rawContext ? JSON.stringify(rawContext) : null,
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

    it("hydrates raw_context on detail fetch", () => {
      insertBriefing(
        "ctx-123",
        { greeting: "hello" },
        "ready",
        undefined,
        {
          beliefs: [{
            id: "belief_1",
            statement: "Prefer concise blocker-focused updates",
            type: "preference",
            confidence: 0.9,
            updatedAt: "2026-03-11T08:00:00Z",
            accessCount: 4,
            isNew: false,
            subject: "owner",
          }],
        },
      );

      const result = getBriefingById(storage, "ctx-123");
      expect(result).not.toBeNull();
      expect(result!.rawContext?.beliefs?.[0]?.id).toBe("belief_1");
      expect(result!.rawContext?.beliefs?.[0]?.subject).toBe("owner");
    });

    it("re-filters stored raw_context beliefs against current trust-safe briefing rules", () => {
      vi.mocked(listBeliefs).mockReturnValue([
        {
          id: "belief_visa",
          statement: "Owner is tracking H4 visa slot availability in India",
          type: "factual",
          confidence: 0.9,
          status: "active",
          created_at: "2026-03-12T00:00:00.000Z",
          updated_at: "2026-03-12T00:00:00.000Z",
          superseded_by: null,
          supersedes: null,
          importance: 7,
          last_accessed: null,
          access_count: 0,
          stability: 1,
          subject: "owner",
          origin: "user-said",
          freshness_at: "2026-03-12T00:00:00.000Z",
          correction_state: "active",
          sensitive: false,
        },
        {
          id: "belief_monica",
          statement: "Monica thinks Suraj is self-obsessed",
          type: "preference",
          confidence: 0.9,
          status: "active",
          created_at: "2026-03-12T00:00:00.000Z",
          updated_at: "2026-03-12T00:00:00.000Z",
          superseded_by: null,
          supersedes: null,
          importance: 6,
          last_accessed: null,
          access_count: 0,
          stability: 1,
          subject: "monica",
          origin: "inferred",
          freshness_at: "2026-03-12T00:00:00.000Z",
          correction_state: "active",
          sensitive: false,
        },
      ] satisfies Belief[]);

      insertBriefing(
        "ctx-filtered",
        {
          title: "H4 watch",
          recommendation: { summary: "Keep watching", confidence: "medium", rationale: "Still active" },
          what_changed: [],
          evidence: [],
          memory_assumptions: [
            { statement: "Owner is tracking H4 visa slot availability in India", confidence: "high", provenance: "Memory belief (factual)" },
            { statement: "Monica thinks Suraj is self-obsessed", confidence: "high", provenance: "Memory belief (preference)" },
          ],
          next_actions: [],
          correction_hook: { prompt: "Correct anything that changed." },
        },
        "ready",
        undefined,
        {
          programs: [{
            id: "program-1",
            title: "H4 Visa Slot Availability - India",
            question: "Track H4 visa slot availability in India and tell me when something materially changes.",
            family: "general",
            executionMode: "research",
            intervalHours: 24,
            lastRunAt: null,
            nextRunAt: "2026-03-13T00:00:00.000Z",
            preferences: [],
            constraints: [],
            openQuestions: [],
          }],
          tasks: [],
          goals: [],
          knowledgeSources: [],
          beliefs: [
            {
              id: "belief_visa",
              statement: "Owner is tracking H4 visa slot availability in India",
              type: "factual",
              confidence: 0.9,
              updatedAt: "2026-03-12T00:00:00.000Z",
              accessCount: 0,
              isNew: false,
              subject: "owner",
            },
            {
              id: "belief_monica",
              statement: "Monica thinks Suraj is self-obsessed",
              type: "preference",
              confidence: 0.9,
              updatedAt: "2026-03-12T00:00:00.000Z",
              accessCount: 0,
              isNew: false,
              subject: "monica",
            },
          ],
        },
      );

      const result = getBriefingById(storage, "ctx-filtered");
      expect(result?.rawContext?.beliefs?.map((belief) => belief.id)).toEqual(["belief_visa"]);
      expect(result?.sections.memory_assumptions.map((belief) => belief.statement)).toEqual([
        "Owner is tracking H4 visa slot availability in India",
      ]);
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

  describe("brief_beliefs", () => {
    // These tests need the beliefs table to exist for FK references
    beforeEach(() => {
      storage.migrate("memory", memoryMigrations);
      // Insert test beliefs
      storage.run(
        "INSERT INTO beliefs (id, statement, confidence, status) VALUES (?, ?, ?, ?)",
        ["belief-1", "User prefers concise updates", 0.9, "active"],
      );
      storage.run(
        "INSERT INTO beliefs (id, statement, confidence, status) VALUES (?, ?, ?, ?)",
        ["belief-2", "Owner tracks H4 visa slots", 0.85, "active"],
      );
    });

    it("linkBriefBeliefs persists assumption rows", () => {
      insertBriefing("brief-link-1", { greeting: "hi" });
      linkBriefBeliefs(storage, "brief-link-1", [
        { beliefId: "belief-1", role: "assumption" },
        { beliefId: "belief-2", role: "assumption" },
      ]);

      const rows = storage.query<{ brief_id: string; belief_id: string; role: string }>(
        "SELECT brief_id, belief_id, role FROM brief_beliefs WHERE brief_id = ? ORDER BY belief_id",
        ["brief-link-1"],
      );
      expect(rows).toHaveLength(2);
      expect(rows[0]!.belief_id).toBe("belief-1");
      expect(rows[0]!.role).toBe("assumption");
      expect(rows[1]!.belief_id).toBe("belief-2");
    });

    it("linkBriefBeliefs ignores duplicates on retry", () => {
      insertBriefing("brief-dup-1", { greeting: "hi" });
      linkBriefBeliefs(storage, "brief-dup-1", [
        { beliefId: "belief-1", role: "assumption" },
      ]);
      linkBriefBeliefs(storage, "brief-dup-1", [
        { beliefId: "belief-1", role: "assumption" },
      ]);

      const rows = storage.query<{ brief_id: string }>(
        "SELECT brief_id FROM brief_beliefs WHERE brief_id = ? AND belief_id = ?",
        ["brief-dup-1", "belief-1"],
      );
      expect(rows).toHaveLength(1);
    });

    it("getBriefBeliefs returns linked belief IDs with roles", () => {
      insertBriefing("brief-get-1", { greeting: "hi" });
      linkBriefBeliefs(storage, "brief-get-1", [
        { beliefId: "belief-1", role: "assumption" },
        { beliefId: "belief-2", role: "evidence" },
      ]);

      const links = getBriefBeliefs(storage, "brief-get-1");
      expect(links).toHaveLength(2);
      expect(links.map((l) => l.beliefId).sort()).toEqual(["belief-1", "belief-2"]);
      const assumption = links.find((l) => l.beliefId === "belief-1")!;
      expect(assumption.role).toBe("assumption");
      expect(assumption.createdAt).toBeDefined();
      const evidence = links.find((l) => l.beliefId === "belief-2")!;
      expect(evidence.role).toBe("evidence");
    });

    it("getBriefBeliefs returns empty array for unknown brief", () => {
      const links = getBriefBeliefs(storage, "nonexistent-brief");
      expect(links).toEqual([]);
    });

    it("CASCADE delete removes brief_beliefs when briefing is deleted", () => {
      insertBriefing("brief-cascade-1", { greeting: "hi" });
      linkBriefBeliefs(storage, "brief-cascade-1", [
        { beliefId: "belief-1", role: "assumption" },
      ]);

      // Enable FK enforcement and delete the briefing
      storage.run("PRAGMA foreign_keys = ON");
      storage.run("DELETE FROM briefings WHERE id = ?", ["brief-cascade-1"]);

      const rows = storage.query<{ id: string }>(
        "SELECT id FROM brief_beliefs WHERE brief_id = ?",
        ["brief-cascade-1"],
      );
      expect(rows).toHaveLength(0);
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
    storage.migrate("schedules", scheduleMigrations);
    vi.clearAllMocks();
    mockListTasks.mockImplementation((_storage: Storage, status = "open") => (status === "done" ? [] : []));
    mockListGoals.mockReturnValue([]);
  });

  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function makeCtx(healthOk = true) {
    return {
      config: { timezone: "America/Los_Angeles", llm: { provider: "ollama", model: "test-model" } } as never,
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
    title: "Project Atlas launch readiness",
    recommendation: {
      summary: "Keep Project Atlas as the top watch for the next brief.",
      confidence: "medium",
      rationale: "Release blockers still matter more than broad status updates.",
    },
    what_changed: ["Rollback readiness is still unresolved."],
    evidence: [{ title: "Program definition", detail: "Track launch readiness and blockers.", sourceLabel: "Program" }],
    memory_assumptions: [{ statement: "Prioritize blocker clarity over verbose status updates", confidence: "high", provenance: "Program preference" }],
    next_actions: [{ title: "Confirm blocker owners", timing: "Today", detail: "Make sure each open blocker has an owner and next step." }],
    correction_hook: { prompt: "Correction: tell pai what changed or what should matter more next time." },
  };

  it("falls back to a deterministic brief when LLM health check fails", async () => {
    const ctx = makeCtx(false);
    const result = await generateBriefing(ctx);
    expect(result).not.toBeNull();
    expect(result!.status).toBe("ready");
    expect(result!.sections.recommendation.summary).toContain("watch");
  });

  it("falls back to a deterministic brief when LLM health check throws", async () => {
    const ctx = makeCtx();
    (ctx as { llm: { health: ReturnType<typeof vi.fn> } }).llm.health = vi.fn().mockRejectedValue(new Error("connection refused"));
    const result = await generateBriefing(ctx);
    expect(result).not.toBeNull();
    expect(result!.sections.evidence.length).toBeGreaterThan(0);
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
    expect(result!.sections.recommendation.summary).toBe("Keep Project Atlas as the top watch for the next brief.");
    expect(result!.sections.what_changed).toHaveLength(1);
    expect(result!.sections.next_actions).toHaveLength(1);

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
    expect(result!.sections.recommendation.summary).toBe("Keep Project Atlas as the top watch for the next brief.");
  });

  it("falls back to a deterministic brief when generateText throws", async () => {
    const { generateText } = await import("ai");
    (generateText as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("LLM unavailable"));

    const ctx = makeCtx(true);
    const result = await generateBriefing(ctx);

    expect(result).not.toBeNull();
    expect(result!.status).toBe("ready");
    expect(result!.sections.correction_hook.prompt).toContain("Correction");
  });

  it("falls back to a deterministic brief when response is invalid JSON", async () => {
    const { generateText } = await import("ai");
    (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: "This is not JSON at all",
    });

    const ctx = makeCtx(true);
    const result = await generateBriefing(ctx);

    expect(result).not.toBeNull();
    expect(result!.status).toBe("ready");
    expect(result!.sections.memory_assumptions.length).toBeGreaterThan(0);
  });

  it("skips creating a new ready daily brief when the signal hash is unchanged for maintenance runs", async () => {
    const { generateText } = await import("ai");
    (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: JSON.stringify(sampleSections),
    });

    const ctx = makeCtx(true);
    const first = await generateBriefing(ctx);
    const second = await generateBriefing(ctx);

    expect(first).not.toBeNull();
    expect(second).toBeNull();

    const readyDaily = storage.query<{ cnt: number }>(
      "SELECT COUNT(*) as cnt FROM briefings WHERE type = 'daily' AND status = 'ready'",
    )[0]?.cnt ?? 0;
    const failedDaily = storage.query<{ cnt: number }>(
      "SELECT COUNT(*) as cnt FROM briefings WHERE type = 'daily' AND status = 'failed'",
    )[0]?.cnt ?? 0;
    expect(readyDaily).toBe(1);
    expect(failedDaily).toBe(1);
  });

  it("still allows manual refreshes even when the signal hash is unchanged", async () => {
    const { generateText } = await import("ai");
    (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: JSON.stringify(sampleSections),
    });

    const ctx = makeCtx(true);
    const first = await generateBriefing(ctx);
    const manualId = enqueueBriefingGeneration(storage, "manual");
    const manualRefresh = await generateBriefing(ctx, undefined, manualId);

    expect(first).not.toBeNull();
    expect(manualRefresh).not.toBeNull();
    expect(manualRefresh!.status).toBe("ready");

    const readyDaily = storage.query<{ cnt: number }>(
      "SELECT COUNT(*) as cnt FROM briefings WHERE type = 'daily' AND status = 'ready'",
    )[0]?.cnt ?? 0;
    expect(readyDaily).toBe(2);
  });

  it("prioritizes open linked program actions in deterministic fallback briefs", async () => {
    const program = createProgram(storage, {
      title: "Project Atlas launch readiness",
      question: "Track blockers, rollback readiness, and launch signoff for Project Atlas.",
      family: "work",
      executionMode: "research",
      intervalHours: 168,
      preferences: ["Prioritize blocker clarity over verbose updates."],
      constraints: ["Rollback readiness is required."],
      openQuestions: ["Who owns the last blocker?"],
    });

    mockListTasks.mockImplementation((_storage: Storage, status = "open") => {
      if (status === "done") return [];
      return [{
        id: "task_action_1",
        title: "Confirm blocker owners",
        description: "Make sure each blocker has an owner and next step.",
        status: "open",
        priority: "high",
        goal_id: null,
        due_date: null,
        created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        completed_at: null,
        source_type: "program",
        source_id: program.id,
        source_label: program.title,
      }];
    });

    const ctx = makeCtx(false);
    const result = await generateBriefing(ctx);

    expect(result).not.toBeNull();
    expect(result!.sections.recommendation.summary).toBe(`Close the open linked action for ${program.title} before broadening the next watch.`);
    expect(result!.sections.next_actions[0]?.title).toBe("Confirm blocker owners");
    expect(result!.sections.evidence[0]?.sourceLabel).toBe("Program action");

    const persisted = getBriefingById(storage, result!.id);
    const rawContext = persisted?.rawContext as { actionSignals?: Array<{ sourceId: string; openCount: number }> } | undefined;
    expect(rawContext?.actionSignals?.[0]?.sourceId).toBe(program.id);
    expect(rawContext?.actionSignals?.[0]?.openCount).toBe(1);
  });

  it("uses completed linked actions as a change signal and removes them from next actions", async () => {
    const { generateText } = await import("ai");
    const program = createProgram(storage, {
      title: "Project Atlas launch readiness",
      question: "Track blockers, rollback readiness, and launch signoff for Project Atlas.",
      family: "work",
      executionMode: "research",
      intervalHours: 168,
    });

    mockListTasks.mockImplementation((_storage: Storage, status = "open") => {
      if (status === "done") {
        return [{
          id: "task_action_done",
          title: "Confirm blocker owners",
          description: "Make sure each blocker has an owner and next step.",
          status: "done",
          priority: "high",
          goal_id: null,
          due_date: null,
          created_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          completed_at: new Date().toISOString(),
          source_type: "program",
          source_id: program.id,
          source_label: program.title,
        }];
      }
      return [];
    });

    (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: JSON.stringify({
        ...sampleSections,
        next_actions: [{ title: "Confirm blocker owners", timing: "Today", detail: "Repeat the already-completed follow-through." }],
      }),
    });

    const ctx = makeCtx(true);
    const result = await generateBriefing(ctx);

    expect(result).not.toBeNull();
    expect(result!.sections.next_actions.map((action) => action.title)).not.toContain("Confirm blocker owners");
    expect(result!.sections.what_changed[0]).toContain("completed recently");
    expect(result!.sections.evidence[0]?.title).toBe("Completed linked action");
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("LINKED ACTION SIGNALS (1):"),
      }),
    );
  });

  it("links beliefs to the briefing after successful generation", async () => {
    // Need the memory tables for FK constraints on brief_beliefs
    storage.migrate("memory", memoryMigrations);

    // Insert beliefs into DB so FK constraint is satisfied
    storage.run(
      "INSERT INTO beliefs (id, statement, confidence, status, subject, origin) VALUES (?, ?, ?, ?, ?, ?)",
      ["belief-gen-1", "Prefers concise updates", 0.9, "active", "owner", "user-said"],
    );
    storage.run(
      "INSERT INTO beliefs (id, statement, confidence, status, subject, origin) VALUES (?, ?, ?, ?, ?, ?)",
      ["belief-gen-2", "Tracks H4 visa slots", 0.85, "active", "owner", "inferred"],
    );

    // mockListBeliefs returns these beliefs so selectBriefingBeliefs picks them
    mockListBeliefs.mockReturnValue([
      {
        id: "belief-gen-1",
        statement: "Prefers concise updates",
        type: "preference",
        confidence: 0.9,
        status: "active",
        created_at: "2026-03-12T00:00:00.000Z",
        updated_at: "2026-03-12T00:00:00.000Z",
        superseded_by: null,
        supersedes: null,
        importance: 7,
        last_accessed: null,
        access_count: 0,
        stability: 1,
        subject: "owner",
        origin: "user-said",
        freshness_at: null,
        correction_state: "active",
        sensitive: false,
      },
      {
        id: "belief-gen-2",
        statement: "Tracks H4 visa slots",
        type: "factual",
        confidence: 0.85,
        status: "active",
        created_at: "2026-03-12T00:00:00.000Z",
        updated_at: "2026-03-12T00:00:00.000Z",
        superseded_by: null,
        supersedes: null,
        importance: 6,
        last_accessed: null,
        access_count: 0,
        stability: 1,
        subject: "owner",
        origin: "inferred",
        freshness_at: null,
        correction_state: "active",
        sensitive: false,
      },
    ]);

    const ctx = makeCtx(false); // deterministic fallback — no LLM needed
    const result = await generateBriefing(ctx);

    expect(result).not.toBeNull();
    expect(result!.status).toBe("ready");

    const links = getBriefBeliefs(storage, result!.id);
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((l) => l.role === "assumption")).toBe(true);
    // All linked belief IDs should be from the beliefs we provided
    for (const link of links) {
      expect(["belief-gen-1", "belief-gen-2"]).toContain(link.beliefId);
    }
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
        timeout: {
          totalMs: 2 * 60_000,
          stepMs: 60_000,
        },
      }),
    );
  });
});

describe("selectBriefingBeliefs", () => {
  function makeBelief(overrides: Partial<Belief> & Pick<Belief, "id" | "statement" | "type">): Belief {
    return {
      id: overrides.id,
      statement: overrides.statement,
      type: overrides.type,
      confidence: overrides.confidence ?? 0.8,
      status: overrides.status ?? "active",
      created_at: overrides.created_at ?? "2026-03-12T00:00:00.000Z",
      updated_at: overrides.updated_at ?? "2026-03-12T00:00:00.000Z",
      superseded_by: overrides.superseded_by ?? null,
      supersedes: overrides.supersedes ?? null,
      importance: overrides.importance ?? 5,
      last_accessed: overrides.last_accessed ?? null,
      access_count: overrides.access_count ?? 0,
      stability: overrides.stability ?? 1,
      subject: overrides.subject ?? "owner",
      origin: overrides.origin ?? "inferred",
      freshness_at: overrides.freshness_at ?? null,
      correction_state: overrides.correction_state ?? "active",
      sensitive: overrides.sensitive ?? false,
    };
  }

  it("keeps relevant owner context while excluding unrelated personal beliefs", () => {
    const beliefs: Belief[] = [
      makeBelief({
        id: "pref-change",
        statement: "Prefers receiving updates only when something materially changes",
        type: "preference",
        confidence: 0.92,
        origin: "user-said",
      }),
      makeBelief({
        id: "visa-track",
        statement: "Owner is tracking H4 visa slot availability in India",
        type: "factual",
        confidence: 0.88,
      }),
      makeBelief({
        id: "skills",
        statement: "User knows Java, TypeScript, Python and speaks Telugu, Hindi, English.",
        type: "factual",
        confidence: 0.82,
      }),
      makeBelief({
        id: "monica-social",
        statement: "Monica thinks Suraj is self-obsessed",
        type: "preference",
        confidence: 0.84,
        subject: "monica",
      }),
      makeBelief({
        id: "monica-visa",
        statement: "Monica matters for H4 visa tracking decisions",
        type: "factual",
        confidence: 0.84,
        subject: "monica",
      }),
    ];

    const selected = selectBriefingBeliefs(beliefs, {
      programs: [{
        id: "program-1",
        title: "H4 Visa Slot Availability - India",
        question: "Track H4 visa slot availability in India and only notify when something materially changes.",
        family: "general",
        executionMode: "research",
        intervalHours: 24,
        lastRunAt: null,
        nextRunAt: "2026-03-13T00:00:00.000Z",
        preferences: [],
        constraints: [],
        openQuestions: [],
      }],
      tasks: [],
      goals: [],
      knowledgeSources: [],
    });

    expect(selected.map((belief) => belief.id)).toContain("pref-change");
    expect(selected.map((belief) => belief.id)).toContain("visa-track");
    expect(selected.map((belief) => belief.id)).not.toContain("skills");
    expect(selected.map((belief) => belief.id)).not.toContain("monica-social");
    expect(selected.map((belief) => belief.id)).not.toContain("monica-visa");
  });

  it("preserves non-owner beliefs when the watch explicitly names that subject", () => {
    const beliefs: Belief[] = [
      makeBelief({
        id: "monica-h4",
        statement: "Monica is waiting for H4 visa appointment availability in India",
        type: "factual",
        confidence: 0.91,
        subject: "monica",
        origin: "user-said",
      }),
    ];

    const selected = selectBriefingBeliefs(beliefs, {
      programs: [{
        id: "program-2",
        title: "Monica H4 visa watch",
        question: "Track Monica's H4 visa appointment availability in India and tell me when her options change.",
        family: "general",
        executionMode: "research",
        intervalHours: 24,
        lastRunAt: null,
        nextRunAt: "2026-03-13T00:00:00.000Z",
        preferences: [],
        constraints: [],
        openQuestions: [],
      }],
      tasks: [],
      goals: [],
      knowledgeSources: [],
    });

    expect(selected.map((belief) => belief.id)).toContain("monica-h4");
  });
});

// ---------------------------------------------------------------------------
// buildBriefingDelta tests
// ---------------------------------------------------------------------------
describe("buildBriefingDelta", () => {
  let dir: string;
  let storage: Storage;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pai-delta-test-"));
    storage = createStorage(dir);
    storage.migrate("briefing", briefingMigrations);
    storage.migrate("findings", findingsMigrations);
  });

  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns empty delta when no data exists", () => {
    const delta = buildBriefingDelta(storage, new Date().toISOString());
    expect(delta.newFindings).toHaveLength(0);
    expect(delta.changedInsights).toHaveLength(0);
    expect(delta.newBeliefs).toHaveLength(0);
    expect(delta.correctedBeliefs).toHaveLength(0);
    expect(delta.completedActions).toHaveLength(0);
  });

  it("picks up new findings created after sinceTimestamp", () => {
    const oldTimestamp = "2025-01-01T00:00:00.000Z";
    createFinding(storage, {
      goal: "GPU prices",
      domain: "general",
      summary: "RTX 4090 dropped to $1499.",
      confidence: 0.85,
      agentName: "Researcher",
      depthLevel: "standard",
      sources: [],
      watchId: "watch-1",
    });

    const delta = buildBriefingDelta(storage, oldTimestamp);
    expect(delta.newFindings.length).toBeGreaterThan(0);
    expect(delta.newFindings[0].summary).toContain("RTX 4090");
  });

  it("excludes findings older than sinceTimestamp", () => {
    createFinding(storage, {
      goal: "Old finding",
      domain: "general",
      summary: "Old data.",
      confidence: 0.5,
      agentName: "test",
      depthLevel: "quick",
      sources: [],
    });

    // Use a future timestamp
    const futureTimestamp = new Date(Date.now() + 60_000).toISOString();
    const delta = buildBriefingDelta(storage, futureTimestamp);
    expect(delta.newFindings).toHaveLength(0);
  });

  it("includes finding deltas when present", () => {
    createFinding(storage, {
      goal: "GPU prices",
      domain: "general",
      summary: "RTX 4090 is $1599.",
      confidence: 0.85,
      agentName: "Researcher",
      depthLevel: "standard",
      sources: [],
      delta: { changed: ["+ Price dropped $100."], significance: 0.5 },
    });

    const delta = buildBriefingDelta(storage, "2025-01-01T00:00:00.000Z");
    expect(delta.newFindings[0].delta).toBeDefined();
    expect(delta.newFindings[0].delta!.changed).toContain("+ Price dropped $100.");
  });
});

// ---------------------------------------------------------------------------
// signal_hash on daily briefs
// ---------------------------------------------------------------------------
describe("signal_hash on daily briefs", () => {
  let dir: string;
  let storage: Storage;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pai-hash-test-"));
    storage = createStorage(dir);
    storage.migrate("briefing", briefingMigrations);
    storage.migrate("schedules", scheduleMigrations);
    vi.clearAllMocks();
    mockListTasks.mockImplementation((_storage: Storage, status = "open") => (status === "done" ? [] : []));
    mockListGoals.mockReturnValue([]);
  });

  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function makeCtx(healthOk = true) {
    return {
      config: { timezone: "America/Los_Angeles", llm: { provider: "ollama", model: "test-model" } } as never,
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

  it("populates signal_hash on generated daily briefing", async () => {
    const ctx = makeCtx(false); // deterministic fallback
    const result = await generateBriefing(ctx);

    expect(result).not.toBeNull();
    expect(result!.signalHash).toBeDefined();
    expect(typeof result!.signalHash).toBe("string");
    expect(result!.signalHash!.length).toBe(64); // SHA-256 hex

    // Verify it's persisted in DB
    const row = storage.query<{ signal_hash: string | null }>(
      "SELECT signal_hash FROM briefings WHERE id = ?",
      [result!.id],
    );
    expect(row[0]?.signal_hash).toBe(result!.signalHash);
  });

  it("produces the same hash for identical content", async () => {
    const ctx = makeCtx(false);
    const result1 = await generateBriefing(ctx);

    // Clear the briefing so we can generate again
    storage.run("DELETE FROM briefings");

    const result2 = await generateBriefing(ctx);

    expect(result1!.signalHash).toBe(result2!.signalHash);
  });
});

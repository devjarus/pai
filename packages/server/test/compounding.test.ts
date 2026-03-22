import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStorage, memoryMigrations, knowledgeMigrations, threadMigrations, productEventMigrations } from "@personal-ai/core";
import { scheduleMigrations } from "@personal-ai/plugin-schedules";
import { findingsMigrations, insightMigrations, createFinding } from "@personal-ai/library";
import { runWeeklyCompounding } from "../src/compounding.js";
import type { PluginContext } from "@personal-ai/core";

describe("runWeeklyCompounding", () => {
  let dir: string;
  let storage: ReturnType<typeof createStorage>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pai-compounding-"));
    storage = createStorage(dir);
    storage.migrate("memory", memoryMigrations);
    storage.migrate("knowledge", knowledgeMigrations);
    storage.migrate("threads", threadMigrations);
    storage.migrate("product_events", productEventMigrations);
    storage.migrate("schedules", scheduleMigrations);
    storage.migrate("findings", findingsMigrations);
    storage.migrate("topic_insights", insightMigrations);
  });

  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("skips watches with fewer than 3 findings", async () => {
    // Create a watch
    storage.run(
      "INSERT INTO scheduled_jobs (id, label, type, goal, interval_hours, next_run_at, status) VALUES (?, ?, ?, ?, ?, datetime('now'), 'active')",
      ["w1", "AI Watch", "research", "Track AI", 24],
    );
    // Only 2 findings — not enough
    createFinding(storage, { watchId: "w1", goal: "AI", domain: "general", summary: "Finding 1", confidence: 0.7, agentName: "test", depthLevel: "standard", sources: [] });
    createFinding(storage, { watchId: "w1", goal: "AI", domain: "general", summary: "Finding 2", confidence: 0.7, agentName: "test", depthLevel: "standard", sources: [] });

    const ctx = {
      storage,
      llm: { chat: vi.fn(), embed: vi.fn(), health: vi.fn(), getModel: vi.fn() },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      config: { llm: { provider: "ollama" } },
    } as unknown as PluginContext;

    const result = await runWeeklyCompounding(ctx);
    expect(result.watchesProcessed).toBe(0);
    expect(result.insightsCreated).toBe(0);
  });

  it("skips watches without 3 credible findings after confidence filtering", async () => {
    storage.run(
      "INSERT INTO scheduled_jobs (id, label, type, goal, interval_hours, next_run_at, status) VALUES (?, ?, ?, ?, ?, datetime('now'), 'active')",
      ["w-low", "Weak Watch", "research", "Track weak signals", 24],
    );
    for (let i = 1; i <= 4; i++) {
      createFinding(storage, {
        watchId: "w-low",
        goal: "Weak signals",
        domain: "general",
        summary: `Weak finding ${i}`,
        confidence: 0.4,
        agentName: "test",
        depthLevel: "standard",
        sources: [],
      });
    }

    const mockChat = vi.fn().mockResolvedValue({ text: "[]" });
    const ctx = {
      storage,
      llm: { chat: mockChat, embed: vi.fn(), health: vi.fn(), getModel: vi.fn() },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      config: { llm: { provider: "ollama" } },
    } as unknown as PluginContext;

    const result = await runWeeklyCompounding(ctx);
    expect(result.watchesProcessed).toBe(0);
    expect(mockChat).not.toHaveBeenCalled();
  });

  it("processes watches with 3+ findings", async () => {
    storage.run(
      "INSERT INTO scheduled_jobs (id, label, type, goal, interval_hours, next_run_at, status) VALUES (?, ?, ?, ?, ?, datetime('now'), 'active')",
      ["w1", "AI Watch", "research", "Track AI agents", 24],
    );
    for (let i = 1; i <= 4; i++) {
      const finding = createFinding(storage, { watchId: "w1", goal: "AI agents", domain: "general", summary: `Finding ${i} about AI agent trends`, confidence: 0.7, agentName: "test", depthLevel: "standard", sources: [] });
      storage.run(
        "UPDATE research_findings SET created_at = ?, updated_at = ? WHERE id = ?",
        [`2026-03-0${i}T0${i}:00:00Z`, `2026-03-0${i}T0${i}:00:00Z`, finding.id],
      );
    }

    const mockChat = vi.fn().mockResolvedValue({
      text: JSON.stringify([
        { insight: "AI agent frameworks are consolidating rapidly", confidence: 0.8, sourceNumbers: [1, 3] },
      ]),
    });

    const ctx = {
      storage,
      llm: { chat: mockChat, embed: vi.fn(), health: vi.fn(), getModel: vi.fn() },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      config: { llm: { provider: "ollama" } },
    } as unknown as PluginContext;

    const result = await runWeeklyCompounding(ctx);
    expect(result.watchesProcessed).toBe(1);
    expect(result.insightsCreated).toBe(1);
    expect(mockChat).toHaveBeenCalledTimes(1);

    const storedInsights = storage.query<{ insight: string; sources_json: string }>(
      "SELECT insight, sources_json FROM topic_insights WHERE watch_id = ?",
      ["w1"],
    );
    expect(storedInsights).toHaveLength(1);
    expect(storedInsights[0]?.insight).toContain("consolidating rapidly");
    const recentFindings = storage.query<{ id: string }>(
      "SELECT id FROM research_findings WHERE watch_id = ? ORDER BY created_at DESC, rowid DESC",
      ["w1"],
    );
    expect(JSON.parse(storedInsights[0]!.sources_json)).toEqual([recentFindings[0]!.id, recentFindings[2]!.id]);
  });

  it("skips unsupported insights and updates matching insights instead of duplicating them", async () => {
    storage.run(
      "INSERT INTO scheduled_jobs (id, label, type, goal, interval_hours, next_run_at, status) VALUES (?, ?, ?, ?, ?, datetime('now'), 'active')",
      ["w2", "Infra Watch", "research", "Track inference infra", 24],
    );
    for (let i = 1; i <= 4; i++) {
      createFinding(storage, { watchId: "w2", goal: "Inference infra", domain: "general", summary: `Finding ${i} about inference infra`, confidence: 0.8, agentName: "test", depthLevel: "standard", sources: [] });
    }
    storage.run(
      "INSERT INTO topic_insights (id, watch_id, topic, insight, confidence, cycle_count, sources_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ["ins-1", "w2", "Infra Watch", "Inference stacks are consolidating around fewer platform vendors", 0.8, 2, JSON.stringify(["f-old"])],
    );

    const mockChat = vi.fn().mockResolvedValue({
      text: JSON.stringify([
        { insight: "Inference stacks are consolidating around fewer platform vendors", confidence: 0.85, sourceNumbers: [1, 2], isUpdate: true },
        { insight: "Inference stacks are consolidating around fewer platform vendors", confidence: 0.84, sourceNumbers: [2, 3], isUpdate: true },
        { insight: "Teams are running evaluations more often before model upgrades", confidence: 0.8, sourceNumbers: [1], isUpdate: false },
      ]),
    });

    const ctx = {
      storage,
      llm: { chat: mockChat, embed: vi.fn(), health: vi.fn(), getModel: vi.fn() },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      config: { llm: { provider: "ollama" } },
    } as unknown as PluginContext;

    const result = await runWeeklyCompounding(ctx);
    expect(result.watchesProcessed).toBe(1);
    expect(result.insightsUpdated).toBe(1);
    expect(result.insightsCreated).toBe(0);

    const storedInsights = storage.query<{ id: string; insight: string; cycle_count: number; sources_json: string }>(
      "SELECT id, insight, cycle_count, sources_json FROM topic_insights WHERE watch_id = ? ORDER BY id",
      ["w2"],
    );
    expect(storedInsights).toHaveLength(1);
    expect(storedInsights[0]?.id).toBe("ins-1");
    expect(storedInsights[0]?.cycle_count).toBe(3);
    expect(JSON.parse(storedInsights[0]!.sources_json)).toHaveLength(3);
  });
});

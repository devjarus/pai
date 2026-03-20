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

  it("processes watches with 3+ findings", async () => {
    storage.run(
      "INSERT INTO scheduled_jobs (id, label, type, goal, interval_hours, next_run_at, status) VALUES (?, ?, ?, ?, ?, datetime('now'), 'active')",
      ["w1", "AI Watch", "research", "Track AI agents", 24],
    );
    for (let i = 1; i <= 4; i++) {
      createFinding(storage, { watchId: "w1", goal: "AI agents", domain: "general", summary: `Finding ${i} about AI agent trends`, confidence: 0.7, agentName: "test", depthLevel: "standard", sources: [] });
    }

    const mockChat = vi.fn().mockResolvedValue({
      text: JSON.stringify([
        { insight: "AI agent frameworks are consolidating rapidly", confidence: 0.8 },
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
  });
});

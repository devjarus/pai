import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStorage } from "@personal-ai/core";
import { insightMigrations, createInsight, updateInsight, getInsight, listInsights, deleteInsight, deleteInsightsForWatch } from "../src/insights.js";

describe("topic insights", () => {
  let dir: string;
  let storage: ReturnType<typeof createStorage>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pai-insights-"));
    storage = createStorage(dir);
    storage.migrate("topic_insights", insightMigrations);
  });

  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates and retrieves an insight", () => {
    const insight = createInsight(storage, {
      watchId: "w1",
      topic: "AI Agents",
      insight: "Agent frameworks consolidating around LangChain and CrewAI",
      confidence: 0.8,
      sources: ["f1", "f2"],
    });
    expect(insight.id).toBeDefined();
    expect(insight.topic).toBe("AI Agents");
    expect(insight.confidence).toBe(0.8);
    expect(insight.sources).toEqual(["f1", "f2"]);

    const retrieved = getInsight(storage, insight.id);
    expect(retrieved).toEqual(insight);
  });

  it("updates an existing insight", () => {
    const insight = createInsight(storage, { topic: "BTC", insight: "Declining trend", confidence: 0.7 });
    const updated = updateInsight(storage, insight.id, {
      insight: "3-week decline, now recovering",
      confidence: 0.85,
      cycleCount: 3,
      sources: ["f1", "f2", "f3"],
    });
    expect(updated!.insight).toBe("3-week decline, now recovering");
    expect(updated!.confidence).toBe(0.85);
    expect(updated!.cycleCount).toBe(3);
  });

  it("lists insights by watch", () => {
    createInsight(storage, { watchId: "w1", topic: "AI", insight: "insight 1" });
    createInsight(storage, { watchId: "w1", topic: "AI", insight: "insight 2" });
    createInsight(storage, { watchId: "w2", topic: "BTC", insight: "insight 3" });

    expect(listInsights(storage, "w1")).toHaveLength(2);
    expect(listInsights(storage, "w2")).toHaveLength(1);
    expect(listInsights(storage)).toHaveLength(3);
  });

  it("deletes an insight", () => {
    const insight = createInsight(storage, { topic: "test", insight: "to delete" });
    expect(deleteInsight(storage, insight.id)).toBe(true);
    expect(getInsight(storage, insight.id)).toBeNull();
  });

  it("deletes all insights for a watch", () => {
    createInsight(storage, { watchId: "w1", topic: "AI", insight: "a" });
    createInsight(storage, { watchId: "w1", topic: "AI", insight: "b" });
    createInsight(storage, { watchId: "w2", topic: "BTC", insight: "c" });

    expect(deleteInsightsForWatch(storage, "w1")).toBe(2);
    expect(listInsights(storage)).toHaveLength(1);
  });

  it("returns null for non-existent insight", () => {
    expect(getInsight(storage, "nonexistent")).toBeNull();
    expect(updateInsight(storage, "nonexistent", { insight: "x" })).toBeNull();
    expect(deleteInsight(storage, "nonexistent")).toBe(false);
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createStorage } from "@personal-ai/core";
import { memoryMigrations, createEpisode, listEpisodes, createBelief, searchBeliefs, listBeliefs, linkBeliefToEpisode, reinforceBelief, effectiveConfidence, logBeliefChange, getBeliefHistory, getMemoryContext } from "../src/memory.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Memory", () => {
  let storage: ReturnType<typeof createStorage>;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pai-mem-"));
    storage = createStorage(dir);
    storage.migrate("memory", memoryMigrations);
  });

  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("should create and list episodes", () => {
    createEpisode(storage, { context: "testing", action: "wrote a test", outcome: "passed" });
    const episodes = listEpisodes(storage);
    expect(episodes).toHaveLength(1);
    expect(episodes[0]!.action).toBe("wrote a test");
  });

  it("should create and search beliefs", () => {
    createBelief(storage, { statement: "TypeScript is better than JavaScript for large projects", confidence: 0.8 });
    createBelief(storage, { statement: "SQLite is great for local-first apps", confidence: 0.9 });
    const results = searchBeliefs(storage, "SQLite local");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.statement).toContain("SQLite");
  });

  it("should list active beliefs", () => {
    createBelief(storage, { statement: "test belief", confidence: 0.5 });
    const beliefs = listBeliefs(storage);
    expect(beliefs).toHaveLength(1);
    expect(beliefs[0]!.status).toBe("active");
  });

  it("should link belief to episode", () => {
    const ep = createEpisode(storage, { context: "test", action: "observed", outcome: "learned" });
    const belief = createBelief(storage, { statement: "observation is useful", confidence: 0.6 });
    linkBeliefToEpisode(storage, belief.id, ep.id);
    // No error = success
  });

  it("should reinforce belief and increase confidence", () => {
    const belief = createBelief(storage, { statement: "test belief", confidence: 0.5 });
    reinforceBelief(storage, belief.id);
    const beliefs = listBeliefs(storage);
    expect(beliefs[0]!.confidence).toBeCloseTo(0.6);
  });

  it("should cap reinforced belief confidence at 1.0", () => {
    const belief = createBelief(storage, { statement: "strong belief", confidence: 0.95 });
    reinforceBelief(storage, belief.id, 0.2);
    const beliefs = listBeliefs(storage);
    expect(beliefs[0]!.confidence).toBeLessThanOrEqual(1.0);
  });

  it("should handle FTS5 operator words in search query", () => {
    createBelief(storage, { statement: "SQLite is NOT slow for local apps", confidence: 0.8 });
    const results = searchBeliefs(storage, "NOT slow");
    expect(results.length).toBeGreaterThan(0);
  });

  it("should handle empty search query gracefully", () => {
    createBelief(storage, { statement: "some belief", confidence: 0.5 });
    const results = searchBeliefs(storage, "   ");
    expect(results).toHaveLength(0);
  });

  it("should handle special characters in search query", () => {
    createBelief(storage, { statement: "C++ is fast for systems programming", confidence: 0.7 });
    const results = searchBeliefs(storage, "C++ fast");
    expect(results.length).toBeGreaterThan(0);
  });

  it("should return full confidence for recently updated belief", () => {
    const belief = createBelief(storage, { statement: "fresh belief", confidence: 0.8 });
    expect(effectiveConfidence(belief)).toBeCloseTo(0.8, 1);
  });

  it("should decay confidence for old beliefs", () => {
    const belief = createBelief(storage, { statement: "old belief", confidence: 0.8 });
    storage.run(
      "UPDATE beliefs SET updated_at = datetime('now', '-30 days') WHERE id = ?",
      [belief.id],
    );
    const [updated] = storage.query<typeof belief>("SELECT * FROM beliefs WHERE id = ?", [belief.id]);
    expect(effectiveConfidence(updated!)).toBeCloseTo(0.4, 1);
  });

  it("should decay to near-zero for very old beliefs", () => {
    const belief = createBelief(storage, { statement: "ancient belief", confidence: 0.8 });
    storage.run(
      "UPDATE beliefs SET updated_at = datetime('now', '-120 days') WHERE id = ?",
      [belief.id],
    );
    const [updated] = storage.query<typeof belief>("SELECT * FROM beliefs WHERE id = ?", [belief.id]);
    expect(effectiveConfidence(updated!)).toBeLessThan(0.1);
  });

  it("should list beliefs with decay-adjusted confidence", () => {
    createBelief(storage, { statement: "fresh belief", confidence: 0.8 });
    const belief2 = createBelief(storage, { statement: "stale belief", confidence: 0.8 });
    storage.run(
      "UPDATE beliefs SET updated_at = datetime('now', '-60 days') WHERE id = ?",
      [belief2.id],
    );
    const beliefs = listBeliefs(storage);
    expect(beliefs[0]!.confidence).toBeGreaterThan(beliefs[1]!.confidence);
  });

  it("should log a belief change", () => {
    const belief = createBelief(storage, { statement: "test belief", confidence: 0.5 });
    const ep = createEpisode(storage, { action: "observed something" });
    logBeliefChange(storage, {
      beliefId: belief.id,
      changeType: "created",
      detail: "Initial creation",
      episodeId: ep.id,
    });
    const history = getBeliefHistory(storage, belief.id);
    expect(history).toHaveLength(1);
    expect(history[0]!.change_type).toBe("created");
  });

  it("should return history in reverse chronological order", () => {
    const belief = createBelief(storage, { statement: "evolving belief", confidence: 0.5 });
    logBeliefChange(storage, { beliefId: belief.id, changeType: "created", detail: "Born" });
    logBeliefChange(storage, { beliefId: belief.id, changeType: "reinforced", detail: "Confirmed" });
    const history = getBeliefHistory(storage, belief.id);
    expect(history).toHaveLength(2);
    expect(history[0]!.change_type).toBe("reinforced");
  });

  it("should return formatted context with beliefs and episodes", () => {
    createBelief(storage, { statement: "TypeScript catches bugs early", confidence: 0.8 });
    createEpisode(storage, { action: "Wrote tests for memory plugin", outcome: "all passed" });

    const context = getMemoryContext(storage, "TypeScript");
    expect(context).toContain("Relevant beliefs");
    expect(context).toContain("TypeScript catches bugs early");
    expect(context).toContain("Recent observations");
    expect(context).toContain("Wrote tests for memory plugin");
  });

  it("should return empty sections gracefully", () => {
    const context = getMemoryContext(storage, "nonexistent topic");
    expect(context).toContain("No relevant beliefs");
    expect(context).toContain("Recent observations");
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createStorage } from "@personal-ai/core";
import { memoryMigrations, createEpisode, listEpisodes, createBelief, searchBeliefs, listBeliefs, linkBeliefToEpisode, reinforceBelief } from "../src/memory.js";
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
});

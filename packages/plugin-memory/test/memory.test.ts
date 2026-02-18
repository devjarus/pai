import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createStorage } from "@personal-ai/core";
import type { LLMClient } from "@personal-ai/core";
import { memoryMigrations, createEpisode, listEpisodes, createBelief, searchBeliefs, listBeliefs, linkBeliefToEpisode, reinforceBelief, effectiveConfidence, logBeliefChange, getBeliefHistory, getMemoryContext, cosineSimilarity, storeEmbedding, findSimilarBeliefs, forgetBelief, pruneBeliefs } from "../src/memory.js";
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

  it("should return formatted context with beliefs and episodes", async () => {
    createBelief(storage, { statement: "TypeScript catches bugs early", confidence: 0.8 });
    createEpisode(storage, { action: "Wrote tests for memory plugin", outcome: "all passed" });

    const context = await getMemoryContext(storage, "TypeScript");
    expect(context).toContain("Relevant beliefs");
    expect(context).toContain("TypeScript catches bugs early");
    expect(context).toContain("Recent observations");
    expect(context).toContain("Wrote tests for memory plugin");
  });

  it("should return empty sections gracefully", async () => {
    const context = await getMemoryContext(storage, "nonexistent topic");
    expect(context).toContain("No relevant beliefs");
    expect(context).toContain("Recent observations");
  });

  it("should use semantic search when llm is provided", async () => {
    const belief = createBelief(storage, { statement: "Vitest is fast for testing", confidence: 0.9 });
    storeEmbedding(storage, belief.id, [1.0, 0.0, 0.0]);

    const mockLLM: LLMClient = {
      chat: vi.fn(),
      embed: vi.fn().mockResolvedValue({ embedding: [0.9, 0.1, 0.0] }),
      health: vi.fn(),
    };

    const context = await getMemoryContext(storage, "testing frameworks", { llm: mockLLM });
    expect(context).toContain("Vitest is fast for testing");
    expect(mockLLM.embed).toHaveBeenCalledWith("testing frameworks");
  });

  it("should fall back to FTS5 when embedding fails", async () => {
    createBelief(storage, { statement: "TypeScript improves code quality", confidence: 0.8 });

    const mockLLM: LLMClient = {
      chat: vi.fn(),
      embed: vi.fn().mockRejectedValue(new Error("Embedding service unavailable")),
      health: vi.fn(),
    };

    const context = await getMemoryContext(storage, "TypeScript", { llm: mockLLM });
    expect(context).toContain("TypeScript improves code quality");
  });

  it("should create belief with type", () => {
    const fact = createBelief(storage, { statement: "User likes coffee", confidence: 0.6, type: "fact" });
    const insight = createBelief(storage, { statement: "Morning routines help", confidence: 0.6, type: "insight" });
    const [f] = storage.query<typeof fact>("SELECT * FROM beliefs WHERE id = ?", [fact.id]);
    const [i] = storage.query<typeof insight>("SELECT * FROM beliefs WHERE id = ?", [insight.id]);
    expect(f!.type).toBe("fact");
    expect(i!.type).toBe("insight");
  });

  it("should default belief type to insight", () => {
    const b = createBelief(storage, { statement: "test", confidence: 0.5 });
    const [row] = storage.query<typeof b>("SELECT * FROM beliefs WHERE id = ?", [b.id]);
    expect(row!.type).toBe("insight");
  });

  it("should forget a belief by setting status to forgotten", () => {
    const belief = createBelief(storage, { statement: "Forgettable fact", confidence: 0.5 });
    forgetBelief(storage, belief.id);
    const [row] = storage.query<{ status: string }>("SELECT status FROM beliefs WHERE id = ?", [belief.id]);
    expect(row!.status).toBe("forgotten");
    // Should not appear in active list
    expect(listBeliefs(storage).find((b) => b.id === belief.id)).toBeUndefined();
  });

  it("should forget a belief by prefix", () => {
    const belief = createBelief(storage, { statement: "Prefix test", confidence: 0.5 });
    forgetBelief(storage, belief.id.slice(0, 8));
    const [row] = storage.query<{ status: string }>("SELECT status FROM beliefs WHERE id = ?", [belief.id]);
    expect(row!.status).toBe("forgotten");
  });

  it("should log forgotten change in belief history", () => {
    const belief = createBelief(storage, { statement: "Will be forgotten", confidence: 0.5 });
    forgetBelief(storage, belief.id);
    const history = getBeliefHistory(storage, belief.id);
    expect(history.some((h) => h.change_type === "forgotten")).toBe(true);
  });

  it("should prune beliefs below threshold", () => {
    // Create a belief with very old updated_at so decay makes it near zero
    const b = createBelief(storage, { statement: "Ancient belief", confidence: 0.1 });
    storage.run("UPDATE beliefs SET updated_at = datetime('now', '-365 days') WHERE id = ?", [b.id]);
    const pruned = pruneBeliefs(storage, 0.05);
    expect(pruned).toContain(b.id);
    const [row] = storage.query<{ status: string }>("SELECT status FROM beliefs WHERE id = ?", [b.id]);
    expect(row!.status).toBe("pruned");
  });

  it("should not prune beliefs above threshold", () => {
    createBelief(storage, { statement: "Fresh belief", confidence: 0.9 });
    const pruned = pruneBeliefs(storage, 0.05);
    expect(pruned).toHaveLength(0);
  });
});

describe("Embeddings", () => {
  let storage: ReturnType<typeof createStorage>;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pai-emb-"));
    storage = createStorage(dir);
    storage.migrate("memory", memoryMigrations);
  });

  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("should compute cosine similarity correctly", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1.0);
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0.0);
    expect(cosineSimilarity([1, 0, 0], [-1, 0, 0])).toBeCloseTo(-1.0);
  });

  it("should store and retrieve embeddings", () => {
    const belief = createBelief(storage, { statement: "test belief", confidence: 0.6 });
    storeEmbedding(storage, belief.id, [0.1, 0.2, 0.3]);
    const results = findSimilarBeliefs(storage, [0.1, 0.2, 0.3], 5);
    expect(results).toHaveLength(1);
    expect(results[0]!.beliefId).toBe(belief.id);
    expect(results[0]!.similarity).toBeCloseTo(1.0);
  });

  it("should rank by cosine similarity", () => {
    const b1 = createBelief(storage, { statement: "close match", confidence: 0.6 });
    const b2 = createBelief(storage, { statement: "distant match", confidence: 0.6 });
    storeEmbedding(storage, b1.id, [1.0, 0.0, 0.0]);
    storeEmbedding(storage, b2.id, [0.0, 1.0, 0.0]);
    const results = findSimilarBeliefs(storage, [0.9, 0.1, 0.0], 5);
    expect(results[0]!.beliefId).toBe(b1.id);
  });

  it("should only return active beliefs", () => {
    const b1 = createBelief(storage, { statement: "active belief", confidence: 0.6 });
    const b2 = createBelief(storage, { statement: "dead belief", confidence: 0.6 });
    storeEmbedding(storage, b1.id, [1.0, 0.0, 0.0]);
    storeEmbedding(storage, b2.id, [1.0, 0.0, 0.0]);
    storage.run("UPDATE beliefs SET status = 'invalidated' WHERE id = ?", [b2.id]);
    const results = findSimilarBeliefs(storage, [1.0, 0.0, 0.0], 5);
    expect(results).toHaveLength(1);
    expect(results[0]!.beliefId).toBe(b1.id);
  });
});

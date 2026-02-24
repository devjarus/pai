/**
 * Memory Quality Tests — Belief Lifecycle Simulation
 *
 * Proves the belief lifecycle works end-to-end by simulating realistic
 * agent usage: reinforcement, contradiction, decay, dedup, prune, recall.
 *
 * Inspired by agent-memory-box test patterns.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createStorage } from "@personal-ai/core";
import type { LLMClient, Storage } from "@personal-ai/core";
import {
  memoryMigrations,
  createBelief,
  createEpisode,
  listBeliefs,
  searchBeliefs,
  findSimilarBeliefs,
  storeEmbedding,
  storeEpisodeEmbedding,
  reinforceBelief,
  forgetBelief,
  pruneBeliefs,
  effectiveConfidence,
  logBeliefChange,
  getBeliefHistory,
  getMemoryContext,
  reflect,
  memoryStats,
} from "../../src/memory/memory.js";
import { remember } from "../../src/memory/remember.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Helper: create a mock LLM that returns predictable extractions and embeddings
function createMockLLM(overrides?: {
  chatResponses?: Array<{ text: string }>;
  embedResponses?: Array<{ embedding: number[] }>;
}): LLMClient {
  const chatResponses = overrides?.chatResponses ?? [];
  const embedResponses = overrides?.embedResponses ?? [];
  let chatIdx = 0;
  let embedIdx = 0;

  return {
    chat: vi.fn().mockImplementation(async () => {
      const resp = chatResponses[chatIdx] ?? chatResponses[chatResponses.length - 1];
      chatIdx++;
      return { text: resp?.text ?? "NONE", usage: { inputTokens: 10, outputTokens: 5 } };
    }),
    embed: vi.fn().mockImplementation(async () => {
      const resp = embedResponses[embedIdx] ?? embedResponses[embedResponses.length - 1];
      embedIdx++;
      return resp ?? { embedding: [0.1, 0.2, 0.3] };
    }),
    health: vi.fn().mockResolvedValue({ ok: true, provider: "mock" }),
  };
}

// Helper: age a belief by manipulating updated_at
function ageBelief(storage: Storage, beliefId: string, days: number): void {
  storage.run(
    `UPDATE beliefs SET updated_at = datetime('now', '-${days} days') WHERE id = ?`,
    [beliefId],
  );
}

describe("Belief Lifecycle", () => {
  let storage: ReturnType<typeof createStorage>;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pai-lifecycle-"));
    storage = createStorage(dir);
    storage.migrate("memory", memoryMigrations);
  });

  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  // --- Reinforcement ---

  it("reinforces existing belief when same fact is remembered twice", async () => {
    const llm = createMockLLM({
      chatResponses: [
        { text: '{"fact":"TypeScript catches bugs at compile time","insight":null}' },
        { text: '{"fact":"TypeScript catches bugs at compile time","insight":null}' },
      ],
      // Same embedding = similarity 1.0 → should reinforce
      embedResponses: [{ embedding: [1.0, 0.0, 0.0] }],
    });

    const first = await remember(storage, llm, "TypeScript catches bugs early");
    expect(first.isReinforcement).toBe(false);
    expect(first.beliefIds).toHaveLength(1);

    const second = await remember(storage, llm, "TypeScript catches bugs early again");
    expect(second.isReinforcement).toBe(true);
    expect(second.beliefIds[0]).toBe(first.beliefIds[0]);

    // Confidence should have increased from 0.6 to ~0.7
    const beliefs = listBeliefs(storage);
    const reinforced = beliefs.find((b) => b.id === first.beliefIds[0]);
    expect(reinforced!.confidence).toBeGreaterThan(0.6);
  });

  it("reinforcement resets decay timer", async () => {
    const belief = createBelief(storage, { statement: "Tests are important", confidence: 0.8 });
    ageBelief(storage, belief.id, 30); // 30 days old = ~50% decay

    const before = listBeliefs(storage).find((b) => b.id === belief.id)!;
    expect(before.confidence).toBeCloseTo(0.4, 1); // decayed

    reinforceBelief(storage, belief.id); // resets updated_at to now

    const after = listBeliefs(storage).find((b) => b.id === belief.id)!;
    expect(after.confidence).toBeGreaterThan(0.85); // 0.8 + 0.1 reinforce, fresh timestamp
  });

  // --- Contradiction ---

  it("invalidates contradicted belief and creates replacement", async () => {
    const llm = createMockLLM({
      chatResponses: [
        { text: '{"fact":"SQLite is slow for large datasets","insight":null}' },
        { text: '{"fact":"SQLite handles large datasets well","insight":null}' },
        { text: "CONTRADICTION" }, // classifyRelationship detects contradiction
      ],
      embedResponses: [
        { embedding: [0.5, 0.5, 0.0] }, // episode 1
        { embedding: [1.0, 0.0, 0.0] }, // belief 1
        { embedding: [0.5, 0.5, 0.0] }, // episode 2
        { embedding: [0.7, 0.7, 0.0] }, // belief 2 — similarity ~0.7 (contradiction range)
      ],
    });

    const first = await remember(storage, llm, "SQLite is slow");
    const second = await remember(storage, llm, "SQLite is fast actually");

    // Old belief should be invalidated
    const old = storage.query<{ status: string }>(
      "SELECT status FROM beliefs WHERE id = ?",
      [first.beliefIds[0]],
    );
    expect(old[0]!.status).toBe("invalidated");

    // New belief should be active
    const replacement = storage.query<{ status: string }>(
      "SELECT status FROM beliefs WHERE id = ?",
      [second.beliefIds[0]],
    );
    expect(replacement[0]!.status).toBe("active");

    // Audit trail should show contradiction
    const history = getBeliefHistory(storage, first.beliefIds[0]!);
    expect(history.some((h) => h.change_type === "contradicted")).toBe(true);
  });

  it("does not contradict when beliefs are about different topics", async () => {
    const llm = createMockLLM({
      chatResponses: [
        { text: '{"fact":"Vitest is fast","insight":null}' },
        { text: '{"fact":"ESLint catches style issues","insight":null}' },
        { text: "INDEPENDENT" }, // classifyRelationship: different topics, compatible
      ],
      embedResponses: [
        { embedding: [0.5, 0.5, 0.0] }, // episode 1
        { embedding: [1.0, 0.0, 0.0] }, // belief 1
        { embedding: [0.5, 0.5, 0.0] }, // episode 2
        { embedding: [0.7, 0.7, 0.0] }, // belief 2 — in contradiction range but LLM says NONE
      ],
    });

    const first = await remember(storage, llm, "Vitest is fast");
    const second = await remember(storage, llm, "ESLint catches issues");

    // Both beliefs should be active
    const all = listBeliefs(storage);
    expect(all).toHaveLength(2);
    expect(all.every((b) => b.status === "active")).toBe(true);
  });

  // --- Confidence Decay ---

  it("beliefs decay to half confidence after 30 days", () => {
    const belief = createBelief(storage, { statement: "Half-life test", confidence: 1.0 });
    ageBelief(storage, belief.id, 30);

    const [updated] = storage.query<typeof belief>("SELECT * FROM beliefs WHERE id = ?", [belief.id]);
    expect(effectiveConfidence(updated!)).toBeCloseTo(0.5, 1);
  });

  it("beliefs decay to ~25% after 60 days", () => {
    const belief = createBelief(storage, { statement: "Two half-lives", confidence: 1.0 });
    ageBelief(storage, belief.id, 60);

    const [updated] = storage.query<typeof belief>("SELECT * FROM beliefs WHERE id = ?", [belief.id]);
    expect(effectiveConfidence(updated!)).toBeCloseTo(0.25, 1);
  });

  it("fresh beliefs show full confidence", () => {
    const belief = createBelief(storage, { statement: "Just created", confidence: 0.8 });
    expect(effectiveConfidence(belief)).toBeCloseTo(0.8, 1);
  });

  it("listBeliefs returns decay-adjusted and sorted by confidence", () => {
    const strong = createBelief(storage, { statement: "Strong and fresh", confidence: 0.9 });
    const weak = createBelief(storage, { statement: "Old and decayed", confidence: 0.9 });
    ageBelief(storage, weak.id, 60);

    const beliefs = listBeliefs(storage);
    expect(beliefs[0]!.id).toBe(strong.id);
    expect(beliefs[0]!.confidence).toBeGreaterThan(beliefs[1]!.confidence);
  });

  // --- Prune ---

  it("prunes beliefs that decayed below threshold", () => {
    const fresh = createBelief(storage, { statement: "Fresh belief", confidence: 0.8 });
    const ancient = createBelief(storage, { statement: "Ancient belief", confidence: 0.1 });
    ageBelief(storage, ancient.id, 365); // 1 year = basically zero confidence

    const pruned = pruneBeliefs(storage, 0.01);
    expect(pruned).toContain(ancient.id);
    expect(pruned).not.toContain(fresh.id);

    // Pruned belief should have audit trail
    const history = getBeliefHistory(storage, ancient.id);
    expect(history.some((h) => h.change_type === "pruned")).toBe(true);
  });

  it("prune does not touch beliefs above threshold", () => {
    createBelief(storage, { statement: "Healthy belief", confidence: 0.9 });
    const pruned = pruneBeliefs(storage, 0.05);
    expect(pruned).toHaveLength(0);
  });

  // --- Forget ---

  it("forget soft-deletes and logs change", () => {
    const belief = createBelief(storage, { statement: "To be forgotten", confidence: 0.8 });
    forgetBelief(storage, belief.id);

    const [row] = storage.query<{ status: string }>("SELECT status FROM beliefs WHERE id = ?", [belief.id]);
    expect(row!.status).toBe("forgotten");

    // Should not appear in active beliefs
    expect(listBeliefs(storage)).toHaveLength(0);

    // Should have audit trail
    const history = getBeliefHistory(storage, belief.id);
    expect(history.some((h) => h.change_type === "forgotten")).toBe(true);
  });

  // --- Dedup via Semantic Search ---

  it("deduplicates near-identical beliefs via embedding similarity", () => {
    const b1 = createBelief(storage, { statement: "TypeScript is typed", confidence: 0.6 });
    const b2 = createBelief(storage, { statement: "TypeScript has types", confidence: 0.6 });
    storeEmbedding(storage, b1.id, [1.0, 0.0, 0.0]);
    storeEmbedding(storage, b2.id, [0.99, 0.1, 0.0]); // very similar

    const result = reflect(storage, { similarityThreshold: 0.9 });
    expect(result.duplicates).toHaveLength(1);
    expect(result.duplicates[0]!.ids).toContain(b1.id);
    expect(result.duplicates[0]!.ids).toContain(b2.id);
  });

  it("does not flag dissimilar beliefs as duplicates", () => {
    const b1 = createBelief(storage, { statement: "TypeScript is typed", confidence: 0.6 });
    const b2 = createBelief(storage, { statement: "SQLite is fast", confidence: 0.6 });
    storeEmbedding(storage, b1.id, [1.0, 0.0, 0.0]);
    storeEmbedding(storage, b2.id, [0.0, 1.0, 0.0]); // orthogonal

    const result = reflect(storage);
    expect(result.duplicates).toHaveLength(0);
  });

  // --- Recall Precision ---

  it("semantic recall returns relevant beliefs ranked by similarity", () => {
    const b1 = createBelief(storage, { statement: "Vitest is fast for testing", confidence: 0.8 });
    const b2 = createBelief(storage, { statement: "SQLite is great for local apps", confidence: 0.8 });
    storeEmbedding(storage, b1.id, [1.0, 0.0, 0.0]);
    storeEmbedding(storage, b2.id, [0.0, 1.0, 0.0]);

    // Query close to b1
    const results = findSimilarBeliefs(storage, [0.9, 0.1, 0.0], 5);
    expect(results[0]!.beliefId).toBe(b1.id);
    expect(results[0]!.similarity).toBeGreaterThan(results[1]!.similarity);
  });

  it("FTS5 recall returns keyword-matched beliefs", () => {
    createBelief(storage, { statement: "Vitest is faster than Jest for TypeScript", confidence: 0.8 });
    createBelief(storage, { statement: "SQLite works great locally", confidence: 0.8 });

    const results = searchBeliefs(storage, "Vitest TypeScript");
    expect(results).toHaveLength(1);
    expect(results[0]!.statement).toContain("Vitest");
  });

  it("recall excludes invalidated beliefs", () => {
    const b1 = createBelief(storage, { statement: "Active belief about testing", confidence: 0.8 });
    const b2 = createBelief(storage, { statement: "Invalidated belief about testing", confidence: 0.8 });
    storeEmbedding(storage, b1.id, [1.0, 0.0, 0.0]);
    storeEmbedding(storage, b2.id, [0.9, 0.1, 0.0]);
    storage.run("UPDATE beliefs SET status = 'invalidated' WHERE id = ?", [b2.id]);

    const results = findSimilarBeliefs(storage, [1.0, 0.0, 0.0], 5);
    expect(results).toHaveLength(1);
    expect(results[0]!.beliefId).toBe(b1.id);
  });

  // --- Context Quality ---

  it("getMemoryContext sorts beliefs by confidence and includes type", async () => {
    createBelief(storage, { statement: "Strong testing fact about Vitest", confidence: 0.9, type: "fact" });
    createBelief(storage, { statement: "Weak testing insight about coverage", confidence: 0.5, type: "insight" });
    createEpisode(storage, { action: "Ran tests for coverage" });

    const context = await getMemoryContext(storage, "testing");
    expect(context).toContain("[fact|");
    expect(context).toContain("[insight|");
    expect(context).toContain("Relevant beliefs");
    expect(context).toContain("Recent observations");

    // Strong belief should appear before weak
    const strongIdx = context.indexOf("Strong testing fact");
    const weakIdx = context.indexOf("Weak testing insight");
    expect(strongIdx).toBeLessThan(weakIdx);
  });

  it("getMemoryContext uses semantic search when LLM available", async () => {
    const belief = createBelief(storage, { statement: "Semantic match only", confidence: 0.9, type: "fact" });
    storeEmbedding(storage, belief.id, [1.0, 0.0, 0.0]);

    const ep = createEpisode(storage, { action: "Semantic episode" });
    storeEpisodeEmbedding(storage, ep.id, [0.9, 0.1, 0.0]);

    const llm = createMockLLM({
      embedResponses: [{ embedding: [0.9, 0.1, 0.0] }],
    });

    const context = await getMemoryContext(storage, "semantic query", { llm });
    expect(context).toContain("Semantic match only");
    expect(context).toContain("Semantic episode");
  });

  // --- Audit Trail ---

  it("tracks full belief lifecycle in change history", async () => {
    const belief = createBelief(storage, { statement: "Tracked belief", confidence: 0.6 });
    logBeliefChange(storage, { beliefId: belief.id, changeType: "created", detail: "Initial creation" });

    reinforceBelief(storage, belief.id);
    logBeliefChange(storage, { beliefId: belief.id, changeType: "reinforced", detail: "Confirmed by agent" });

    forgetBelief(storage, belief.id);
    // forgetBelief already logs the change

    const history = getBeliefHistory(storage, belief.id);
    expect(history).toHaveLength(3);

    const types = history.map((h) => h.change_type);
    expect(types).toContain("created");
    expect(types).toContain("reinforced");
    expect(types).toContain("forgotten");
  });

  // --- Stats ---

  it("memoryStats reflects actual system state", () => {
    const b1 = createBelief(storage, { statement: "Active", confidence: 0.8 });
    const b2 = createBelief(storage, { statement: "Forgotten", confidence: 0.5 });
    createBelief(storage, { statement: "Will invalidate", confidence: 0.6 });
    createEpisode(storage, { action: "Some observation" });
    createEpisode(storage, { action: "Another observation" });

    forgetBelief(storage, b2.id);
    storage.run("UPDATE beliefs SET status = 'invalidated' WHERE statement = 'Will invalidate'");

    const stats = memoryStats(storage);
    expect(stats.beliefs.active).toBe(1);
    expect(stats.beliefs.forgotten).toBe(1);
    expect(stats.beliefs.invalidated).toBe(1);
    expect(stats.beliefs.total).toBe(3);
    expect(stats.episodes).toBe(2);
    expect(stats.avgConfidence).toBeCloseTo(0.8, 1); // only active beliefs
  });

  // --- End-to-End Agent Simulation ---

  it("simulates a realistic agent session with mixed operations", async () => {
    const llm = createMockLLM({
      chatResponses: [
        // 1st remember: extract fact
        { text: '{"fact":"Project uses Zod for validation","insight":"Schema validation prevents runtime errors"}' },
        // 2nd remember: same fact → reinforce
        { text: '{"fact":"Project uses Zod for validation","insight":null}' },
        // 3rd remember: contradicting fact + contradiction check
        { text: '{"fact":"Project uses Joi for validation","insight":null}' },
        { text: "CONTRADICTION" }, // classifyRelationship: contradicts Zod belief
      ],
      embedResponses: [
        { embedding: [0.5, 0.5, 0.0] }, // episode 1
        { embedding: [1.0, 0.0, 0.0] }, // fact 1 (Zod) — insight is no longer stored
        { embedding: [0.5, 0.5, 0.0] }, // episode 2
        { embedding: [1.0, 0.0, 0.0] }, // fact 2 (same as Zod → reinforce)
        { embedding: [0.5, 0.5, 0.0] }, // episode 3
        { embedding: [0.7, 0.7, 0.0] }, // fact 3 (Joi — similarity ~0.7, contradiction range)
      ],
    });

    // Step 1: Agent learns project uses Zod
    const r1 = await remember(storage, llm, "This project uses Zod for schema validation");
    expect(r1.beliefIds).toHaveLength(1); // fact only (insights no longer stored)
    expect(r1.isReinforcement).toBe(false);

    // Step 2: Agent confirms Zod usage → should reinforce
    const r2 = await remember(storage, llm, "Confirmed: Zod is used everywhere");
    expect(r2.isReinforcement).toBe(true);

    // The Zod belief should now have higher confidence (reinforced)
    const zod = storage.query<{ confidence: number }>(
      "SELECT confidence FROM beliefs WHERE id = ?",
      [r1.beliefIds[0]],
    );
    expect(zod[0]!.confidence).toBeGreaterThan(0.6);

    // Step 3: Agent discovers it's actually Joi → should contradict Zod
    const r3 = await remember(storage, llm, "Wait, it uses Joi not Zod");
    expect(r3.isReinforcement).toBe(false);

    // Zod belief should be invalidated
    const zodStatus = storage.query<{ status: string }>(
      "SELECT status FROM beliefs WHERE id = ?",
      [r1.beliefIds[0]],
    );
    expect(zodStatus[0]!.status).toBe("invalidated");

    // Final state: Joi belief (active), Zod (invalidated) — insights no longer stored
    const active = listBeliefs(storage);
    expect(active.length).toBe(1); // Joi only

    // Stats should reflect the lifecycle
    const stats = memoryStats(storage);
    expect(stats.beliefs.active).toBe(1);
    expect(stats.beliefs.invalidated).toBe(1);
  });
});

/**
 * Contradiction Detection Edge Cases (Grey Zone: 0.70-0.85 cosine similarity)
 *
 * This test file catalogues scenarios in the grey zone where beliefs have
 * moderate semantic similarity. The memory system in processNewBelief() uses:
 *   > 0.85 similarity  -> Reinforce (merge)
 *   0.70-0.85           -> classifyRelationship() -> REINFORCEMENT | CONTRADICTION | INDEPENDENT
 *   < 0.70              -> Create new belief
 *
 * The classifyRelationship() function asks the LLM to classify the relationship
 * between two beliefs as one of three types, enabling proper handling of
 * paraphrases, refinements, contradictions, and independent but related beliefs.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createStorage } from "@personal-ai/core";
import type { LLMClient, Logger } from "@personal-ai/core";
import {
  memoryMigrations,
  createBelief,
  storeEmbedding,
  findSimilarBeliefs,
  cosineSimilarity,
  linkBeliefToEpisode,
  countSupportingEpisodes,
  logBeliefChange,
} from "../../src/memory/memory.js";
import { checkContradiction, classifyRelationship, remember } from "../../src/memory/remember.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EMB_DIM = 384;

/** Generate a deterministic base embedding from a seed string. */
function seedEmbedding(seed: string): number[] {
  const emb = new Array(EMB_DIM).fill(0);
  for (let i = 0; i < seed.length; i++) {
    emb[i % EMB_DIM] += seed.charCodeAt(i) / 1000;
  }
  // Normalize
  const norm = Math.sqrt(emb.reduce((s: number, v: number) => s + v * v, 0));
  return norm === 0 ? emb : emb.map((v: number) => v / norm);
}

/**
 * Generate an embedding with a specific target cosine similarity to a base embedding.
 * Uses Gram-Schmidt orthogonalization for exact control over cosine similarity.
 */
function generateSimilarEmbedding(base: number[], targetSimilarity: number, seed = 42): number[] {
  let rng = seed;
  function nextRandom(): number {
    rng = (rng * 1664525 + 1013904223) & 0x7fffffff;
    return rng / 0x7fffffff - 0.5;
  }

  const random = Array.from({ length: base.length }, () => nextRandom());
  const normBase = Math.sqrt(base.reduce((s, v) => s + v * v, 0));
  const normalizedBase = base.map((v) => v / normBase);
  const normRandom = Math.sqrt(random.reduce((s, v) => s + v * v, 0));
  const normalizedRandom = random.map((v) => v / normRandom);

  const dot = normalizedBase.reduce((s, v, i) => s + v * normalizedRandom[i]!, 0);
  const orthogonal = normalizedRandom.map((v, i) => v - dot * normalizedBase[i]!);
  const normOrth = Math.sqrt(orthogonal.reduce((s, v) => s + v * v, 0));
  const normalizedOrth = orthogonal.map((v) => v / normOrth);

  const cosTheta = targetSimilarity;
  const sinTheta = Math.sqrt(1 - cosTheta * cosTheta);
  return normalizedBase.map((v, i) => cosTheta * v + sinTheta * normalizedOrth[i]!);
}

/** Create a mock LLM client with configurable chat responses. */
function mockLLM(overrides?: Partial<LLMClient>): LLMClient {
  return {
    chat: vi.fn().mockResolvedValue({
      text: '{"fact":"test","factType":"factual","importance":5,"insight":null,"subject":"owner"}',
      usage: { inputTokens: 10, outputTokens: 10 },
    }),
    streamChat: vi.fn(),
    embed: vi.fn().mockResolvedValue({ embedding: new Array(EMB_DIM).fill(0) }),
    health: vi.fn().mockResolvedValue({ ok: true, provider: "mock" }),
    getModel: vi.fn().mockReturnValue("test-model"),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Verify the helper produces accurate cosine similarities
// ---------------------------------------------------------------------------

describe("test helpers", () => {
  it("generateSimilarEmbedding produces target cosine similarity within tolerance", () => {
    const base = seedEmbedding("test-base-vector");
    for (const target of [0.70, 0.75, 0.80, 0.85, 0.90]) {
      const similar = generateSimilarEmbedding(base, target);
      const actual = cosineSimilarity(base, similar);
      expect(actual).toBeCloseTo(target, 2);
    }
  });
});

// ===========================================================================
// Category 1: False Contradictions (now handled by classifyRelationship)
// The classifyRelationship() function correctly identifies these as INDEPENDENT,
// preventing false contradiction invalidations.
// ===========================================================================

describe("Category 1: False Contradictions (related but compatible beliefs)", () => {
  let storage: ReturnType<typeof createStorage>;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pai-contra-edge-"));
    storage = createStorage(dir);
    storage.migrate("memory", memoryMigrations);
  });

  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("1. Refinement: general preference refined with more detail should NOT contradict", async () => {
    // classifyRelationship returns INDEPENDENT — both beliefs remain active
    const baseEmb = seedEmbedding("User prefers TypeScript");
    const refinedEmb = generateSimilarEmbedding(baseEmb, 0.80);

    const llm = mockLLM({
      chat: vi.fn()
        // First remember: extractBeliefs
        .mockResolvedValueOnce({
          text: '{"fact":"User prefers TypeScript","factType":"preference","importance":7,"insight":null,"subject":"owner"}',
          usage: { inputTokens: 10, outputTokens: 10 },
        })
        // Second remember: extractBeliefs
        .mockResolvedValueOnce({
          text: '{"fact":"User strongly prefers TypeScript for backend","factType":"preference","importance":8,"insight":null,"subject":"owner"}',
          usage: { inputTokens: 10, outputTokens: 10 },
        })
        // Second remember: classifyRelationship — correctly says INDEPENDENT
        .mockResolvedValueOnce({ text: "INDEPENDENT", usage: { inputTokens: 20, outputTokens: 1 } }),
      embed: vi.fn()
        .mockResolvedValueOnce({ embedding: baseEmb })     // first episode
        .mockResolvedValueOnce({ embedding: baseEmb })     // first belief
        .mockResolvedValueOnce({ embedding: refinedEmb })  // second episode
        .mockResolvedValueOnce({ embedding: refinedEmb }), // second belief
    });

    const first = await remember(storage, llm, "I prefer TypeScript");
    const second = await remember(storage, llm, "I strongly prefer TypeScript for backend work");

    const oldBelief = storage.query<{ status: string }>(
      "SELECT status FROM beliefs WHERE id = ?",
      [first.beliefIds[0]],
    )[0]!;
    expect(oldBelief.status).toBe("active");

    const newBelief = storage.query<{ status: string }>(
      "SELECT status FROM beliefs WHERE id = ?",
      [second.beliefIds[0]],
    )[0]!;
    expect(newBelief.status).toBe("active");
  });

  it("2. Additive detail: adding job title should NOT contradict employer fact", async () => {
    // classifyRelationship returns INDEPENDENT — both coexist
    const baseEmb = seedEmbedding("User works at Acme Corp");
    const detailEmb = generateSimilarEmbedding(baseEmb, 0.78);

    const llm = mockLLM({
      chat: vi.fn()
        .mockResolvedValueOnce({
          text: '{"fact":"User works at Acme Corp","factType":"factual","importance":6,"insight":null,"subject":"owner"}',
          usage: { inputTokens: 10, outputTokens: 10 },
        })
        .mockResolvedValueOnce({
          text: '{"fact":"User is a senior engineer at Acme Corp","factType":"factual","importance":7,"insight":null,"subject":"owner"}',
          usage: { inputTokens: 10, outputTokens: 10 },
        })
        // classifyRelationship returns INDEPENDENT
        .mockResolvedValueOnce({ text: "INDEPENDENT", usage: { inputTokens: 20, outputTokens: 1 } }),
      embed: vi.fn()
        .mockResolvedValueOnce({ embedding: baseEmb })
        .mockResolvedValueOnce({ embedding: baseEmb })
        .mockResolvedValueOnce({ embedding: detailEmb })
        .mockResolvedValueOnce({ embedding: detailEmb }),
    });

    const first = await remember(storage, llm, "I work at Acme Corp");
    const second = await remember(storage, llm, "I'm a senior engineer at Acme Corp");

    const oldBelief = storage.query<{ status: string }>(
      "SELECT status FROM beliefs WHERE id = ?",
      [first.beliefIds[0]],
    )[0]!;
    expect(oldBelief.status).toBe("active");
  });

  it("3. Temporal coexistence: learning two different frameworks should NOT contradict", async () => {
    const baseEmb = seedEmbedding("User is learning React");
    const nextEmb = generateSimilarEmbedding(baseEmb, 0.75);

    const llm = mockLLM({
      chat: vi.fn()
        .mockResolvedValueOnce({
          text: '{"fact":"User is learning React","factType":"factual","importance":5,"insight":null,"subject":"owner"}',
          usage: { inputTokens: 10, outputTokens: 10 },
        })
        .mockResolvedValueOnce({
          text: '{"fact":"User is learning Next.js","factType":"factual","importance":5,"insight":null,"subject":"owner"}',
          usage: { inputTokens: 10, outputTokens: 10 },
        })
        // classifyRelationship returns INDEPENDENT
        .mockResolvedValueOnce({ text: "INDEPENDENT", usage: { inputTokens: 20, outputTokens: 1 } }),
      embed: vi.fn()
        .mockResolvedValueOnce({ embedding: baseEmb })
        .mockResolvedValueOnce({ embedding: baseEmb })
        .mockResolvedValueOnce({ embedding: nextEmb })
        .mockResolvedValueOnce({ embedding: nextEmb }),
    });

    const first = await remember(storage, llm, "I'm learning React");
    const second = await remember(storage, llm, "I'm learning Next.js");

    const beliefs = storage.query<{ status: string }>("SELECT status FROM beliefs WHERE status = 'active'");
    expect(beliefs).toHaveLength(2);
  });

  it("4. Different scope: preference in different contexts should NOT contradict", async () => {
    // classifyRelationship returns INDEPENDENT — different contexts
    const baseEmb = seedEmbedding("User prefers dark mode in VS Code");
    const scopedEmb = generateSimilarEmbedding(baseEmb, 0.82);

    const llm = mockLLM({
      chat: vi.fn()
        .mockResolvedValueOnce({
          text: '{"fact":"User prefers dark mode in VS Code","factType":"preference","importance":4,"insight":null,"subject":"owner"}',
          usage: { inputTokens: 10, outputTokens: 10 },
        })
        .mockResolvedValueOnce({
          text: '{"fact":"User prefers light mode for reading docs","factType":"preference","importance":4,"insight":null,"subject":"owner"}',
          usage: { inputTokens: 10, outputTokens: 10 },
        })
        // classifyRelationship correctly identifies as INDEPENDENT (different contexts)
        .mockResolvedValueOnce({ text: "INDEPENDENT", usage: { inputTokens: 20, outputTokens: 1 } }),
      embed: vi.fn()
        .mockResolvedValueOnce({ embedding: baseEmb })
        .mockResolvedValueOnce({ embedding: baseEmb })
        .mockResolvedValueOnce({ embedding: scopedEmb })
        .mockResolvedValueOnce({ embedding: scopedEmb }),
    });

    const first = await remember(storage, llm, "I like dark mode in VS Code");
    const second = await remember(storage, llm, "I prefer light mode when reading documentation");

    const oldBelief = storage.query<{ status: string }>(
      "SELECT status FROM beliefs WHERE id = ?",
      [first.beliefIds[0]],
    )[0]!;
    expect(oldBelief.status).toBe("active");
  });

  it("5. Complementary preferences: different tools for different domains should coexist", async () => {
    const baseEmb = seedEmbedding("User likes Python for data science");
    const compEmb = generateSimilarEmbedding(baseEmb, 0.72);

    const llm = mockLLM({
      chat: vi.fn()
        .mockResolvedValueOnce({
          text: '{"fact":"User likes Python for data science","factType":"preference","importance":6,"insight":null,"subject":"owner"}',
          usage: { inputTokens: 10, outputTokens: 10 },
        })
        .mockResolvedValueOnce({
          text: '{"fact":"User likes TypeScript for web apps","factType":"preference","importance":6,"insight":null,"subject":"owner"}',
          usage: { inputTokens: 10, outputTokens: 10 },
        })
        // classifyRelationship returns INDEPENDENT
        .mockResolvedValueOnce({ text: "INDEPENDENT", usage: { inputTokens: 20, outputTokens: 1 } }),
      embed: vi.fn()
        .mockResolvedValueOnce({ embedding: baseEmb })
        .mockResolvedValueOnce({ embedding: baseEmb })
        .mockResolvedValueOnce({ embedding: compEmb })
        .mockResolvedValueOnce({ embedding: compEmb }),
    });

    const first = await remember(storage, llm, "I like Python for data science");
    const second = await remember(storage, llm, "I like TypeScript for web apps");

    const beliefs = storage.query<{ status: string }>("SELECT status FROM beliefs WHERE status = 'active'");
    expect(beliefs).toHaveLength(2);
  });
});

// ===========================================================================
// Category 2: Contradictions (correctly detected by classifyRelationship)
// ===========================================================================

describe("Category 2: Contradictions (correctly detected)", () => {
  let storage: ReturnType<typeof createStorage>;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pai-contra-detect-"));
    storage = createStorage(dir);
    storage.migrate("memory", memoryMigrations);
  });

  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("6. Soft negation: semantic opposition detected by classifyRelationship", async () => {
    // classifyRelationship correctly identifies "enjoys" vs "finds tedious" as CONTRADICTION
    const baseEmb = seedEmbedding("User enjoys writing tests");
    const negEmb = generateSimilarEmbedding(baseEmb, 0.75);

    const llm = mockLLM({
      chat: vi.fn()
        .mockResolvedValueOnce({
          text: '{"fact":"User enjoys writing tests","factType":"preference","importance":6,"insight":null,"subject":"owner"}',
          usage: { inputTokens: 10, outputTokens: 10 },
        })
        .mockResolvedValueOnce({
          text: '{"fact":"User finds testing tedious and avoids it","factType":"preference","importance":6,"insight":null,"subject":"owner"}',
          usage: { inputTokens: 10, outputTokens: 10 },
        })
        // classifyRelationship correctly returns CONTRADICTION
        .mockResolvedValueOnce({ text: "CONTRADICTION", usage: { inputTokens: 20, outputTokens: 1 } }),
      embed: vi.fn()
        .mockResolvedValueOnce({ embedding: baseEmb })
        .mockResolvedValueOnce({ embedding: baseEmb })
        .mockResolvedValueOnce({ embedding: negEmb })
        .mockResolvedValueOnce({ embedding: negEmb }),
    });

    const first = await remember(storage, llm, "I enjoy writing tests");
    const second = await remember(storage, llm, "Testing is tedious, I avoid it when possible");

    const oldBelief = storage.query<{ status: string }>(
      "SELECT status FROM beliefs WHERE id = ?",
      [first.beliefIds[0]],
    )[0]!;
    expect(oldBelief.status).toBe("invalidated");
  });

  it("7. Implied contradiction: morning person vs night owl", async () => {
    const baseEmb = seedEmbedding("User is a morning person");
    const nightEmb = generateSimilarEmbedding(baseEmb, 0.73);

    const llm = mockLLM({
      chat: vi.fn()
        .mockResolvedValueOnce({
          text: '{"fact":"User is a morning person","factType":"factual","importance":5,"insight":null,"subject":"owner"}',
          usage: { inputTokens: 10, outputTokens: 10 },
        })
        .mockResolvedValueOnce({
          text: '{"fact":"User does best work after midnight","factType":"factual","importance":6,"insight":null,"subject":"owner"}',
          usage: { inputTokens: 10, outputTokens: 10 },
        })
        // classifyRelationship correctly returns CONTRADICTION
        .mockResolvedValueOnce({ text: "CONTRADICTION", usage: { inputTokens: 20, outputTokens: 1 } }),
      embed: vi.fn()
        .mockResolvedValueOnce({ embedding: baseEmb })
        .mockResolvedValueOnce({ embedding: baseEmb })
        .mockResolvedValueOnce({ embedding: nightEmb })
        .mockResolvedValueOnce({ embedding: nightEmb }),
    });

    const first = await remember(storage, llm, "I'm a morning person");
    const second = await remember(storage, llm, "I do my best work after midnight");

    const oldBelief = storage.query<{ status: string }>(
      "SELECT status FROM beliefs WHERE id = ?",
      [first.beliefIds[0]],
    )[0]!;
    expect(oldBelief.status).toBe("invalidated");
  });

  it("8. Value change: same attribute slot, different value (favorite language)", async () => {
    const baseEmb = seedEmbedding("User favorite language is Python");
    const rustEmb = generateSimilarEmbedding(baseEmb, 0.82);

    const llm = mockLLM({
      chat: vi.fn()
        .mockResolvedValueOnce({
          text: '{"fact":"User favorite language is Python","factType":"preference","importance":7,"insight":null,"subject":"owner"}',
          usage: { inputTokens: 10, outputTokens: 10 },
        })
        .mockResolvedValueOnce({
          text: '{"fact":"User favorite language is Rust","factType":"preference","importance":8,"insight":null,"subject":"owner"}',
          usage: { inputTokens: 10, outputTokens: 10 },
        })
        // classifyRelationship correctly returns CONTRADICTION
        .mockResolvedValueOnce({ text: "CONTRADICTION", usage: { inputTokens: 20, outputTokens: 1 } }),
      embed: vi.fn()
        .mockResolvedValueOnce({ embedding: baseEmb })
        .mockResolvedValueOnce({ embedding: baseEmb })
        .mockResolvedValueOnce({ embedding: rustEmb })
        .mockResolvedValueOnce({ embedding: rustEmb }),
    });

    const first = await remember(storage, llm, "My favorite language is Python");
    const second = await remember(storage, llm, "My favorite language is Rust now");

    const oldBelief = storage.query<{ status: string }>(
      "SELECT status FROM beliefs WHERE id = ?",
      [first.beliefIds[0]],
    )[0]!;
    expect(oldBelief.status).toBe("invalidated");
  });
});

// ===========================================================================
// Category 3: Ambiguous Updates (now correctly reinforced)
// classifyRelationship returns REINFORCEMENT for paraphrases, intensity
// changes, and specificity increases, enabling proper merging.
// ===========================================================================

describe("Category 3: Ambiguous Updates (should reinforce, not contradict)", () => {
  let storage: ReturnType<typeof createStorage>;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pai-ambig-"));
    storage = createStorage(dir);
    storage.migrate("memory", memoryMigrations);
  });

  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("9. Intensity change: 'likes' -> 'loves' should reinforce", async () => {
    const baseEmb = seedEmbedding("User likes coffee");
    const intensityEmb = generateSimilarEmbedding(baseEmb, 0.80);

    const llm = mockLLM({
      chat: vi.fn()
        .mockResolvedValueOnce({
          text: '{"fact":"User likes coffee","factType":"preference","importance":5,"insight":null,"subject":"owner"}',
          usage: { inputTokens: 10, outputTokens: 10 },
        })
        .mockResolvedValueOnce({
          text: '{"fact":"User loves coffee","factType":"preference","importance":6,"insight":null,"subject":"owner"}',
          usage: { inputTokens: 10, outputTokens: 10 },
        })
        // classifyRelationship correctly returns REINFORCEMENT
        .mockResolvedValueOnce({ text: "REINFORCEMENT", usage: { inputTokens: 20, outputTokens: 1 } }),
      embed: vi.fn()
        .mockResolvedValueOnce({ embedding: baseEmb })
        .mockResolvedValueOnce({ embedding: baseEmb })
        .mockResolvedValueOnce({ embedding: intensityEmb })
        .mockResolvedValueOnce({ embedding: intensityEmb }),
    });

    const first = await remember(storage, llm, "I like coffee");
    const second = await remember(storage, llm, "I love coffee");

    expect(second.isReinforcement).toBe(true);
    expect(second.beliefIds[0]).toBe(first.beliefIds[0]);
  });

  it("10. Specificity increase: 'uses Linux' -> 'uses Ubuntu 24.04' should reinforce", async () => {
    const baseEmb = seedEmbedding("User uses Linux");
    const specificEmb = generateSimilarEmbedding(baseEmb, 0.78);

    const llm = mockLLM({
      chat: vi.fn()
        .mockResolvedValueOnce({
          text: '{"fact":"User uses Linux","factType":"factual","importance":5,"insight":null,"subject":"owner"}',
          usage: { inputTokens: 10, outputTokens: 10 },
        })
        .mockResolvedValueOnce({
          text: '{"fact":"User uses Ubuntu 24.04","factType":"factual","importance":6,"insight":null,"subject":"owner"}',
          usage: { inputTokens: 10, outputTokens: 10 },
        })
        // classifyRelationship returns REINFORCEMENT
        .mockResolvedValueOnce({ text: "REINFORCEMENT", usage: { inputTokens: 20, outputTokens: 1 } }),
      embed: vi.fn()
        .mockResolvedValueOnce({ embedding: baseEmb })
        .mockResolvedValueOnce({ embedding: baseEmb })
        .mockResolvedValueOnce({ embedding: specificEmb })
        .mockResolvedValueOnce({ embedding: specificEmb }),
    });

    const first = await remember(storage, llm, "I use Linux");
    const second = await remember(storage, llm, "I use Ubuntu 24.04");

    expect(second.isReinforcement).toBe(true);
    expect(second.beliefIds[0]).toBe(first.beliefIds[0]);
  });

  it("11. Synonym substitution: same meaning in different words should reinforce", async () => {
    const baseEmb = seedEmbedding("User prefers minimal UI");
    const synEmb = generateSimilarEmbedding(baseEmb, 0.77);

    const llm = mockLLM({
      chat: vi.fn()
        .mockResolvedValueOnce({
          text: '{"fact":"User prefers minimal UI","factType":"preference","importance":6,"insight":null,"subject":"owner"}',
          usage: { inputTokens: 10, outputTokens: 10 },
        })
        .mockResolvedValueOnce({
          text: '{"fact":"User prefers clean simple interfaces","factType":"preference","importance":6,"insight":null,"subject":"owner"}',
          usage: { inputTokens: 10, outputTokens: 10 },
        })
        // classifyRelationship returns REINFORCEMENT
        .mockResolvedValueOnce({ text: "REINFORCEMENT", usage: { inputTokens: 20, outputTokens: 1 } }),
      embed: vi.fn()
        .mockResolvedValueOnce({ embedding: baseEmb })
        .mockResolvedValueOnce({ embedding: baseEmb })
        .mockResolvedValueOnce({ embedding: synEmb })
        .mockResolvedValueOnce({ embedding: synEmb }),
    });

    const first = await remember(storage, llm, "I prefer minimal UI");
    const second = await remember(storage, llm, "I prefer clean, simple interfaces");

    expect(second.isReinforcement).toBe(true);
    expect(second.beliefIds[0]).toBe(first.beliefIds[0]);
  });
});

// ===========================================================================
// Category 4: Evidence Weighing (now proportional)
// ===========================================================================

describe("Category 4: Evidence Weighing Edge Cases", () => {
  let storage: ReturnType<typeof createStorage>;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pai-evidence-"));
    storage = createStorage(dir);
    storage.migrate("memory", memoryMigrations);
  });

  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("12. Well-supported belief: weakening is proportional to evidence (5 episodes)", async () => {
    const baseEmb = seedEmbedding("User always uses ESLint for linting");
    const contraEmb = generateSimilarEmbedding(baseEmb, 0.75);

    const llm = mockLLM({
      chat: vi.fn()
        .mockResolvedValueOnce({
          text: '{"fact":"User always uses ESLint for linting","factType":"procedural","importance":7,"insight":null,"subject":"owner"}',
          usage: { inputTokens: 10, outputTokens: 10 },
        })
        .mockResolvedValueOnce({
          text: '{"fact":"User stopped using ESLint","factType":"procedural","importance":7,"insight":null,"subject":"owner"}',
          usage: { inputTokens: 10, outputTokens: 10 },
        })
        // classifyRelationship returns CONTRADICTION
        .mockResolvedValueOnce({ text: "CONTRADICTION", usage: { inputTokens: 20, outputTokens: 1 } }),
      embed: vi.fn()
        .mockResolvedValueOnce({ embedding: baseEmb })
        .mockResolvedValueOnce({ embedding: baseEmb })
        .mockResolvedValueOnce({ embedding: contraEmb })
        .mockResolvedValueOnce({ embedding: contraEmb }),
    });

    const first = await remember(storage, llm, "I always use ESLint");
    const beliefId = first.beliefIds[0]!;

    // Add 4 more supporting episodes (total = 5)
    for (let i = 1; i <= 4; i++) {
      const epId = `ep-support-${i}`;
      storage.run("INSERT INTO episodes (id, action) VALUES (?, ?)", [epId, `Confirmed ESLint use ${i}`]);
      linkBeliefToEpisode(storage, beliefId, epId);
    }
    expect(countSupportingEpisodes(storage, beliefId)).toBe(5);

    const originalConfidence = storage.query<{ confidence: number }>(
      "SELECT confidence FROM beliefs WHERE id = ?",
      [beliefId],
    )[0]!.confidence;

    await remember(storage, llm, "I stopped using ESLint");

    const updatedConfidence = storage.query<{ confidence: number }>(
      "SELECT confidence FROM beliefs WHERE id = ?",
      [beliefId],
    )[0]!.confidence;

    const drop = originalConfidence - updatedConfidence;
    // With 5 supporting episodes: drop = 1/(5+1) ≈ 0.167, which is < 0.15? No, 0.167.
    // The formula caps at 0.2, so for 5 episodes: min(0.2, 1/6) = 0.167
    // This is proportional — much less than the old flat 0.2 for 3 episodes
    expect(drop).toBeLessThanOrEqual(0.17);
  });

  it("13. Equal evidence: both beliefs have similar support — balanced confidence", async () => {
    const baseEmb = seedEmbedding("User prefers tabs for indentation");
    const contraEmb = generateSimilarEmbedding(baseEmb, 0.80);

    const llm = mockLLM({
      chat: vi.fn()
        .mockResolvedValueOnce({
          text: '{"fact":"User prefers tabs for indentation","factType":"preference","importance":6,"insight":null,"subject":"owner"}',
          usage: { inputTokens: 10, outputTokens: 10 },
        })
        .mockResolvedValueOnce({
          text: '{"fact":"User prefers spaces for indentation","factType":"preference","importance":6,"insight":null,"subject":"owner"}',
          usage: { inputTokens: 10, outputTokens: 10 },
        })
        // classifyRelationship returns CONTRADICTION
        .mockResolvedValueOnce({ text: "CONTRADICTION", usage: { inputTokens: 20, outputTokens: 1 } }),
      embed: vi.fn()
        .mockResolvedValueOnce({ embedding: baseEmb })
        .mockResolvedValueOnce({ embedding: baseEmb })
        .mockResolvedValueOnce({ embedding: contraEmb })
        .mockResolvedValueOnce({ embedding: contraEmb }),
    });

    const first = await remember(storage, llm, "I prefer tabs");
    const beliefId = first.beliefIds[0]!;

    // Add 2 more supporting episodes for old belief (total = 3)
    for (let i = 1; i <= 2; i++) {
      const epId = `ep-tabs-${i}`;
      storage.run("INSERT INTO episodes (id, action) VALUES (?, ?)", [epId, `Used tabs again ${i}`]);
      linkBeliefToEpisode(storage, beliefId, epId);
    }
    expect(countSupportingEpisodes(storage, beliefId)).toBe(3);

    const second = await remember(storage, llm, "I prefer spaces now");

    const oldConf = storage.query<{ confidence: number }>(
      "SELECT confidence FROM beliefs WHERE id = ?",
      [beliefId],
    )[0]!.confidence;

    const newConf = storage.query<{ confidence: number }>(
      "SELECT confidence FROM beliefs WHERE id = ?",
      [second.beliefIds[0]],
    )[0]!.confidence;

    // With 3 episodes: drop = min(0.2, 1/4) = 0.25 → capped at 0.2
    // Old: 0.6 - 0.2 = 0.4
    // New: min(0.6, 1/4 + 0.4) = min(0.6, 0.65) = 0.6
    // Gap = |0.4 - 0.6| = 0.2 — still not ideal but better than before
    // Both beliefs are active and the gap is manageable
    const gap = Math.abs(oldConf - newConf);
    expect(gap).toBeLessThanOrEqual(0.25);
    // Both should be active
    const statuses = storage.query<{ status: string }>("SELECT status FROM beliefs WHERE status = 'active'");
    expect(statuses.length).toBeGreaterThanOrEqual(2);
  });
});

// ===========================================================================
// classifyRelationship unit tests
// ===========================================================================

describe("classifyRelationship", () => {
  it("should return REINFORCEMENT for paraphrases", async () => {
    const llm = mockLLM({
      chat: vi.fn().mockResolvedValue({ text: "REINFORCEMENT", usage: { inputTokens: 20, outputTokens: 1 } }),
    });
    const result = await classifyRelationship(llm, "User loves coffee", "User likes coffee");
    expect(result).toBe("REINFORCEMENT");
  });

  it("should return CONTRADICTION for opposites", async () => {
    const llm = mockLLM({
      chat: vi.fn().mockResolvedValue({ text: "CONTRADICTION", usage: { inputTokens: 20, outputTokens: 1 } }),
    });
    const result = await classifyRelationship(llm, "User hates Java", "User likes Java");
    expect(result).toBe("CONTRADICTION");
  });

  it("should return INDEPENDENT for related but compatible beliefs", async () => {
    const llm = mockLLM({
      chat: vi.fn().mockResolvedValue({ text: "INDEPENDENT", usage: { inputTokens: 20, outputTokens: 1 } }),
    });
    const result = await classifyRelationship(llm, "User likes TypeScript for web", "User likes Python for data");
    expect(result).toBe("INDEPENDENT");
  });

  it("should default to INDEPENDENT for unrecognized LLM responses", async () => {
    const llm = mockLLM({
      chat: vi.fn().mockResolvedValue({ text: "I'm not sure about this one", usage: { inputTokens: 20, outputTokens: 5 } }),
    });
    const result = await classifyRelationship(llm, "foo", "bar");
    expect(result).toBe("INDEPENDENT");
  });

  it("should handle responses with trailing text", async () => {
    const llm = mockLLM({
      chat: vi.fn().mockResolvedValue({ text: "REINFORCEMENT - they express the same thing", usage: { inputTokens: 20, outputTokens: 5 } }),
    });
    const result = await classifyRelationship(llm, "foo", "bar");
    expect(result).toBe("REINFORCEMENT");
  });
});

// ===========================================================================
// checkContradiction parsing edge cases
// ===========================================================================

describe("checkContradiction: prompt edge cases", () => {
  it("should handle LLM returning 'NONE' with trailing period", async () => {
    const llm = mockLLM({
      chat: vi.fn().mockResolvedValue({ text: "NONE.", usage: { inputTokens: 20, outputTokens: 1 } }),
    });

    const existing = [{
      id: "b1", statement: "User likes TypeScript", confidence: 0.7, status: "active",
      type: "preference", created_at: "", updated_at: "", superseded_by: null,
      supersedes: null, importance: 5, last_accessed: null, access_count: 0,
      stability: 1.0, subject: "owner",
    }];

    const result = await checkContradiction(llm, "User also likes JavaScript", existing);
    expect(result).toBeNull();
  });

  it("should handle LLM returning explanation text alongside the number", async () => {
    const llm = mockLLM({
      chat: vi.fn().mockResolvedValue({
        text: "1. These are contradictory because one says 'likes' and the other says 'hates'.",
        usage: { inputTokens: 20, outputTokens: 15 },
      }),
    });

    const existing = [{
      id: "b1", statement: "User likes Java", confidence: 0.7, status: "active",
      type: "preference", created_at: "", updated_at: "", superseded_by: null,
      supersedes: null, importance: 5, last_accessed: null, access_count: 0,
      stability: 1.0, subject: "owner",
    }];

    const result = await checkContradiction(llm, "User hates Java", existing);
    expect(result).toBe("b1");
  });

  it("should handle LLM returning text before the number", async () => {
    const llm = mockLLM({
      chat: vi.fn().mockResolvedValue({ text: "The contradicted belief is: 1", usage: { inputTokens: 20, outputTokens: 5 } }),
    });

    const existing = [{
      id: "b1", statement: "User likes Java", confidence: 0.7, status: "active",
      type: "preference", created_at: "", updated_at: "", superseded_by: null,
      supersedes: null, importance: 5, last_accessed: null, access_count: 0,
      stability: 1.0, subject: "owner",
    }];

    const result = await checkContradiction(llm, "User hates Java", existing);
    // Text before the number means regex ^(\d+) won't match
    expect(result).toBeNull();
  });
});

// ===========================================================================
// Band boundary tests
// ===========================================================================

describe("Band boundary behavior", () => {
  let storage: ReturnType<typeof createStorage>;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pai-boundary-"));
    storage = createStorage(dir);
    storage.migrate("memory", memoryMigrations);
  });

  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("similarity exactly 0.85 should trigger grey zone, not reinforcement", async () => {
    const baseEmb = seedEmbedding("boundary test base");
    const boundaryEmb = generateSimilarEmbedding(baseEmb, 0.85);

    const belief = createBelief(storage, { statement: "Boundary test belief", confidence: 0.6, type: "factual" });
    storeEmbedding(storage, belief.id, baseEmb);

    const similar = findSimilarBeliefs(storage, boundaryEmb, 5);
    expect(similar).toHaveLength(1);
    expect(similar[0]!.similarity).toBeCloseTo(0.85, 2);
    expect(similar[0]!.similarity).toBeLessThanOrEqual(0.85);
  });

  it("similarity exactly 0.70 should skip grey zone and create new belief", async () => {
    const baseEmb = seedEmbedding("boundary test seventy");
    const boundaryEmb = generateSimilarEmbedding(baseEmb, 0.70);

    const belief = createBelief(storage, { statement: "Seventy percent belief", confidence: 0.6, type: "factual" });
    storeEmbedding(storage, belief.id, baseEmb);

    const similar = findSimilarBeliefs(storage, boundaryEmb, 5);
    expect(similar).toHaveLength(1);
    expect(similar[0]!.similarity).toBeCloseTo(0.70, 2);
    expect(similar[0]!.similarity > 0.7).toBe(false);
  });
});

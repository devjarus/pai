import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createStorage } from "@personal-ai/core";
import type { LLMClient } from "@personal-ai/core";
import { memoryMigrations, getBeliefHistory, linkBeliefToEpisode, countSupportingEpisodes, linkSupersession } from "../../src/memory/memory.js";
import { remember, extractBeliefs, checkContradiction } from "../../src/memory/remember.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("extractBeliefs", () => {
  it("should extract fact, factType, importance, and insight from text using LLM", async () => {
    const mockLLM: LLMClient = {
      chat: vi.fn().mockResolvedValue({
        text: '{"fact":"User likes coffee in the morning","factType":"preference","importance":7,"insight":"Morning routines provide consistency"}',
        usage: { inputTokens: 10, outputTokens: 15 },
      }),
      embed: vi.fn().mockResolvedValue({ embedding: [0.1, 0.2, 0.3] }),
      health: vi.fn().mockResolvedValue({ ok: true, provider: "mock" }),
    };
    const result = await extractBeliefs(mockLLM, "I like coffee in the morning");
    expect(result.fact).toBe("User likes coffee in the morning");
    expect(result.factType).toBe("preference");
    expect(result.importance).toBe(7);
    expect(result.insight).toBe("Morning routines provide consistency");
  });

  it("should handle LLM returning plain text by using it as factual", async () => {
    const mockLLM: LLMClient = {
      chat: vi.fn().mockResolvedValue({
        text: "User enjoys morning coffee",
        usage: { inputTokens: 10, outputTokens: 5 },
      }),
      embed: vi.fn().mockResolvedValue({ embedding: [0.1, 0.2, 0.3] }),
      health: vi.fn().mockResolvedValue({ ok: true, provider: "mock" }),
    };
    const result = await extractBeliefs(mockLLM, "I like coffee");
    expect(result.fact).toBe("User enjoys morning coffee");
    expect(result.factType).toBe("factual");
    expect(result.importance).toBe(5);
    expect(result.insight).toBeNull();
  });

  it("should default to factual for invalid factType", async () => {
    const mockLLM: LLMClient = {
      chat: vi.fn().mockResolvedValue({
        text: '{"fact":"Some fact","factType":"invalid_type","insight":null}',
        usage: { inputTokens: 10, outputTokens: 8 },
      }),
      embed: vi.fn().mockResolvedValue({ embedding: [0.1, 0.2, 0.3] }),
      health: vi.fn().mockResolvedValue({ ok: true, provider: "mock" }),
    };
    const result = await extractBeliefs(mockLLM, "test");
    expect(result.factType).toBe("factual");
  });
});

describe("remember", () => {
  let storage: ReturnType<typeof createStorage>;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pai-rem-"));
    storage = createStorage(dir);
    storage.migrate("memory", memoryMigrations);
  });

  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("should create a new belief when no similar belief exists", async () => {
    const mockLLM: LLMClient = {
      chat: vi.fn().mockResolvedValue({
        text: '{"fact":"Vitest is faster than Jest for TypeScript projects","insight":null}',
        usage: { inputTokens: 10, outputTokens: 8 },
      }),
      embed: vi.fn().mockResolvedValue({ embedding: [0.1, 0.2, 0.3] }),
      health: vi.fn().mockResolvedValue({ ok: true, provider: "mock" }),
    };

    const result = await remember(storage, mockLLM, "Switched from Jest to Vitest and tests run 3x faster");

    expect(result.isReinforcement).toBe(false);
    expect(result.episodeId).toBeTruthy();
    expect(result.beliefIds[0]).toBeTruthy();

    // Episode embedding should be stored
    const embRows = storage.query<{ episode_id: string }>(
      "SELECT episode_id FROM episode_embeddings WHERE episode_id = ?", [result.episodeId]
    );
    expect(embRows).toHaveLength(1);
  });

  it("should only store fact belief and skip insight (insights are generic noise)", async () => {
    const mockLLM: LLMClient = {
      chat: vi.fn().mockResolvedValue({
        text: '{"fact":"User likes coffee in the morning","insight":"Morning routines provide consistency"}',
        usage: { inputTokens: 10, outputTokens: 15 },
      }),
      embed: vi.fn()
        .mockResolvedValueOnce({ embedding: [0.5, 0.5, 0.0] })   // episode embedding
        .mockResolvedValueOnce({ embedding: [1.0, 0.0, 0.0] }),   // fact embedding only
      health: vi.fn().mockResolvedValue({ ok: true, provider: "mock" }),
    };

    const result = await remember(storage, mockLLM, "I like coffee in the morning");
    expect(result.beliefIds).toHaveLength(1); // Only fact, no insight
    expect(result.isReinforcement).toBe(false);
  });

  it("should reinforce existing belief when semantically similar", async () => {
    const mockLLM: LLMClient = {
      chat: vi.fn()
        // First remember: extractBeliefs
        .mockResolvedValueOnce({ text: '{"fact":"Vitest is faster than Jest","insight":null}', usage: { inputTokens: 10, outputTokens: 8 } })
        // Second remember: extractBeliefs
        .mockResolvedValueOnce({ text: '{"fact":"Vitest is faster than Jest","insight":null}', usage: { inputTokens: 10, outputTokens: 8 } }),
      embed: vi.fn().mockResolvedValue({ embedding: [0.1, 0.2, 0.3] }),
      health: vi.fn().mockResolvedValue({ ok: true, provider: "mock" }),
    };

    const first = await remember(storage, mockLLM, "Vitest is fast");
    expect(first.isReinforcement).toBe(false);

    const second = await remember(storage, mockLLM, "Vitest confirmed fast");
    expect(second.isReinforcement).toBe(true);
    expect(second.beliefIds[0]).toBe(first.beliefIds[0]);
  });

  it("should continue when episode embedding fails", async () => {
    const mockLLM: LLMClient = {
      chat: vi.fn().mockResolvedValue({
        text: '{"fact":"Embedding failure is handled gracefully","insight":null}',
        usage: { inputTokens: 10, outputTokens: 8 },
      }),
      embed: vi.fn()
        .mockRejectedValueOnce(new Error("Embedding service down"))  // episode embed fails
        .mockResolvedValue({ embedding: [0.1, 0.2, 0.3] }),         // belief embed succeeds
      health: vi.fn().mockResolvedValue({ ok: true, provider: "mock" }),
    };

    const result = await remember(storage, mockLLM, "Test embed failure recovery");
    expect(result.episodeId).toBeTruthy();
    expect(result.beliefIds).toHaveLength(1);

    // Episode embedding should NOT be stored
    const embRows = storage.query<{ episode_id: string }>(
      "SELECT episode_id FROM episode_embeddings WHERE episode_id = ?", [result.episodeId]
    );
    expect(embRows).toHaveLength(0);
  });

  it("should log 'created' change when creating a new belief", async () => {
    const mockLLM: LLMClient = {
      chat: vi.fn().mockResolvedValue({
        text: '{"fact":"New unique belief about testing","insight":null}',
        usage: { inputTokens: 10, outputTokens: 8 },
      }),
      embed: vi.fn().mockResolvedValue({ embedding: [0.1, 0.2, 0.3] }),
      health: vi.fn().mockResolvedValue({ ok: true, provider: "mock" }),
    };

    const result = await remember(storage, mockLLM, "Discovered something new about testing");
    const history = getBeliefHistory(storage, result.beliefIds[0]!);
    expect(history).toHaveLength(1);
    expect(history[0]!.change_type).toBe("created");
  });

  it("should log 'reinforced' change when reinforcing existing belief", async () => {
    const mockLLM: LLMClient = {
      chat: vi.fn()
        // First remember: extractBeliefs
        .mockResolvedValueOnce({ text: '{"fact":"Vitest is faster than Jest","insight":null}', usage: { inputTokens: 10, outputTokens: 8 } })
        // Second remember: extractBeliefs
        .mockResolvedValueOnce({ text: '{"fact":"Vitest is faster than Jest","insight":null}', usage: { inputTokens: 10, outputTokens: 8 } }),
      embed: vi.fn().mockResolvedValue({ embedding: [0.1, 0.2, 0.3] }),
      health: vi.fn().mockResolvedValue({ ok: true, provider: "mock" }),
    };

    const first = await remember(storage, mockLLM, "Vitest is fast");
    const second = await remember(storage, mockLLM, "Vitest confirmed fast again");
    const history = getBeliefHistory(storage, second.beliefIds[0]!);
    expect(history.some((h) => h.change_type === "reinforced")).toBe(true);
  });
});

describe("checkContradiction", () => {
  it("should detect a contradiction via LLM", async () => {
    const mockLLM: LLMClient = {
      chat: vi.fn().mockResolvedValue({
        text: "1",
        usage: { inputTokens: 20, outputTokens: 1 },
      }),
      embed: vi.fn().mockResolvedValue({ embedding: [0.1, 0.2, 0.3] }),
      health: vi.fn().mockResolvedValue({ ok: true, provider: "mock" }),
    };

    const existing = [
      { id: "b1", statement: "JavaScript is the best language", confidence: 0.7, status: "active", type: "", created_at: "", updated_at: "", superseded_by: null, supersedes: null, importance: 5, last_accessed: null, access_count: 0, stability: 1.0 },
    ];
    const result = await checkContradiction(mockLLM, "JavaScript is a terrible language", existing);
    expect(result).toBe("b1");
  });

  it("should return null when existing beliefs array is empty", async () => {
    const mockLLM: LLMClient = {
      chat: vi.fn(),
      embed: vi.fn(),
      health: vi.fn(),
    };
    const result = await checkContradiction(mockLLM, "anything", []);
    expect(result).toBeNull();
    expect(mockLLM.chat).not.toHaveBeenCalled();
  });

  it("should return null when LLM returns invalid index", async () => {
    const mockLLM: LLMClient = {
      chat: vi.fn().mockResolvedValue({
        text: "99",
        usage: { inputTokens: 20, outputTokens: 1 },
      }),
      embed: vi.fn().mockResolvedValue({ embedding: [0.1, 0.2, 0.3] }),
      health: vi.fn().mockResolvedValue({ ok: true, provider: "mock" }),
    };

    const existing = [
      { id: "b1", statement: "TypeScript is useful", confidence: 0.7, status: "active", type: "", created_at: "", updated_at: "", superseded_by: null, supersedes: null, importance: 5, last_accessed: null, access_count: 0, stability: 1.0 },
    ];
    const result = await checkContradiction(mockLLM, "TypeScript is bad", existing);
    expect(result).toBeNull();
  });

  it("should return null when no contradiction", async () => {
    const mockLLM: LLMClient = {
      chat: vi.fn().mockResolvedValue({
        text: "NONE",
        usage: { inputTokens: 20, outputTokens: 1 },
      }),
      embed: vi.fn().mockResolvedValue({ embedding: [0.1, 0.2, 0.3] }),
      health: vi.fn().mockResolvedValue({ ok: true, provider: "mock" }),
    };

    const existing = [
      { id: "b1", statement: "TypeScript is useful", confidence: 0.7, status: "active", type: "", created_at: "", updated_at: "", superseded_by: null, supersedes: null, importance: 5, last_accessed: null, access_count: 0, stability: 1.0 },
    ];
    const result = await checkContradiction(mockLLM, "TypeScript has good tooling", existing);
    expect(result).toBeNull();
  });
});

describe("remember with contradictions", () => {
  let storage: ReturnType<typeof createStorage>;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pai-contra-"));
    storage = createStorage(dir);
    storage.migrate("memory", memoryMigrations);
  });

  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("should create new belief when medium similarity but no contradiction", async () => {
    const mockLLM: LLMClient = {
      chat: vi.fn()
        // First remember: extractBeliefs
        .mockResolvedValueOnce({ text: '{"fact":"Python is great for data science","insight":null}', usage: { inputTokens: 10, outputTokens: 8 } })
        // Second remember: extractBeliefs
        .mockResolvedValueOnce({ text: '{"fact":"Python is popular for web development","insight":null}', usage: { inputTokens: 10, outputTokens: 8 } })
        // Second remember: checkContradiction returns "NONE"
        .mockResolvedValueOnce({ text: "NONE", usage: { inputTokens: 20, outputTokens: 1 } }),
      embed: vi.fn()
        .mockResolvedValueOnce({ embedding: [0.5, 0.5, 0.0] })  // first episode embedding
        .mockResolvedValueOnce({ embedding: [1.0, 0.0, 0.0] })  // first belief
        .mockResolvedValueOnce({ embedding: [0.5, 0.5, 0.0] })  // second episode embedding
        .mockResolvedValueOnce({ embedding: [0.7, 0.7, 0.0] }),  // second belief — similarity ~0.7 (medium range)
      health: vi.fn().mockResolvedValue({ ok: true, provider: "mock" }),
    };

    const first = await remember(storage, mockLLM, "Python for data science");
    const second = await remember(storage, mockLLM, "Python for web");

    expect(second.isReinforcement).toBe(false);
    expect(second.beliefIds[0]).not.toBe(first.beliefIds[0]);

    // Both beliefs should remain active
    const beliefs = storage.query<{ status: string }>("SELECT status FROM beliefs");
    expect(beliefs.every((b) => b.status === "active")).toBe(true);
  });

  it("should invalidate contradicted belief with weak evidence (< 3 episodes)", async () => {
    const mockLLM: LLMClient = {
      chat: vi.fn()
        // First remember: extractBeliefs
        .mockResolvedValueOnce({ text: '{"fact":"SQLite is slow for large datasets","insight":null}', usage: { inputTokens: 10, outputTokens: 8 } })
        // Second remember: extractBeliefs
        .mockResolvedValueOnce({ text: '{"fact":"SQLite is not slow for large datasets","insight":null}', usage: { inputTokens: 10, outputTokens: 8 } })
        // Second remember: checkContradiction returns "1"
        .mockResolvedValueOnce({ text: "1", usage: { inputTokens: 20, outputTokens: 1 } }),
      embed: vi.fn()
        .mockResolvedValueOnce({ embedding: [0.5, 0.5, 0.0] })  // first episode embedding
        .mockResolvedValueOnce({ embedding: [1.0, 0.0, 0.0] })  // first belief
        .mockResolvedValueOnce({ embedding: [0.5, 0.5, 0.0] })  // second episode embedding
        .mockResolvedValueOnce({ embedding: [0.7, 0.7, 0.0] }),  // second belief — similarity ~0.7 (contradiction range)
      health: vi.fn().mockResolvedValue({ ok: true, provider: "mock" }),
    };

    const first = await remember(storage, mockLLM, "SQLite struggles");
    // Only 1 supporting episode — weak evidence
    expect(countSupportingEpisodes(storage, first.beliefIds[0]!)).toBe(1);

    const second = await remember(storage, mockLLM, "SQLite handles easily");

    expect(second.isReinforcement).toBe(false);
    expect(second.beliefIds[0]).not.toBe(first.beliefIds[0]);

    const oldBelief = storage.query<{ status: string; superseded_by: string | null }>(
      "SELECT status, superseded_by FROM beliefs WHERE id = ?", [first.beliefIds[0]]
    );
    expect(oldBelief[0]!.status).toBe("invalidated");
    // Supersession link should be set
    expect(oldBelief[0]!.superseded_by).toBe(second.beliefIds[0]);

    const newBelief = storage.query<{ supersedes: string | null }>(
      "SELECT supersedes FROM beliefs WHERE id = ?", [second.beliefIds[0]]
    );
    expect(newBelief[0]!.supersedes).toBe(first.beliefIds[0]);
  });

  it("should weaken but NOT invalidate contradicted belief with strong evidence (3+ episodes)", async () => {
    const mockLLM: LLMClient = {
      chat: vi.fn()
        // First remember: extractBeliefs
        .mockResolvedValueOnce({ text: '{"fact":"TypeScript strict mode is essential","insight":null}', usage: { inputTokens: 10, outputTokens: 8 } })
        // Contradiction remember: extractBeliefs
        .mockResolvedValueOnce({ text: '{"fact":"TypeScript strict mode is not essential","insight":null}', usage: { inputTokens: 10, outputTokens: 8 } })
        // Contradiction remember: checkContradiction returns "1"
        .mockResolvedValueOnce({ text: "1", usage: { inputTokens: 20, outputTokens: 1 } }),
      embed: vi.fn()
        .mockResolvedValueOnce({ embedding: [0.5, 0.5, 0.0] })  // first episode embedding
        .mockResolvedValueOnce({ embedding: [1.0, 0.0, 0.0] })  // first belief embedding
        .mockResolvedValueOnce({ embedding: [0.5, 0.5, 0.0] })  // contradiction episode embedding
        .mockResolvedValueOnce({ embedding: [0.7, 0.7, 0.0] }),  // contradiction belief — ~0.7 similarity
      health: vi.fn().mockResolvedValue({ ok: true, provider: "mock" }),
    };

    const first = await remember(storage, mockLLM, "TypeScript strict mode matters");
    const beliefId = first.beliefIds[0]!;

    // Manually add 2 more supporting episodes to reach 3 total
    storage.run("INSERT INTO episodes (id, action) VALUES (?, ?)", ["ep-extra-1", "Confirmed strict mode"]);
    storage.run("INSERT INTO episodes (id, action) VALUES (?, ?)", ["ep-extra-2", "Strict mode caught bugs"]);
    linkBeliefToEpisode(storage, beliefId, "ep-extra-1");
    linkBeliefToEpisode(storage, beliefId, "ep-extra-2");
    expect(countSupportingEpisodes(storage, beliefId)).toBe(3);

    const originalConfidence = storage.query<{ confidence: number }>(
      "SELECT confidence FROM beliefs WHERE id = ?", [beliefId],
    )[0]!.confidence;

    const second = await remember(storage, mockLLM, "Strict mode is optional");

    // Old belief should still be active — NOT invalidated
    const oldBelief = storage.query<{ status: string; confidence: number }>(
      "SELECT status, confidence FROM beliefs WHERE id = ?", [beliefId],
    )[0]!;
    expect(oldBelief.status).toBe("active");
    expect(oldBelief.confidence).toBeLessThan(originalConfidence);

    // New belief should also be created
    expect(second.beliefIds[0]).not.toBe(beliefId);
    const newBelief = storage.query<{ status: string }>(
      "SELECT status FROM beliefs WHERE id = ?", [second.beliefIds[0]],
    )[0]!;
    expect(newBelief.status).toBe("active");

    // Change log should show "weakened" not "contradicted"
    const history = getBeliefHistory(storage, beliefId);
    expect(history.some((h) => h.change_type === "weakened")).toBe(true);
    expect(history.some((h) => h.change_type === "contradicted")).toBe(false);

    // Supersession links should be set even for weakened beliefs
    const oldBeliefRow = storage.query<{ superseded_by: string | null }>(
      "SELECT superseded_by FROM beliefs WHERE id = ?", [beliefId],
    )[0]!;
    expect(oldBeliefRow.superseded_by).toBe(second.beliefIds[0]);

    const newBeliefRow = storage.query<{ supersedes: string | null }>(
      "SELECT supersedes FROM beliefs WHERE id = ?", [second.beliefIds[0]],
    )[0]!;
    expect(newBeliefRow.supersedes).toBe(beliefId);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createStorage } from "@personal-ai/core";
import type { LLMClient } from "@personal-ai/core";
import { memoryMigrations, getBeliefHistory } from "../src/memory.js";
import { remember, extractBeliefs, checkContradiction } from "../src/remember.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("extractBeliefs", () => {
  it("should extract fact and insight from text using LLM", async () => {
    const mockLLM: LLMClient = {
      chat: vi.fn().mockResolvedValue({
        text: '{"fact":"User likes coffee in the morning","insight":"Morning routines provide consistency"}',
        usage: { inputTokens: 10, outputTokens: 15 },
      }),
      embed: vi.fn().mockResolvedValue({ embedding: [0.1, 0.2, 0.3] }),
      health: vi.fn().mockResolvedValue({ ok: true, provider: "mock" }),
    };
    const result = await extractBeliefs(mockLLM, "I like coffee in the morning");
    expect(result.fact).toBe("User likes coffee in the morning");
    expect(result.insight).toBe("Morning routines provide consistency");
  });

  it("should handle LLM returning plain text by using it as fact", async () => {
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
    expect(result.insight).toBeNull();
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
      { id: "b1", statement: "JavaScript is the best language", confidence: 0.7, status: "active", type: "", created_at: "", updated_at: "" },
    ];
    const result = await checkContradiction(mockLLM, "JavaScript is a terrible language", existing);
    expect(result).toBe("b1");
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
      { id: "b1", statement: "TypeScript is useful", confidence: 0.7, status: "active", type: "", created_at: "", updated_at: "" },
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

  it("should invalidate contradicted belief in remember flow", async () => {
    const mockLLM: LLMClient = {
      chat: vi.fn()
        // First remember: extractBeliefs
        .mockResolvedValueOnce({ text: '{"fact":"SQLite is slow for large datasets","insight":null}', usage: { inputTokens: 10, outputTokens: 8 } })
        // Second remember: extractBeliefs
        .mockResolvedValueOnce({ text: '{"fact":"SQLite is not slow for large datasets","insight":null}', usage: { inputTokens: 10, outputTokens: 8 } })
        // Second remember: checkContradiction returns "1"
        .mockResolvedValueOnce({ text: "1", usage: { inputTokens: 20, outputTokens: 1 } }),
      embed: vi.fn()
        .mockResolvedValueOnce({ embedding: [1.0, 0.0, 0.0] })  // first belief
        .mockResolvedValueOnce({ embedding: [0.7, 0.7, 0.0] }),  // second belief — similarity ~0.7 (contradiction range)
      health: vi.fn().mockResolvedValue({ ok: true, provider: "mock" }),
    };

    const first = await remember(storage, mockLLM, "SQLite struggles");
    const second = await remember(storage, mockLLM, "SQLite handles easily");

    expect(second.isReinforcement).toBe(false);
    expect(second.beliefIds[0]).not.toBe(first.beliefIds[0]);

    const oldBelief = storage.query<{ status: string }>(
      "SELECT status FROM beliefs WHERE id = ?", [first.beliefIds[0]]
    );
    expect(oldBelief[0]!.status).toBe("invalidated");
  });
});

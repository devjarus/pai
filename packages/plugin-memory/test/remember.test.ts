import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createStorage } from "@personal-ai/core";
import type { LLMClient } from "@personal-ai/core";
import { memoryMigrations, getBeliefHistory } from "../src/memory.js";
import { remember, extractBelief, checkContradiction } from "../src/remember.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("extractBelief", () => {
  it("should extract a belief from episode text using LLM", async () => {
    const mockLLM: LLMClient = {
      chat: vi.fn().mockResolvedValue({
        text: "TypeScript strict mode catches more bugs at compile time",
        usage: { inputTokens: 10, outputTokens: 5 },
      }),
      health: vi.fn().mockResolvedValue({ ok: true, provider: "mock" }),
    };
    const result = await extractBelief(mockLLM, "Switched to TypeScript strict mode and found 12 hidden bugs");
    expect(result).toBe("TypeScript strict mode catches more bugs at compile time");
    expect(mockLLM.chat).toHaveBeenCalledOnce();
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
        text: "Vitest is faster than Jest for TypeScript projects",
        usage: { inputTokens: 10, outputTokens: 8 },
      }),
      health: vi.fn().mockResolvedValue({ ok: true, provider: "mock" }),
    };

    const result = await remember(storage, mockLLM, "Switched from Jest to Vitest and tests run 3x faster");

    expect(result.isReinforcement).toBe(false);
    expect(result.episodeId).toBeTruthy();
    expect(result.beliefId).toBeTruthy();
  });

  it("should reinforce existing belief when a similar belief exists", async () => {
    const mockLLM: LLMClient = {
      chat: vi.fn()
        // First remember: extractBelief
        .mockResolvedValueOnce({ text: "Vitest is faster than Jest for TypeScript projects", usage: { inputTokens: 10, outputTokens: 8 } })
        // Second remember: extractBelief
        .mockResolvedValueOnce({ text: "Vitest is faster than Jest for TypeScript projects", usage: { inputTokens: 10, outputTokens: 8 } })
        // Second remember: checkContradiction -> NONE
        .mockResolvedValueOnce({ text: "NONE", usage: { inputTokens: 20, outputTokens: 1 } }),
      health: vi.fn().mockResolvedValue({ ok: true, provider: "mock" }),
    };

    // First call creates a new belief
    const first = await remember(storage, mockLLM, "Switched from Jest to Vitest and tests run 3x faster");
    expect(first.isReinforcement).toBe(false);

    // Second call with the same LLM response should reinforce
    const second = await remember(storage, mockLLM, "Vitest continues to outperform Jest in our CI pipeline");
    expect(second.isReinforcement).toBe(true);
    expect(second.beliefId).toBe(first.beliefId);
  });

  it("should log 'created' change when creating a new belief", async () => {
    const mockLLM: LLMClient = {
      chat: vi.fn().mockResolvedValue({
        text: "New unique belief about testing",
        usage: { inputTokens: 10, outputTokens: 8 },
      }),
      health: vi.fn().mockResolvedValue({ ok: true, provider: "mock" }),
    };

    const result = await remember(storage, mockLLM, "Discovered something new about testing");
    const history = getBeliefHistory(storage, result.beliefId);
    expect(history).toHaveLength(1);
    expect(history[0]!.change_type).toBe("created");
  });

  it("should log 'reinforced' change when reinforcing existing belief", async () => {
    const mockLLM: LLMClient = {
      chat: vi.fn()
        // First remember: extractBelief
        .mockResolvedValueOnce({ text: "Vitest is faster than Jest", usage: { inputTokens: 10, outputTokens: 8 } })
        // Second remember: extractBelief
        .mockResolvedValueOnce({ text: "Vitest is faster than Jest", usage: { inputTokens: 10, outputTokens: 8 } })
        // Second remember: checkContradiction -> NONE
        .mockResolvedValueOnce({ text: "NONE", usage: { inputTokens: 20, outputTokens: 1 } }),
      health: vi.fn().mockResolvedValue({ ok: true, provider: "mock" }),
    };

    const first = await remember(storage, mockLLM, "Vitest is fast");
    const second = await remember(storage, mockLLM, "Vitest confirmed fast again");
    const history = getBeliefHistory(storage, second.beliefId);
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
      health: vi.fn().mockResolvedValue({ ok: true, provider: "mock" }),
    };

    const existing = [
      { id: "b1", statement: "JavaScript is the best language", confidence: 0.7, status: "active", created_at: "", updated_at: "" },
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
      health: vi.fn().mockResolvedValue({ ok: true, provider: "mock" }),
    };

    const existing = [
      { id: "b1", statement: "TypeScript is useful", confidence: 0.7, status: "active", created_at: "", updated_at: "" },
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
        // First remember: extract belief
        .mockResolvedValueOnce({ text: "SQLite is slow for large datasets", usage: { inputTokens: 10, outputTokens: 8 } })
        // Second remember: extract belief (shares enough words with first for FTS5 match)
        .mockResolvedValueOnce({ text: "SQLite is not slow for large datasets", usage: { inputTokens: 10, outputTokens: 8 } })
        // Second remember: contradiction check returns "1"
        .mockResolvedValueOnce({ text: "1", usage: { inputTokens: 20, outputTokens: 1 } }),
      health: vi.fn().mockResolvedValue({ ok: true, provider: "mock" }),
    };

    const first = await remember(storage, mockLLM, "SQLite struggles with big data");
    const second = await remember(storage, mockLLM, "SQLite handles big data easily");

    expect(second.isReinforcement).toBe(false);
    expect(second.beliefId).not.toBe(first.beliefId);

    // Old belief should be invalidated
    const oldBelief = storage.query<{ status: string }>(
      "SELECT status FROM beliefs WHERE id = ?", [first.beliefId]
    );
    expect(oldBelief[0]!.status).toBe("invalidated");
  });
});

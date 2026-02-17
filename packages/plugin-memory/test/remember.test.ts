import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createStorage } from "@personal-ai/core";
import type { LLMClient } from "@personal-ai/core";
import { memoryMigrations, getBeliefHistory } from "../src/memory.js";
import { remember, extractBelief } from "../src/remember.js";
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
      chat: vi.fn().mockResolvedValue({
        text: "Vitest is faster than Jest for TypeScript projects",
        usage: { inputTokens: 10, outputTokens: 8 },
      }),
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
      chat: vi.fn().mockResolvedValue({
        text: "Vitest is faster than Jest",
        usage: { inputTokens: 10, outputTokens: 8 },
      }),
      health: vi.fn().mockResolvedValue({ ok: true, provider: "mock" }),
    };

    const first = await remember(storage, mockLLM, "Vitest is fast");
    const second = await remember(storage, mockLLM, "Vitest confirmed fast again");
    const history = getBeliefHistory(storage, second.beliefId);
    expect(history.some((h) => h.change_type === "reinforced")).toBe(true);
  });
});

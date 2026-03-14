import { describe, it, expect } from "vitest";
import { getProviderOptions, hasNativeContextManagement, trimMessagesForBudget } from "../src/provider-options.js";

describe("getProviderOptions", () => {
  it("returns context management for anthropic with correct trigger tokens (85% of contextWindow)", () => {
    const contextWindow = 100000;
    const result = getProviderOptions("anthropic", contextWindow);

    expect(result).toBeDefined();
    expect(result).toHaveProperty("anthropic");

    const anthropicOpts = result!["anthropic"] as { contextManagement: { edits: unknown[] } };
    expect(anthropicOpts).toHaveProperty("contextManagement");

    const { edits } = anthropicOpts.contextManagement;
    expect(Array.isArray(edits)).toBe(true);
    expect(edits).toHaveLength(2);

    const triggerTokens = Math.floor(contextWindow * 0.85);
    const firstEdit = edits[0] as { type: string; trigger: { type: string; value: number }; keep: { type: string; value: number } };
    expect(firstEdit.type).toBe("clear_tool_uses_20250919");
    expect(firstEdit.trigger.type).toBe("input_tokens");
    expect(firstEdit.trigger.value).toBe(triggerTokens);
    expect(firstEdit.keep.type).toBe("tool_uses");
    expect(firstEdit.keep.value).toBe(3);

    const secondEdit = edits[1] as { type: string; trigger: { type: string; value: number } };
    expect(secondEdit.type).toBe("compact_20260112");
    expect(secondEdit.trigger.type).toBe("input_tokens");
    expect(secondEdit.trigger.value).toBe(triggerTokens);
  });

  it("computes trigger tokens as floor of 85% of contextWindow", () => {
    const contextWindow = 200000;
    const result = getProviderOptions("anthropic", contextWindow);

    const anthropicOpts = result!["anthropic"] as { contextManagement: { edits: Array<{ trigger: { value: number } }> } };
    const triggerTokens = Math.floor(200000 * 0.85);
    expect(triggerTokens).toBe(170000);
    expect(anthropicOpts.contextManagement.edits[0].trigger.value).toBe(triggerTokens);
  });

  it("returns truncation auto for openai", () => {
    const result = getProviderOptions("openai", 128000);

    expect(result).toBeDefined();
    expect(result).toHaveProperty("openai");
    const openaiOpts = result!["openai"] as { truncation: string };
    expect(openaiOpts.truncation).toBe("auto");
  });

  it("returns undefined for ollama", () => {
    const result = getProviderOptions("ollama", 32000);
    expect(result).toBeUndefined();
  });

  it("returns undefined for google", () => {
    const result = getProviderOptions("google", 1000000);
    expect(result).toBeUndefined();
  });

  it("returns undefined for unknown provider", () => {
    const result = getProviderOptions("someunknownprovider", 50000);
    expect(result).toBeUndefined();
  });
});

describe("hasNativeContextManagement", () => {
  it("returns true for anthropic", () => {
    expect(hasNativeContextManagement("anthropic")).toBe(true);
  });

  it("returns true for openai", () => {
    expect(hasNativeContextManagement("openai")).toBe(true);
  });

  it("returns false for ollama", () => {
    expect(hasNativeContextManagement("ollama")).toBe(false);
  });

  it("returns false for google", () => {
    expect(hasNativeContextManagement("google")).toBe(false);
  });

  it("returns false for cerebras", () => {
    expect(hasNativeContextManagement("cerebras")).toBe(false);
  });
});

describe("trimMessagesForBudget", () => {
  const msg = (role: string, content: string) => ({ role, content });

  it("is a no-op for anthropic", () => {
    const messages = [
      msg("system", "x".repeat(100_000)),
      msg("user", "y".repeat(100_000)),
    ];
    const result = trimMessagesForBudget(messages, "anthropic", 8192);
    expect(result).toBe(messages); // same reference, not a copy
  });

  it("is a no-op for openai", () => {
    const messages = [
      msg("system", "x".repeat(100_000)),
      msg("user", "y".repeat(100_000)),
    ];
    const result = trimMessagesForBudget(messages, "openai", 8192);
    expect(result).toBe(messages);
  });

  it("returns messages unchanged when within budget", () => {
    const messages = [
      msg("system", "Hello"),
      msg("user", "Hi"),
      msg("assistant", "How can I help?"),
      msg("user", "Tell me a joke"),
    ];
    // 4 chars avg * 4 msgs = ~16 chars => ~4 tokens, well under 8192
    const result = trimMessagesForBudget(messages, "ollama", 8192);
    expect(result).toEqual(messages);
  });

  it("trims oldest middle messages when over budget for ollama", () => {
    const system = msg("system", "System prompt");
    const old1 = msg("user", "a".repeat(10_000));
    const old2 = msg("assistant", "b".repeat(10_000));
    const recent = msg("user", "c".repeat(10_000));
    const latest = msg("user", "Current question");

    // Total: ~30K chars => ~7500 tokens. Context window 4000 => budget 3400 tokens => ~13600 chars
    const result = trimMessagesForBudget(
      [system, old1, old2, recent, latest],
      "ollama",
      4000,
    );

    // Should keep system (first) and latest (last), plus as many recent middle as fit
    expect(result[0]).toBe(system);
    expect(result[result.length - 1]).toBe(latest);
    // old1 and old2 should be dropped (oldest), recent might be kept
    expect(result.length).toBeLessThan(5);
  });

  it("always keeps first and last message even if over budget", () => {
    const messages = [
      msg("system", "x".repeat(40_000)),
      msg("user", "y".repeat(40_000)),
    ];
    // Way over any budget, but only 2 messages — can't trim further
    const result = trimMessagesForBudget(messages, "google", 1000);
    expect(result).toEqual(messages);
  });

  it("preserves message order after trimming", () => {
    const messages = [
      msg("system", "sys"),
      msg("user", "a".repeat(5000)),
      msg("assistant", "b".repeat(5000)),
      msg("user", "c".repeat(5000)),
      msg("assistant", "d".repeat(5000)),
      msg("user", "latest"),
    ];
    // Budget: 8000 tokens => 6800 input budget => ~27200 chars
    // Total: ~20006 chars + overhead, should fit mostly
    // With tighter budget:
    const result = trimMessagesForBudget(messages, "cerebras", 4000);
    // Should be in order
    expect(result[0]).toBe(messages[0]); // system
    expect(result[result.length - 1]).toBe(messages[messages.length - 1]); // latest user
    for (let i = 1; i < result.length; i++) {
      const origIdx = messages.indexOf(result[i]!);
      const prevOrigIdx = messages.indexOf(result[i - 1]!);
      expect(origIdx).toBeGreaterThan(prevOrigIdx);
    }
  });
});

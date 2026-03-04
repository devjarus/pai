import { describe, it, expect } from "vitest";
import { getProviderOptions } from "../src/provider-options.js";

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

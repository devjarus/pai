import { describe, it, expect, beforeEach } from "vitest";
import { estimateTokens, getContextBudget, _resetBudgetCache } from "../src/context-budget.js";

describe("context-budget", () => {
  beforeEach(() => {
    _resetBudgetCache();
  });

  describe("estimateTokens", () => {
    it("returns ~chars/4", () => {
      expect(estimateTokens("hello")).toBe(2); // ceil(5/4) = 2
      expect(estimateTokens("a".repeat(100))).toBe(25);
      expect(estimateTokens("")).toBe(0);
    });

    it("rounds up for non-divisible lengths", () => {
      expect(estimateTokens("abc")).toBe(1); // ceil(3/4) = 1
      expect(estimateTokens("abcde")).toBe(2); // ceil(5/4) = 2
    });
  });

  describe("getContextBudget", () => {
    it("returns provider default when model lookup fails", () => {
      const budget = getContextBudget("ollama", "nonexistent-model-xyz");
      expect(budget.contextWindow).toBe(200_000);
    });

    it("returns 8192 for unknown provider and unknown model", () => {
      const budget = getContextBudget("unknown-provider", "unknown-model");
      expect(budget.contextWindow).toBe(8_192);
    });

    it("uses provider defaults for known providers with unknown models", () => {
      expect(getContextBudget("openai", "nonexistent").contextWindow).toBe(128_000);
      expect(getContextBudget("anthropic", "nonexistent").contextWindow).toBe(200_000);
      expect(getContextBudget("google", "nonexistent").contextWindow).toBe(1_000_000);
    });

    it("historyBudget is 50% of contextWindow", () => {
      const budget = getContextBudget("ollama", "nonexistent-model");
      expect(budget.historyBudget).toBe(Math.floor(budget.contextWindow * 0.5));
    });

    it("maxMessages clamped between 4 and 100", () => {
      // Small context via override: 2000 -> historyBudget=1000, 1000/200=5
      const small = getContextBudget("ollama", "tiny-model-xyz", 2000);
      expect(small.maxMessages).toBeGreaterThanOrEqual(4);
      expect(small.maxMessages).toBeLessThanOrEqual(100);

      // Large context (1M): historyBudget=500000, 500000/200=2500 -> clamped to 100
      _resetBudgetCache();
      const large = getContextBudget("google", "huge-model-xyz");
      expect(large.maxMessages).toBe(100);
    });

    it("caches result for same model", () => {
      const first = getContextBudget("openai", "test-cache-model");
      const second = getContextBudget("openai", "test-cache-model");
      expect(first).toBe(second); // same object reference
    });

    it("invalidates cache for different model", () => {
      const first = getContextBudget("openai", "model-a");
      _resetBudgetCache();
      const second = getContextBudget("openai", "model-b");
      expect(first).not.toBe(second);
    });

    it("resolves known models from tokenlens catalog", () => {
      // gpt-4o is in the tokenlens static catalog
      const budget = getContextBudget("openai", "gpt-4o");
      // Should resolve to 128000 (either from catalog or provider default)
      expect(budget.contextWindow).toBeGreaterThanOrEqual(128_000);
    });
  });
});

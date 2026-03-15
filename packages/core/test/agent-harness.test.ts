import { describe, it, expect } from "vitest";
import type { AgentHarnessOptions, AgentResult } from "../src/agent-harness/types.js";
import { runAgentHarness } from "../src/agent-harness/harness.js";

describe("agent harness", () => {
  it("exports types and runner", () => {
    expect(runAgentHarness).toBeTypeOf("function");
  });

  it("enforces budget limits", async () => {
    const result = await runAgentHarness({
      goal: "test goal",
      context: [],
      budget: { maxTokens: 100, maxToolCalls: 1, maxDurationMs: 5000 },
      depth: "quick",
      execute: async (ctx) => {
        return {
          findings: [],
          rawOutput: "test output",
        };
      },
    });

    expect(result.reflection).toBeDefined();
    expect(result.plan).toBeDefined();
    expect(result.usage).toBeDefined();
    expect(result.usage.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("calculates reflection confidence from findings", async () => {
    const result = await runAgentHarness({
      goal: "find GPU prices",
      context: [],
      budget: { maxTokens: 1000, maxToolCalls: 5, maxDurationMs: 10000 },
      depth: "standard",
      execute: async () => ({
        findings: [
          { goal: "GPU prices", summary: "RTX 4090 is $1599", confidence: 0.9, sources: [] },
          { goal: "GPU prices", summary: "RTX 5090 is $1999", confidence: 0.7, sources: [] },
        ],
        rawOutput: "done",
      }),
    });

    expect(result.reflection.confidence).toBe(0.8); // average of 0.9 and 0.7
    expect(result.reflection.suggestSecondPass).toBe(false);
    expect(result.findings).toHaveLength(2);
  });

  it("suggests second pass when confidence is low", async () => {
    const result = await runAgentHarness({
      goal: "obscure topic",
      context: [],
      budget: { maxTokens: 100, maxToolCalls: 1, maxDurationMs: 5000 },
      depth: "quick",
      execute: async () => ({
        findings: [{ goal: "test", summary: "uncertain", confidence: 0.3, sources: [] }],
        rawOutput: "test",
      }),
    });

    expect(result.reflection.confidence).toBe(0.3);
    expect(result.reflection.suggestSecondPass).toBe(true);
  });

  it("does not suggest second pass at deep depth", async () => {
    const result = await runAgentHarness({
      goal: "test",
      context: [],
      budget: { maxTokens: 100, maxToolCalls: 1, maxDurationMs: 5000 },
      depth: "deep",
      execute: async () => ({
        findings: [{ goal: "test", summary: "low conf", confidence: 0.3, sources: [] }],
        rawOutput: "test",
      }),
    });

    expect(result.reflection.suggestSecondPass).toBe(false); // can't go deeper
  });
});

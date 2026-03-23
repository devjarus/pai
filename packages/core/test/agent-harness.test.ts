import { describe, it, expect } from "vitest";
import { runAgentHarness } from "../src/agent-harness/harness.js";

describe("agent harness", () => {
  const baseAgent = {
    id: "research-agent",
    label: "Research Agent",
    block: "research",
  } as const;

  it("exports types and runner", () => {
    expect(runAgentHarness).toBeTypeOf("function");
  });

  it("tracks platform blocks and telemetry callbacks", async () => {
    const events: string[] = [];

    const result = await runAgentHarness({
      agent: baseAgent,
      goal: "test goal",
      context: [{ id: "ctx-1", snippet: "previous digest baseline", sourceType: "digest" }],
      previousFindings: [{ summary: "Earlier research", createdAt: "2026-03-20T00:00:00Z" }],
      services: {
        knowledge: {
          listPreviousFindings: () => [],
        },
        telemetry: {
          recordPlan: ({ platformBlocks }) => events.push(`plan:${platformBlocks.join(",")}`),
          recordStep: (detail) => events.push(`step:${detail}`),
          recordUsage: (usage) => events.push(`usage:${usage.toolCallsUsed}/${usage.tokensUsed}`),
          recordReflection: (reflection) => events.push(`reflection:${reflection.confidence}`),
        },
      },
      budget: { maxTokens: 100, maxToolCalls: 2, maxDurationMs: 5000 },
      depth: "quick",
      execute: async (ctx) => {
        ctx.noteToolCalls(2);
        ctx.noteTokens(24);
        await ctx.services.telemetry?.recordStep?.("queried knowledge");
        return {
          findings: [],
          rawOutput: "test output",
        };
      },
    });

    expect(result.agent).toEqual(baseAgent);
    expect(result.platformBlocks).toEqual(["knowledge", "telemetry"]);
    expect(result.plan).toContain("Core blocks: knowledge, telemetry");
    expect(events).toContain("plan:knowledge,telemetry");
    expect(events).toContain("step:queried knowledge");
    expect(events).toContain("usage:2/24");
    expect(events).toContain("reflection:0");
  });

  it("flags budget overruns", async () => {
    const result = await runAgentHarness({
      agent: baseAgent,
      goal: "test goal",
      context: [],
      budget: { maxTokens: 100, maxToolCalls: 1, maxDurationMs: 5000 },
      depth: "quick",
      execute: async (ctx) => {
        ctx.noteToolCalls(3);
        ctx.noteTokens(150);
        return {
          findings: [],
          rawOutput: "test output",
        };
      },
    });

    expect(result.budget.exceeded).toBe(true);
    expect(result.budget.toolCallsExceeded).toBe(true);
    expect(result.budget.tokensExceeded).toBe(true);
    expect(result.reflection.completeness).toContain("Budget warnings");
    expect(result.reflection).toBeDefined();
    expect(result.plan).toBeDefined();
    expect(result.usage).toBeDefined();
    expect(result.usage.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("calculates reflection confidence from findings", async () => {
    const result = await runAgentHarness({
      agent: baseAgent,
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
      agent: baseAgent,
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
      agent: baseAgent,
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

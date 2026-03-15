import type { AgentHarnessOptions, AgentResult, AgentHarnessContext } from "./types.js";

export async function runAgentHarness(options: AgentHarnessOptions): Promise<AgentResult> {
  const startTime = Date.now();

  // Plan phase
  const plan = [
    `Research: ${options.goal}`,
    `Depth: ${options.depth}`,
    `Budget: ${options.budget.maxTokens} tokens, ${options.budget.maxToolCalls} tool calls`,
  ];
  if (options.previousFindings?.length) {
    plan.push(`Delta: compare against ${options.previousFindings.length} previous findings`);
  }

  // Execute phase
  const ctx: AgentHarnessContext = {
    budget: options.budget,
    depth: options.depth,
    startTime,
    toolCallsUsed: 0,
  };

  const execResult = await options.execute(ctx);
  const durationMs = Date.now() - startTime;

  // Reflect phase
  const avgConfidence = execResult.findings.length > 0
    ? execResult.findings.reduce((sum, f) => sum + f.confidence, 0) / execResult.findings.length
    : 0;

  const reflection = {
    confidence: avgConfidence,
    completeness: execResult.findings.length > 0 ? "Findings produced" : "No findings — may need deeper research",
    suggestSecondPass: avgConfidence < 0.5 && options.depth !== "deep",
  };

  return {
    plan,
    findings: execResult.findings,
    reflection,
    usage: {
      tokensUsed: 0,
      toolCallsUsed: ctx.toolCallsUsed,
      durationMs,
    },
  };
}

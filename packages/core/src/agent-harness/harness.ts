import type {
  AgentHarnessOptions,
  AgentResult,
  AgentHarnessContext,
  AgentBudgetStatus,
  AgentPlatformServices,
  CorePlatformBlock,
} from "./types.js";

const PLATFORM_BLOCK_ORDER: CorePlatformBlock[] = [
  "memory",
  "knowledge",
  "watches",
  "digests",
  "tasks",
  "telemetry",
];

function listPlatformBlocks(services: AgentPlatformServices): CorePlatformBlock[] {
  return PLATFORM_BLOCK_ORDER.filter((block) => {
    const service = services[block];
    return !!service && Object.keys(service).length > 0;
  });
}

function buildBudgetStatus(
  options: AgentHarnessOptions,
  usage: { tokensUsed: number; toolCallsUsed: number; durationMs: number },
): AgentBudgetStatus {
  const warnings: string[] = [];
  const tokensExceeded = usage.tokensUsed > options.budget.maxTokens;
  const toolCallsExceeded = usage.toolCallsUsed > options.budget.maxToolCalls;
  const durationExceeded = usage.durationMs > options.budget.maxDurationMs;

  if (tokensExceeded) {
    warnings.push(`token budget exceeded (${usage.tokensUsed}/${options.budget.maxTokens})`);
  }
  if (toolCallsExceeded) {
    warnings.push(`tool-call budget exceeded (${usage.toolCallsUsed}/${options.budget.maxToolCalls})`);
  }
  if (durationExceeded) {
    warnings.push(`duration budget exceeded (${usage.durationMs}ms/${options.budget.maxDurationMs}ms)`);
  }

  return {
    exceeded: warnings.length > 0,
    tokensExceeded,
    toolCallsExceeded,
    durationExceeded,
    warnings,
  };
}

export async function runAgentHarness(options: AgentHarnessOptions): Promise<AgentResult> {
  const startTime = Date.now();
  const services = options.services ?? {};
  const platformBlocks = listPlatformBlocks(services);

  // Plan phase
  const plan = [
    `${options.agent.label}: ${options.goal}`,
    `Depth: ${options.depth}`,
    `Budget: ${options.budget.maxTokens} tokens, ${options.budget.maxToolCalls} tool calls, ${options.budget.maxDurationMs}ms`,
  ];
  if (platformBlocks.length > 0) {
    plan.push(`Core blocks: ${platformBlocks.join(", ")}`);
  }
  if (options.context.length > 0) {
    plan.push(`Context: ${options.context.length} preloaded item(s)`);
  }
  if (options.previousFindings?.length) {
    plan.push(`Delta: compare against ${options.previousFindings.length} previous findings`);
  }

  await services.telemetry?.recordPlan?.({
    agent: options.agent,
    plan,
    platformBlocks,
  });

  // Execute phase
  const ctx: AgentHarnessContext = {
    agent: options.agent,
    budget: options.budget,
    depth: options.depth,
    startTime,
    toolCallsUsed: 0,
    tokensUsed: 0,
    context: options.context,
    previousFindings: options.previousFindings ?? [],
    services,
    noteToolCalls: (count = 1) => {
      if (!Number.isFinite(count) || count <= 0) return;
      ctx.toolCallsUsed += Math.max(1, Math.floor(count));
    },
    noteTokens: (count) => {
      if (!Number.isFinite(count) || count <= 0) return;
      ctx.tokensUsed += Math.max(1, Math.floor(count));
    },
    getRemainingBudget: () => {
      const elapsedMs = Date.now() - startTime;
      return {
        tokens: Math.max(0, options.budget.maxTokens - ctx.tokensUsed),
        toolCalls: Math.max(0, options.budget.maxToolCalls - ctx.toolCallsUsed),
        durationMs: Math.max(0, options.budget.maxDurationMs - elapsedMs),
      };
    },
    assertWithinBudget: () => {
      const usage = {
        tokensUsed: ctx.tokensUsed,
        toolCallsUsed: ctx.toolCallsUsed,
        durationMs: Date.now() - startTime,
      };
      const budget = buildBudgetStatus(options, usage);
      if (!budget.exceeded) return;
      throw new Error(`Agent budget exceeded: ${budget.warnings.join("; ")}`);
    },
  };

  const execResult = await options.execute(ctx);
  const durationMs = Date.now() - startTime;
  const usage = {
    tokensUsed: ctx.tokensUsed,
    toolCallsUsed: ctx.toolCallsUsed,
    durationMs,
  };
  const budget = buildBudgetStatus(options, usage);

  // Reflect phase
  const avgConfidence = execResult.findings.length > 0
    ? execResult.findings.reduce((sum, finding) => sum + finding.confidence, 0) / execResult.findings.length
    : 0;

  const completenessBase = execResult.completeness
    ?? (execResult.findings.length > 0 ? "Findings produced" : "No findings — may need deeper research");
  const completeness = budget.exceeded
    ? `${completenessBase}. Budget warnings: ${budget.warnings.join("; ")}`
    : completenessBase;
  const reflection = {
    confidence: avgConfidence,
    completeness,
    suggestSecondPass: avgConfidence < 0.5 && options.depth !== "deep" && !budget.durationExceeded,
  };

  await services.telemetry?.recordUsage?.(usage);
  await services.telemetry?.recordReflection?.(reflection);

  return {
    agent: options.agent,
    platformBlocks,
    plan,
    findings: execResult.findings,
    reflection,
    usage,
    budget,
  };
}

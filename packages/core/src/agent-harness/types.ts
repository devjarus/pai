export interface AgentBudget {
  maxTokens: number;
  maxToolCalls: number;
  maxDurationMs: number;
}

export interface AgentHarnessContext {
  budget: AgentBudget;
  depth: "quick" | "standard" | "deep";
  startTime: number;
  toolCallsUsed: number;
}

export interface AgentExecutionResult {
  findings: Array<{
    goal: string;
    summary: string;
    confidence: number;
    sources: Array<{ url: string; title: string }>;
  }>;
  rawOutput: string;
}

export interface AgentResult {
  plan: string[];
  findings: AgentExecutionResult["findings"];
  reflection: {
    confidence: number;
    completeness: string;
    suggestSecondPass: boolean;
  };
  usage: {
    tokensUsed: number;
    toolCallsUsed: number;
    durationMs: number;
  };
}

export interface AgentHarnessOptions {
  goal: string;
  context: Array<{ id: string; snippet: string; sourceType: string }>;
  previousFindings?: Array<{ summary: string; createdAt: string }>;
  budget: AgentBudget;
  depth: "quick" | "standard" | "deep";
  execute: (ctx: AgentHarnessContext) => Promise<AgentExecutionResult>;
}

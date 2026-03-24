export interface AgentBudget {
  maxTokens: number;
  maxToolCalls: number;
  maxDurationMs: number;
}

export type AgentDepth = "quick" | "standard" | "deep";
export type AgentPlaneBlock = "assistant" | "curator" | "research" | "swarm" | string;
export type CorePlatformBlock = "memory" | "knowledge" | "watches" | "digests" | "tasks" | "telemetry";

export interface AgentIdentity {
  id: string;
  label: string;
  block: AgentPlaneBlock;
}

export interface AgentContextItem {
  id: string;
  snippet: string;
  sourceType: string;
}

export interface AgentPreviousFinding {
  id?: string;
  summary: string;
  createdAt: string;
  confidence?: number;
}

export interface AgentMemoryService {
  searchContext?: (query: string, limit?: number) => Promise<AgentContextItem[]> | AgentContextItem[];
}

export interface AgentKnowledgeService {
  listPreviousFindings?: (watchId: string, limit?: number) => Promise<AgentPreviousFinding[]> | AgentPreviousFinding[];
  searchContext?: (query: string, limit?: number) => Promise<AgentContextItem[]> | AgentContextItem[];
}

export interface AgentWatchService {
  getDeltaContext?: (watchId: string, limit?: number) => Promise<string> | string;
}

export interface AgentDigestService {
  appendJobStep?: (detail: string) => Promise<void> | void;
}

export interface AgentTaskService {
  summarizeLinkedActions?: (watchId: string) => Promise<string | null> | string | null;
}

export interface AgentTelemetryPlan {
  agent: AgentIdentity;
  plan: string[];
  platformBlocks: CorePlatformBlock[];
}

export interface AgentUsage {
  tokensUsed: number;
  toolCallsUsed: number;
  durationMs: number;
}

export interface AgentReflection {
  confidence: number;
  completeness: string;
  suggestSecondPass: boolean;
}

export interface AgentTelemetryService {
  recordPlan?: (input: AgentTelemetryPlan) => Promise<void> | void;
  recordStep?: (detail: string) => Promise<void> | void;
  recordUsage?: (usage: AgentUsage) => Promise<void> | void;
  recordReflection?: (reflection: AgentReflection) => Promise<void> | void;
}

export interface AgentPlatformServices {
  memory?: AgentMemoryService;
  knowledge?: AgentKnowledgeService;
  watches?: AgentWatchService;
  digests?: AgentDigestService;
  tasks?: AgentTaskService;
  telemetry?: AgentTelemetryService;
}

export interface AgentBudgetStatus {
  exceeded: boolean;
  tokensExceeded: boolean;
  toolCallsExceeded: boolean;
  durationExceeded: boolean;
  warnings: string[];
}

export interface AgentHarnessContext {
  agent: AgentIdentity;
  budget: AgentBudget;
  depth: AgentDepth;
  startTime: number;
  toolCallsUsed: number;
  tokensUsed: number;
  context: AgentContextItem[];
  previousFindings: AgentPreviousFinding[];
  services: AgentPlatformServices;
  noteToolCalls: (count?: number) => void;
  noteTokens: (count: number) => void;
  getRemainingBudget: () => {
    tokens: number;
    toolCalls: number;
    durationMs: number;
  };
  assertWithinBudget: () => void;
}

export interface AgentExecutionResult {
  findings: Array<{
    goal: string;
    summary: string;
    confidence: number;
    sources: Array<{ url: string; title: string }>;
  }>;
  rawOutput: string;
  completeness?: string;
}

export interface AgentResult {
  agent: AgentIdentity;
  platformBlocks: CorePlatformBlock[];
  plan: string[];
  findings: AgentExecutionResult["findings"];
  reflection: AgentReflection;
  usage: AgentUsage;
  budget: AgentBudgetStatus;
}

export interface AgentHarnessOptions {
  agent: AgentIdentity;
  goal: string;
  context: AgentContextItem[];
  previousFindings?: AgentPreviousFinding[];
  budget: AgentBudget;
  depth: AgentDepth;
  services?: AgentPlatformServices;
  execute: (ctx: AgentHarnessContext) => Promise<AgentExecutionResult>;
}

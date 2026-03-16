import type { Database, RunResult } from "better-sqlite3";

export type LogLevel = "silent" | "error" | "warn" | "info" | "debug";

export interface LogFileOptions {
  dir: string;
  level?: LogLevel;
  maxBytes?: number;
}

export interface Logger {
  error(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  debug(msg: string, data?: Record<string, unknown>): void;
}

export const LLM_TRAFFIC_LANES = ["interactive", "deferred", "background"] as const;
export type LlmTrafficLane = typeof LLM_TRAFFIC_LANES[number];

export interface LlmTrafficConfig {
  maxConcurrent?: number;
  startGapMs?: number;
  startupDelayMs?: number;
  swarmAgentConcurrency?: number;
  reservedInteractiveSlots?: number;
}

export const TELEMETRY_SPAN_TYPES = ["http", "worker", "llm", "tool", "embed"] as const;
export type TelemetrySpanType = typeof TELEMETRY_SPAN_TYPES[number];

export const TELEMETRY_SURFACES = ["web", "telegram", "worker", "cli", "mcp"] as const;
export type TelemetrySurface = typeof TELEMETRY_SURFACES[number];

export const TELEMETRY_STATUSES = ["ok", "error", "cancelled"] as const;
export type TelemetryStatus = typeof TELEMETRY_STATUSES[number];

export const TELEMETRY_PROCESSES = [
  "chat.main",
  "chat.subagent",
  "thread.title",
  "memory.extract",
  "memory.contradiction",
  "memory.relationship",
  "memory.summarize",
  "briefing.generate",
  "learning.extract",
  "research.run",
  "swarm.plan",
  "swarm.agent",
  "swarm.synthesize",
  "telegram.chat",
  "telegram.passive",
  "embed.memory",
  "embed.knowledge",
  "http.request",
  "worker.briefing",
  "worker.learning",
  "worker.schedule",
  "worker.cleanup",
] as const;
export type TelemetryProcess = typeof TELEMETRY_PROCESSES[number];

export interface TelemetryAttributes {
  traceId?: string;
  parentSpanId?: string;
  surface?: TelemetrySurface;
  process: TelemetryProcess | string;
  provider?: string;
  model?: string;
  threadId?: string | null;
  jobId?: string | null;
  runId?: string | null;
  agentName?: string | null;
  toolName?: string | null;
  route?: string | null;
  chatId?: string | number | null;
  senderUsername?: string | null;
  senderDisplayName?: string | null;
  requestSizeChars?: number | null;
  metadata?: Record<string, unknown>;
}

export interface FeatureFlags {
  libraryDomain?: boolean;
  watchesDomain?: boolean;
  digestsDomain?: boolean;
  homeDashboard?: boolean;
}

export interface Config {
  dataDir: string;
  logLevel: LogLevel;
  llm: {
    provider: "ollama" | "openai" | "anthropic" | "google" | "cerebras" | "openrouter";
    model: string;
    baseUrl: string;
    apiKey?: string;
    embedModel?: string;
    embedProvider?: "auto" | "ollama" | "openai" | "google" | "local";
    /** @deprecated Not used — embedding fallback handled by embedProvider: "auto" */
    fallbackMode?: "local-first" | "strict";
    /** Override context window size in tokens. Useful for Ollama models where the catalog can't detect it. */
    contextWindow?: number;
  };
  plugins: string[];
  /** IANA timezone (e.g. "America/Los_Angeles"). Defaults to server timezone if unset. */
  timezone?: string;
  webSearchEnabled?: boolean;
  workers?: {
    backgroundLearning?: boolean;  // default true
    briefing?: boolean;            // default true
    knowledgeCleanup?: boolean;    // default true
    llmTraffic?: LlmTrafficConfig;
  };
  knowledge?: {
    defaultTtlDays?: number | null;  // null = no default expiry; config default 90
    freshnessDecayDays?: number;     // default 365
  };
  telegram?: {
    token?: string;
    enabled?: boolean;
    ownerUsername?: string;
    passiveListening?: boolean;
    reactionCooldownMin?: number;
    proactiveCooldownMin?: number;
  };
  /** Show debug info (render spec, raw data) on research results */
  debugResearch?: boolean;
  /** Sandbox code execution URL (e.g. http://localhost:8888). Auto-detected in Docker/Railway if unset. */
  sandboxUrl?: string;
  /** SearXNG web search URL (e.g. http://localhost:8080). Auto-detected in Docker/Railway if unset. */
  searchUrl?: string;
  /** Pinchtab browser automation URL (e.g. http://localhost:9867). Auto-detected in Docker/Railway if unset. */
  browserUrl?: string;
  /** RSSHub URL for structured feed fetching (default: https://rsshub.app). Self-host or use public instance. */
  rsshubUrl?: string;
  /** Feature flags for phased domain rollout */
  features?: FeatureFlags;
}

export interface Migration {
  version: number;
  up: string; // SQL statement
}

export type BackgroundJobSourceKind = "manual" | "schedule" | "maintenance";
export type BackgroundWaitingReason =
  | "startup_delay"
  | "interactive_ahead"
  | "manual_job_ahead"
  | "scheduled_job_ahead"
  | "maintenance_job_ahead"
  | "llm_busy";

export interface Storage {
  db: Database;
  /** Absolute path to the SQLite database file */
  dbPath: string;
  migrate(pluginName: string, migrations: Migration[]): void;
  query<T>(sql: string, params?: unknown[]): T[];
  run(sql: string, params?: unknown[]): RunResult;
  close(): void;
}

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface ChatResult {
  text: string;
  usage: TokenUsage;
}

export interface EmbedResult {
  embedding: number[];
}

export interface LLMClient {
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult>;
  streamChat(messages: ChatMessage[], options?: ChatOptions): AsyncGenerator<StreamEvent>;
  embed(text: string, options?: EmbedOptions): Promise<EmbedResult>;
  health(): Promise<{ ok: boolean; provider: string }>;
  /** Get the underlying AI SDK LanguageModel for direct streamText usage */
  getModel(): unknown;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  tools?: Record<string, unknown>;
  toolChoice?: "auto" | "required" | "none";
  maxSteps?: number;
  telemetry?: TelemetryAttributes;
}

export interface EmbedOptions {
  telemetry?: TelemetryAttributes;
}

export type StreamEvent =
  | { type: "text-delta"; content: string }
  | { type: "tool-call"; toolName: string; args: Record<string, unknown> }
  | { type: "tool-result"; toolName: string; result: unknown }
  | { type: "done"; text: string; usage: TokenUsage }
  | { type: "error"; error: string };

export interface PluginContext {
  config: Config;
  storage: Storage;
  llm: LLMClient;
  logger: Logger;
  json?: boolean;
  exitCode?: number;
  contextProvider?: (query: string) => Promise<string>;
  backgroundJobs?: {
    enqueueResearch?: (args: { goal: string; threadId: string | null; resultType?: string; sourceKind?: BackgroundJobSourceKind; sourceScheduleId?: string | null; budgetMaxSearches?: number; budgetMaxPages?: number }) => Promise<string> | string;
    enqueueSwarm?: (args: { goal: string; threadId: string | null; resultType?: string; sourceKind?: BackgroundJobSourceKind; sourceScheduleId?: string | null }) => Promise<string> | string;
    enqueueBriefing?: (args?: { sourceKind?: BackgroundJobSourceKind; reason?: string }) => Promise<string> | string;
  };
}

export interface Command {
  name: string;
  description: string;
  args?: Array<{ name: string; description: string; required?: boolean }>;
  options?: Array<{ flags: string; description: string; defaultValue?: string }>;
  action: (args: Record<string, string>, opts: Record<string, string>) => Promise<void>;
}

export interface Plugin {
  name: string;
  version: string;
  migrations: Migration[];
  commands(ctx: PluginContext): Command[];
}

// Agent plugin — conversational agent that shares memory
export interface AgentPlugin extends Plugin {
  agent: {
    displayName: string;           // "Personal Assistant"
    description: string;           // Shown in UI agent picker
    systemPrompt: string;          // Agent's personality/instructions
    capabilities?: string[];       // ["tasks", "memory", "general"]

    // Return tools available to this agent (AI SDK ToolSet)
    createTools?(ctx: AgentContext): Record<string, unknown>;

    // Called before each response — inject relevant memory context (legacy, prefer createTools)
    beforeResponse?(ctx: AgentContext): Promise<string>;

    // Called after each exchange — extract learnings
    afterResponse?(ctx: AgentContext, response: string): Promise<void>;
  };
}

export interface AgentContext extends PluginContext {
  userMessage: string;
  conversationHistory: ChatMessage[];
  /** Identity of the person sending the message (for multi-user awareness) */
  sender?: { displayName?: string; username?: string };
}

// BackgroundJob type and DB-backed CRUD are in ./background-jobs.ts

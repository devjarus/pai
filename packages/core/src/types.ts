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

export interface Config {
  dataDir: string;
  logLevel: LogLevel;
  llm: {
    provider: "ollama" | "openai" | "anthropic" | "google";
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
}

export interface Migration {
  version: number;
  up: string; // SQL statement
}

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
  embed(text: string): Promise<EmbedResult>;
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

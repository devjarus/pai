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
    provider: "ollama" | "openai";
    model: string;
    baseUrl: string;
    apiKey?: string;
    embedModel?: string;
    fallbackMode: "local-first" | "strict";
  };
  plugins: string[];
}

export interface Migration {
  version: number;
  up: string; // SQL statement
}

export interface Storage {
  db: Database;
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
  embed(text: string): Promise<EmbedResult>;
  health(): Promise<{ ok: boolean; provider: string }>;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
}

export interface PluginContext {
  config: Config;
  storage: Storage;
  llm: LLMClient;
  logger: Logger;
  json?: boolean;
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

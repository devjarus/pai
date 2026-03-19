import type { BackgroundJobSourceKind, Storage, LLMClient, Logger, ResearchResultType } from "@personal-ai/core";

export const RESEARCH_LLM_TIMEOUT = {
  totalMs: 10 * 60_000,
  stepMs: 90_000,
} as const;

export interface ResearchJob {
  id: string;
  threadId: string | null;
  goal: string;
  status: "pending" | "running" | "done" | "failed";
  resultType: ResearchResultType;
  budgetMaxSearches: number;
  budgetMaxPages: number;
  searchesUsed: number;
  pagesLearned: number;
  stepsLog: string[];
  report: string | null;
  briefingId: string | null;
  createdAt: string;
  queuedAt: string;
  startedAt: string | null;
  attemptCount: number;
  lastAttemptAt: string | null;
  sourceKind: BackgroundJobSourceKind;
  sourceScheduleId: string | null;
  completedAt: string | null;
}

export interface ResearchJobRow {
  id: string;
  thread_id: string | null;
  goal: string;
  status: string;
  result_type: string | null;
  budget_max_searches: number;
  budget_max_pages: number;
  searches_used: number;
  pages_learned: number;
  steps_log: string;
  report: string | null;
  briefing_id: string | null;
  created_at: string;
  queued_at: string | null;
  started_at: string | null;
  attempt_count: number | null;
  last_attempt_at: string | null;
  source_kind: string | null;
  source_schedule_id: string | null;
  completed_at: string | null;
}

export interface ResearchContext {
  storage: Storage;
  llm: LLMClient;
  logger: Logger;
  /** IANA timezone for date formatting (e.g. "America/Los_Angeles") */
  timezone?: string;
  /** LLM provider name for context budget (e.g. "ollama", "openai") */
  provider?: string;
  /** LLM model name for context budget */
  model?: string;
  /** Optional context window override in tokens */
  contextWindow?: number;
  /** Sandbox URL from config (passed through to resolveSandboxUrl) */
  sandboxUrl?: string;
  /** Browser automation URL from config (passed through to resolveBrowserUrl) */
  browserUrl?: string;
  /** Data directory for artifact file storage */
  dataDir?: string;
  /** Web search function — injected to avoid circular dependency */
  webSearch: (query: string, maxResults?: number) => Promise<Array<{ title: string; url: string; snippet: string }>>;
  /** Format search results for display */
  formatSearchResults: (results: Array<{ title: string; url: string; snippet: string }>) => string;
  /** Fetch a web page as markdown — injected to avoid circular dependency */
  fetchPage: (url: string) => Promise<{ title: string; markdown: string; url: string } | null>;
}

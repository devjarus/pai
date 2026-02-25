export type BeliefType =
  | "factual"
  | "preference"
  | "procedural"
  | "architectural"
  | "insight"
  | "meta";

export type BeliefStatus = "active" | "forgotten" | "invalidated";

export interface Belief {
  id: string;
  statement: string;
  confidence: number;
  type: BeliefType;
  status: BeliefStatus;
  importance: number;
  stability: number;
  access_count: number;
  created_at: string;
  updated_at: string;
  last_accessed?: string;
  superseded_by?: string | null;
  supersedes?: string | null;
}

export interface MemoryStats {
  beliefs: {
    total: number;
    active: number;
    invalidated: number;
    forgotten: number;
  };
  episodes: number;
  avgConfidence: number;
  oldestBelief?: string;
  newestBelief?: string;
}

export interface Agent {
  name: string;
  displayName?: string;
  description?: string;
}

export interface KnowledgeSource {
  id: string;
  title: string;
  url: string;
  chunks: number;
  learnedAt: string;
  tags: string | null;
}

export interface KnowledgeSearchResult {
  content: string;
  source: string;
  url: string;
  sourceId: string;
  relevance: number;
}

export interface CrawlJob {
  url: string;
  status: "running" | "done" | "error";
  total: number;
  learned: number;
  skipped: number;
  failed: number;
  failedUrls: string[];
  startedAt: string;
  error?: string;
}

export interface ChatHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ConfigInfo {
  dataDir: string;
  logLevel: string;
  plugins: string[];
  llm: {
    provider: string;
    model: string;
    baseUrl?: string;
    embedModel?: string;
    embedProvider?: string;
    fallbackMode?: string;
  };
  telegram?: {
    enabled?: boolean;
    hasToken?: boolean;
    running?: boolean;
    username?: string;
    error?: string;
  };
  envOverrides?: string[];
}

export interface TimelineEvent {
  id: string;
  beliefId: string;
  action: "created" | "reinforced" | "contradicted" | "weakened" | "forgotten" | "invalidated";
  statement: string;
  confidence: number;
  timestamp: string;
}

export interface Thread {
  id: string;
  title: string;
  agentName?: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface ThreadMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  sequence: number;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  goal_id: string | null;
  due_date: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface Goal {
  id: string;
  title: string;
  description: string | null;
  status: string;
  created_at: string;
}

export interface AuthStatus {
  setup: boolean;
  authenticated: boolean;
}

export interface AuthOwner {
  id: string;
  email: string;
  name: string | null;
}

export interface LoginResponse {
  ok: boolean;
  owner: AuthOwner;
  accessToken: string;
}

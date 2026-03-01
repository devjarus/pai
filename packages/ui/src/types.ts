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
  subject?: string;
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
  timezone?: string;
  llm: {
    provider: string;
    model: string;
    baseUrl?: string;
    embedModel?: string;
    embedProvider?: string;
    hasApiKey?: boolean;
    fallbackMode?: string;
  };
  telegram?: {
    enabled?: boolean;
    hasToken?: boolean;
    running?: boolean;
    username?: string;
    error?: string;
  };
  workers?: {
    backgroundLearning?: boolean;
    briefing?: boolean;
    lastRun?: Record<string, string | null>;
  };
  debugResearch?: boolean;
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
}

export interface BriefingSection {
  greeting: string;
  taskFocus: {
    summary: string;
    items: Array<{ id: string; title: string; priority: string; insight: string }>;
  };
  memoryInsights: {
    summary: string;
    highlights: Array<{ statement: string; type: string; detail: string }>;
  };
  suggestions: Array<{
    title: string;
    reason: string;
    action?: string;
    actionTarget?: string;
  }>;
}

export interface Briefing {
  id: string;
  generatedAt: string;
  sections: BriefingSection;
  status: string;
  type?: "daily" | "research";
}

export interface ResearchBriefing {
  id: string;
  generatedAt: string;
  sections: { report: string; goal: string; resultType?: string; structuredResult?: string; renderSpec?: string };
  status: string;
  type: "research";
}

// ---- Research Result Types ----

export type ResearchResultType = "flight" | "stock" | "general";

export interface FlightQuery {
  origin: string;
  destination: string;
  departDate: string;
  returnDate?: string;
  passengers: number;
  maxPrice?: number;
  nonstopOnly?: boolean;
  cabinClass?: string;
}

export interface FlightOption {
  airline: string;
  flightNo: string;
  departure: string;
  arrival: string;
  duration: string;
  stops: number;
  price: number;
  currency: string;
  returnDeparture?: string;
  returnArrival?: string;
  returnDuration?: string;
  returnStops?: number;
  baggage?: string;
  refundable?: boolean;
  bookingUrl?: string;
  score: number;
  scoreReason: string;
}

export interface FlightReport {
  query: FlightQuery;
  options: FlightOption[];
  searchedAt: string;
  sources: string[];
  disclaimer: string;
}

export interface StockMetrics {
  ticker: string;
  company: string;
  price: number;
  currency: string;
  pe?: number;
  marketCap?: string;
  high52w?: number;
  low52w?: number;
  ytdReturn?: string;
  revGrowth?: string;
  epsActual?: number;
  epsBeat?: string;
}

export interface StockReport {
  ticker: string;
  company: string;
  thesis: string;
  confidence: number;
  verdict: "strong_buy" | "buy" | "hold" | "sell" | "strong_sell";
  metrics: StockMetrics;
  risks: string[];
  catalysts: string[];
  sources: Array<{ title: string; url: string }>;
  charts: Array<{ id: string; type: string; title: string; data?: string; artifactId?: string }>;
  analyzedAt: string;
}

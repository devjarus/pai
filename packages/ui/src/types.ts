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
  maxAgeDays: number | null;
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
    knowledgeCleanup?: boolean;
    llmTraffic?: {
      maxConcurrent?: number;
      startGapMs?: number;
      startupDelayMs?: number;
      swarmAgentConcurrency?: number;
      reservedInteractiveSlots?: number;
    };
    lastRun?: Record<string, string | null>;
  };
  knowledge?: {
    defaultTtlDays?: number | null;
    freshnessDecayDays?: number;
  };
  debugResearch?: boolean;
  sandboxUrl?: string;
  searchUrl?: string;
  browserUrl?: string;
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
  lastMessage?: string;
  parentId?: string | null;
  forkMessageId?: string | null;
  depth?: number;
  childCount?: number;
}

export interface ThreadMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  sequence: number;
}

export type ObservabilityRange = "24h" | "7d" | "30d";

export interface TelemetrySummary {
  calls: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  avgDurationMs: number;
  p95DurationMs: number;
}

export interface ProcessAggregate extends TelemetrySummary {
  process: string;
  avgStepCount: number;
  avgQueueWaitMs: number;
  p95QueueWaitMs: number;
}

export interface ModelAggregate extends TelemetrySummary {
  provider: string | null;
  model: string | null;
}

export interface QueueProcessAggregate {
  process: string;
  calls: number;
  avgQueueWaitMs: number;
  p95QueueWaitMs: number;
}

export interface QueueLaneSnapshot {
  active: number;
  queued: number;
}

export interface LiveQueueSnapshot {
  activeRequests: number;
  queuedRequests: number;
  lanes: Record<"interactive" | "deferred" | "background", QueueLaneSnapshot>;
  startupDelayUntil: string | null;
  backgroundActiveWorkId: string | null;
  backgroundActiveKind: string | null;
  pendingBackgroundJobs: number;
}

export interface ObservabilityOverview {
  range: ObservabilityRange;
  since: string;
  totals: TelemetrySummary;
  topProcesses: ProcessAggregate[];
  topModels: ModelAggregate[];
  queue: {
    avgWaitMs: number;
    p95WaitMs: number;
    byProcess: QueueProcessAggregate[];
  };
  live?: LiveQueueSnapshot;
}

export interface ThreadMessageUsage {
  traceId: string;
  process: string;
  provider?: string | null;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  durationMs?: number | null;
  stepCount?: number | null;
  toolCallCount?: number | null;
}

export interface ThreadDiagnosticsMessage {
  id: string;
  role: string;
  content: string;
  createdAt: string;
  sequence: number;
  usage: ThreadMessageUsage | null;
}

export interface ThreadDiagnostics {
  threadId: string;
  totals: TelemetrySummary;
  processBreakdown: ProcessAggregate[];
  messages: ThreadDiagnosticsMessage[];
}

export interface AgentAggregate extends TelemetrySummary {
  agentName: string;
}

export interface TelemetrySpan {
  id: string;
  traceId: string;
  parentSpanId: string | null;
  spanType: string;
  surface: string | null;
  process: string;
  status: string;
  provider: string | null;
  model: string | null;
  threadId: string | null;
  jobId: string | null;
  runId: string | null;
  agentName: string | null;
  toolName: string | null;
  route: string | null;
  chatId: string | null;
  senderUsername: string | null;
  senderDisplayName: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  stepCount: number | null;
  durationMs: number | null;
  requestSizeChars: number | null;
  responseSizeChars: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  metadata: Record<string, unknown> | null;
  startedAt: string;
  endedAt: string;
}

export interface JobDiagnostics {
  jobId: string;
  totals: TelemetrySummary;
  processBreakdown: ProcessAggregate[];
  agentBreakdown: AgentAggregate[];
  recentSpans: TelemetrySpan[];
}

export interface RecentError {
  id: string;
  traceId: string;
  process: string;
  surface: string | null;
  route: string | null;
  threadId: string | null;
  jobId: string | null;
  model: string | null;
  provider: string | null;
  durationMs: number | null;
  errorMessage: string | null;
  startedAt: string;
}

export type TaskSourceType = "briefing" | "program";

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
  source_type: TaskSourceType | null;
  source_id: string | null;
  source_label: string | null;
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

export interface BriefingRawContextBelief {
  id: string;
  statement: string;
  type: BeliefType;
  confidence: number;
  updatedAt: string;
  accessCount: number;
  isNew: boolean;
  subject?: string;
}

export interface BriefingRawContext {
  beliefs?: BriefingRawContextBelief[];
}

export interface Briefing {
  id: string;
  generatedAt: string;
  sections: BriefingSection | Record<string, unknown>;
  status: string;
  type?: "daily" | "research";
  rawContext?: BriefingRawContext | null;
}

export interface ResearchBriefing {
  id: string;
  generatedAt: string;
  sections: {
    report: string;
    goal: string;
    resultType?: string;
    structuredResult?: string;
    renderSpec?: string;
    execution?: ReportExecution;
    visuals?: ReportVisual[];
  };
  status: string;
  type: "research";
}

export type ReportExecution = "research" | "analysis";

export interface ReportVisual {
  artifactId: string;
  mimeType: string;
  kind: "chart" | "image";
  title: string;
  caption?: string;
  order: number;
}

export interface ArtifactReference {
  id: string;
  name: string;
  mimeType: string;
  size?: number;
}

export interface ReportPresentation {
  report: string;
  structuredResult?: string;
  renderSpec?: string;
  visuals: ReportVisual[];
  resultType: ResearchResultType;
  execution: ReportExecution;
}

// ---- Research Result Types ----

/**
 * Research result type is an open string — the LLM decides the domain.
 * Known types get specialized icons; anything else gets a generic fallback.
 */
export type ResearchResultType = string;

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

// ---- Swarm Agent + Artifact Types ----

export interface SwarmAgent {
  id: string;
  swarmId: string;
  role: string;
  task: string;
  tools: string[];
  status: "pending" | "running" | "done" | "failed";
  result: string | null;
  error: string | null;
  stepsUsed: number;
  createdAt: string;
  completedAt: string | null;
}

export interface ArtifactMeta {
  id: string;
  jobId: string;
  name: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

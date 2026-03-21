import type {
  Belief,
  MemoryStats,
  Agent,
  ChatHistoryMessage,
  ConfigInfo,
  Thread,
  ThreadMessage,
  KnowledgeSource,
  KnowledgeSearchResult,
  CrawlJob,
  Task,
  Goal,
  AuthStatus,
  AuthOwner,
  LoginResponse,
  Briefing,
  ResearchResultType,
  SwarmAgent,
  ArtifactMeta,
  ReportPresentation,
  ReportExecution,
  ObservabilityOverview,
  ObservabilityRange,
  ProcessAggregate,
  ThreadDiagnostics,
  JobDiagnostics,
  RecentError,
  TelemetrySpan,
  BriefProvenance,
  LibrarySearchResult,
  LibraryStats,
  ResearchFinding,
} from "./types";

const BASE = "/api";

/**
 * Translates raw API/network errors into human-readable messages.
 * Matches against known error patterns and HTTP status codes.
 */
function humanizeError(status: number, body: string): string {
  // Try to extract a structured error message from JSON responses
  try {
    const json = JSON.parse(body);
    if (json.error && typeof json.error === "string") return json.error;
  } catch { /* not JSON, fall through */ }

  // Check for known error strings in the response body
  if (body.includes("SQLITE_CANTOPEN")) {
    return "Couldn't load your data. Check the data directory in Settings.";
  }
  if (body.includes("SQLITE_BUSY") || body.includes("SQLITE_LOCKED")) {
    return "Database is busy. Please try again in a moment.";
  }
  if (body.includes("ECONNREFUSED")) {
    return "Server is not running. Start it with: pnpm start";
  }
  if (body.includes("ENOTFOUND") || body.includes("EAI_AGAIN")) {
    return "Could not reach the external service. Check your network connection.";
  }

  // HTTP status code mapping
  switch (status) {
    case 401:
      return "Session expired. Please refresh the page or log in again.";
    case 403:
      return "Access denied.";
    case 404:
      return "The requested resource was not found.";
    case 408:
    case 504:
      return "Request timed out. The server may be overloaded.";
    case 429:
      return "Too many requests. Please wait a moment and try again.";
    case 500:
    case 502:
    case 503:
      return "Server error. Please try again or check the server logs.";
    default:
      // Return a cleaned-up version of the raw error
      return body.length > 200 ? `Server error (${status})` : `Error: ${body}`;
  }
}

let isRefreshing: Promise<boolean> | null = null;

async function doRefresh(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      credentials: "include",
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function rawFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = { ...init?.headers as Record<string, string> };
  if (init?.body) {
    headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
  }
  try {
    return await fetch(`${BASE}${path}`, { ...init, headers, credentials: "include" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("Failed to fetch") || message.includes("NetworkError") || message.includes("ECONNREFUSED")) {
      throw new Error("Unable to reach the server. Is it running?");
    }
    if (message.includes("AbortError") || message.includes("aborted")) {
      throw new Error("Request was cancelled.");
    }
    throw new Error("Unable to reach the server.");
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res = await rawFetch(path, init);

  // On 401, try refreshing the access token once and retry
  if (res.status === 401 && !path.startsWith("/auth/")) {
    // Coalesce concurrent refresh attempts into one
    if (!isRefreshing) {
      isRefreshing = doRefresh().finally(() => { isRefreshing = null; });
    }
    const refreshed = await isRefreshing;
    if (refreshed) {
      res = await rawFetch(path, init);
    }
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(humanizeError(res.status, body));
  }
  return res.json() as Promise<T>;
}

// ---- Auth ----

export async function getAuthStatus(): Promise<AuthStatus> {
  try {
    const res = await fetch(`/api/auth/status`, {
      credentials: "include",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return { setup: false, authenticated: false };
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return { setup: false, authenticated: false };
    }
    return await res.json();
  } catch {
    return { setup: false, authenticated: false };
  }
}

export async function setupOwner(input: {
  email: string;
  password: string;
  name?: string;
}): Promise<LoginResponse> {
  return request<LoginResponse>("/auth/setup", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function login(email: string, password: string): Promise<LoginResponse> {
  return request<LoginResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function logout(): Promise<void> {
  await request("/auth/logout", { method: "POST", body: "{}" });
}

export async function refreshToken(): Promise<{ ok: boolean }> {
  return request("/auth/refresh", { method: "POST", body: "{}" });
}

export async function getMe(): Promise<{ owner: AuthOwner }> {
  return request<{ owner: AuthOwner }>("/auth/me");
}

// ---- Beliefs ----

export function getBeliefs(params?: {
  status?: string;
  type?: string;
}): Promise<Belief[]> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (params?.type) qs.set("type", params.type);
  const query = qs.toString();
  return request<Belief[]>(`/library/memories${query ? `?${query}` : ""}`);
}

export function searchMemory(q: string): Promise<Belief[]> {
  return request<Belief[]>(`/library/memories/search?q=${encodeURIComponent(q)}`);
}

export function getStats(): Promise<MemoryStats> {
  return request<MemoryStats>("/library/stats");
}

export function remember(text: string): Promise<{ ok: boolean }> {
  return request("/library/memories", {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export function forgetBelief(id: string): Promise<{ ok: boolean }> {
  return request(`/library/memories/${id}`, { method: "DELETE" });
}

export function updateBelief(id: string, statement: string): Promise<Belief> {
  return request<Belief>(`/library/memories/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ statement }),
  });
}

export function correctBelief(id: string, input: { statement: string; note?: string; briefId?: string; programId?: string; threadId?: string; channel?: string }): Promise<{
  invalidatedBelief: Belief;
  replacementBelief: Belief;
}> {
  return request(`/library/memories/${id}/correct`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getBriefProvenance(briefId: string): Promise<BriefProvenance> {
  return request(`/inbox/${briefId}/provenance`);
}

export function recordProductEventApi(input: {
  eventType: "program_created" | "brief_opened" | "brief_followup_asked" | "brief_action_created" | "brief_action_completed" | "belief_corrected" | "recommendation_accepted" | "telegram_brief_interaction";
  channel?: string;
  programId?: string | null;
  briefId?: string | null;
  beliefId?: string | null;
  actionId?: string | null;
  threadId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<{ ok: boolean }> {
  return request("/product-events", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function clearAllMemory(): Promise<{ ok: boolean; cleared: number }> {
  return request("/library/memories/clear", { method: "POST", body: "{}" });
}

// ---- Agents ----

export function getAgents(): Promise<Agent[]> {
  return request<Agent[]>("/agents");
}

// ---- Chat ----

export function getChatHistory(sessionId?: string): Promise<ChatHistoryMessage[]> {
  const qs = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
  return request<ChatHistoryMessage[]>(`/chat/history${qs}`);
}

export function clearChatHistory(sessionId?: string): Promise<{ ok: boolean }> {
  const qs = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
  return request(`/chat/history${qs}`, { method: "DELETE" });
}

// ---- Threads ----

export function getThreads(): Promise<Thread[]> {
  return request<Thread[]>("/threads");
}

export function createThread(title?: string, agentName?: string, parentId?: string, forkMessageId?: string, forkSequence?: number): Promise<Thread> {
  return request<Thread>("/threads", {
    method: "POST",
    body: JSON.stringify({ title, agentName, parentId, forkMessageId, forkSequence }),
  });
}

export function deleteThread(id: string): Promise<{ ok: boolean }> {
  return request(`/threads/${id}`, { method: "DELETE" });
}

export function clearAllThreads(): Promise<{ ok: boolean; cleared: number }> {
  return request("/threads/clear", { method: "POST", body: "{}" });
}

export function renameThread(id: string, title: string): Promise<Thread> {
  return request<Thread>(`/threads/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });
}

export function getThreadMessages(id: string, params?: { limit?: number; before?: string }): Promise<ThreadMessage[]> {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.before) qs.set("before", params.before);
  const query = qs.toString();
  return request<ThreadMessage[]>(`/threads/${id}/messages${query ? `?${query}` : ""}`);
}

// ---- Observability ----

export function getObservabilityOverview(range: ObservabilityRange): Promise<ObservabilityOverview> {
  return request<ObservabilityOverview>(`/observability/overview?range=${encodeURIComponent(range)}`);
}

export function getObservabilityProcesses(range: ObservabilityRange): Promise<{ range: ObservabilityRange; processes: ProcessAggregate[] }> {
  return request<{ range: ObservabilityRange; processes: ProcessAggregate[] }>(`/observability/processes?range=${encodeURIComponent(range)}`);
}

export function getObservabilityThread(threadId: string): Promise<ThreadDiagnostics> {
  return request<ThreadDiagnostics>(`/observability/threads/${threadId}`);
}

export function getObservabilityJob(jobId: string): Promise<JobDiagnostics> {
  return request<JobDiagnostics>(`/observability/jobs/${jobId}`);
}

export function getObservabilityTrace(traceId: string): Promise<{ traceId: string; spans: TelemetrySpan[] }> {
  return request<{ traceId: string; spans: TelemetrySpan[] }>(`/observability/traces/${traceId}`);
}

export function getObservabilityRecentErrors(range: ObservabilityRange): Promise<{ range: ObservabilityRange; errors: RecentError[] }> {
  return request<{ range: ObservabilityRange; errors: RecentError[] }>(`/observability/recent-errors?range=${encodeURIComponent(range)}`);
}

// ---- Knowledge ----

export function getKnowledgeSources(): Promise<KnowledgeSource[]> {
  return request<KnowledgeSource[]>("/library/documents");
}

export function searchKnowledge(q: string): Promise<KnowledgeSearchResult[]> {
  return request<KnowledgeSearchResult[]>(`/library/documents/search?q=${encodeURIComponent(q)}`);
}

export function learnFromUrl(url: string, options?: { crawl?: boolean; force?: boolean }): Promise<{ ok: boolean; title?: string; chunks?: number; skipped?: boolean; crawling?: boolean; subPages?: number }> {
  return request("/library/documents/url", {
    method: "POST",
    body: JSON.stringify({ url, ...options }),
  });
}


export function uploadKnowledgeDocument(input: { fileName: string; content: string; mimeType?: string; analyze?: boolean }): Promise<{ ok: boolean; title: string; sourceId: string; chunks: number; analysis?: string }> {
  return request("/library/documents/upload", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function crawlSubPages(sourceId: string): Promise<{ ok: boolean; subPages: number; crawling?: boolean; message?: string }> {
  return request(`/library/documents/${sourceId}/crawl`, {
    method: "POST",
    body: "{}",
  });
}

export function getCrawlStatus(): Promise<{ jobs: CrawlJob[] }> {
  return request<{ jobs: CrawlJob[] }>("/library/documents/crawl-status");
}

export function getSourceChunks(id: string): Promise<Array<{ id: string; content: string; chunkIndex: number }>> {
  return request<Array<{ id: string; content: string; chunkIndex: number }>>(`/library/documents/${id}/chunks`);
}

export function reindexKnowledge(): Promise<{ ok: boolean; reindexed: number }> {
  return request("/library/documents/reindex", { method: "POST", body: "{}" });
}

export function reindexKnowledgeSource(id: string): Promise<{ ok: boolean; chunks: number }> {
  return request(`/library/documents/${id}/reindex`, { method: "POST", body: "{}" });
}

export function deleteKnowledgeSource(id: string): Promise<{ ok: boolean }> {
  return request(`/library/documents/${id}`, { method: "DELETE" });
}

export function updateKnowledgeSource(id: string, data: { tags?: string | null; maxAgeDays?: number | null }): Promise<{ ok: boolean }> {
  return request(`/library/documents/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

// ---- Config ----

export function getConfig(): Promise<ConfigInfo> {
  return request<ConfigInfo>("/config");
}

export function testConfig(config: {
  provider: string;
  model: string;
  baseUrl: string;
  apiKey?: string;
  embedModel?: string;
}): Promise<{ ok: boolean; provider: string; error?: string }> {
  return request<{ ok: boolean; provider: string; error?: string }>("/config/test", {
    method: "POST",
    body: JSON.stringify(config),
  });
}

export function updateConfig(updates: {
  provider?: string;
  model?: string;
  baseUrl?: string;
  embedModel?: string;
  embedProvider?: string;
  apiKey?: string;
  dataDir?: string;
  backgroundLearning?: boolean;
  briefingEnabled?: boolean;
  telegramToken?: string;
  telegramEnabled?: boolean;
  knowledgeCleanup?: boolean;
  llmTrafficMaxConcurrent?: number;
  llmTrafficStartGapMs?: number;
  llmTrafficStartupDelayMs?: number;
  llmTrafficSwarmAgentConcurrency?: number;
  llmTrafficReservedInteractiveSlots?: number;
  knowledgeDefaultTtlDays?: number | null;
  knowledgeFreshnessDecayDays?: number;
  debugResearch?: boolean;
  sandboxUrl?: string;
  searchUrl?: string;
  browserUrl?: string;
  timezone?: string;
}): Promise<ConfigInfo> {
  return request<ConfigInfo>("/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
}

export interface BrowseResult {
  current: string;
  parent: string;
  entries: Array<{ name: string; path: string }>;
}

export function browseDir(path?: string): Promise<BrowseResult> {
  const params = path ? `?path=${encodeURIComponent(path)}` : "";
  return request<BrowseResult>(`/browse${params}`);
}

// ---- Tasks ----

export function getTasks(params?: { status?: string; goalId?: string; sourceType?: "briefing" | "program"; sourceId?: string }): Promise<Task[]> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (params?.goalId) qs.set("goalId", params.goalId);
  if (params?.sourceType) qs.set("sourceType", params.sourceType);
  if (params?.sourceId) qs.set("sourceId", params.sourceId);
  const query = qs.toString();
  return request<Task[]>(`/tasks${query ? `?${query}` : ""}`);
}

export function createTask(input: {
  title: string;
  description?: string;
  priority?: string;
  dueDate?: string;
  goalId?: string;
  sourceType?: "briefing" | "program";
  sourceId?: string;
  sourceLabel?: string;
}): Promise<Task> {
  return request<Task>("/tasks", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateTask(
  id: string,
  updates: { title?: string; priority?: string; dueDate?: string; description?: string; goalId?: string | null },
): Promise<{ ok: boolean }> {
  return request(`/tasks/${id}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
}

export function completeTask(id: string): Promise<{ ok: boolean }> {
  return request(`/tasks/${id}/done`, { method: "POST", body: "{}" });
}

export function reopenTask(id: string): Promise<{ ok: boolean }> {
  return request(`/tasks/${id}/reopen`, { method: "POST", body: "{}" });
}

export function deleteTask(id: string): Promise<{ ok: boolean }> {
  return request(`/tasks/${id}`, { method: "DELETE" });
}

export function clearAllTasks(): Promise<{ ok: boolean; cleared: number }> {
  return request("/tasks/clear", { method: "POST", body: "{}" });
}

// ---- Goals ----

export function getGoals(status?: "active" | "done" | "all"): Promise<Goal[]> {
  const qs = new URLSearchParams();
  if (status) qs.set("status", status);
  const query = qs.toString();
  return request<Goal[]>(`/goals${query ? `?${query}` : ""}`);
}

export function createGoal(input: { title: string; description?: string }): Promise<Goal> {
  return request<Goal>("/goals", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function completeGoal(id: string): Promise<{ ok: boolean }> {
  return request(`/goals/${id}/done`, { method: "POST", body: "{}" });
}

export function deleteGoal(id: string): Promise<{ ok: boolean }> {
  return request(`/goals/${id}`, { method: "DELETE" });
}

// ---- Inbox ----

export function refreshInbox(): Promise<{ ok: boolean; briefingId?: string; message?: string }> {
  return request("/inbox/refresh", { method: "POST", body: "{}" });
}

export function getInboxBriefing(id: string): Promise<{ briefing: Briefing }> {
  return request<{ briefing: Briefing }>(`/inbox/${id}`);
}

export function getInboxAll(): Promise<{ briefings: Array<{ id: string; generatedAt: string; sections: Record<string, unknown>; status: string; type: string }>; generating: boolean; pending?: boolean }> {
  return request("/inbox/all");
}

export function clearInbox(): Promise<{ ok: boolean; cleared: number }> {
  return request("/inbox/clear", { method: "POST", body: "{}" });
}

export function getResearchBriefings(): Promise<{ briefings: Array<{ id: string; generatedAt: string; sections: { report: string; goal: string; resultType?: string; structuredResult?: string; renderSpec?: string }; status: string; type: "research" }> }> {
  return request("/inbox/research");
}

// ---- Jobs ----

export interface BackgroundJobInfo {
  id: string;
  type: "crawl" | "research" | "swarm";
  label: string;
  status: "pending" | "running" | "done" | "error" | "failed" | "planning" | "synthesizing";
  progress: string;
  startedAt: string;
  queuedAt?: string | null;
  completedAt?: string | null;
  attemptCount?: number;
  lastAttemptAt?: string | null;
  sourceKind?: "manual" | "schedule" | "maintenance";
  sourceScheduleId?: string | null;
  queuePosition?: number | null;
  waitingReason?: "startup_delay" | "interactive_ahead" | "manual_job_ahead" | "scheduled_job_ahead" | "maintenance_job_ahead" | "llm_busy" | null;
  error?: string | null;
  result?: string | null;
  resultType?: ResearchResultType | null;
}

export interface ResearchJobDetail {
  id: string;
  threadId: string | null;
  goal: string;
  status: string;
  budgetMaxSearches: number;
  budgetMaxPages: number;
  searchesUsed: number;
  pagesLearned: number;
  report: string | null;
  createdAt: string;
  queuedAt?: string | null;
  startedAt?: string | null;
  completedAt: string | null;
  attemptCount?: number;
  lastAttemptAt?: string | null;
  sourceKind?: "manual" | "schedule" | "maintenance";
  sourceScheduleId?: string | null;
  queuePosition?: number | null;
  waitingReason?: "startup_delay" | "interactive_ahead" | "manual_job_ahead" | "scheduled_job_ahead" | "maintenance_job_ahead" | "llm_busy" | null;
  resultType?: ResearchResultType;
  briefingId?: string | null;
  // Swarm-specific fields (present when job is a swarm)
  plan?: unknown[] | null;
  agentCount?: number;
  agentsDone?: number;
  synthesis?: string | null;
  resultType_swarm?: string;
}

export interface JobDetailResponse {
  job: ResearchJobDetail;
  presentation: ReportPresentation;
}

export interface BlackboardEntry {
  id: string;
  agentId: string;
  type: "finding" | "question" | "answer" | "artifact";
  content: string;
  createdAt: string;
}

export function getJobs(): Promise<{ jobs: BackgroundJobInfo[] }> {
  return request("/jobs");
}

export function getJobDetail(id: string): Promise<JobDetailResponse> {
  return request(`/jobs/${id}`);
}

export function getJobBlackboard(id: string): Promise<{ entries: BlackboardEntry[] }> {
  return request(`/jobs/${id}/blackboard`);
}

export function cancelJob(id: string): Promise<{ ok: boolean; cancelled: boolean }> {
  return request(`/jobs/${id}/cancel`, { method: "POST", body: "{}" });
}

export function clearJobs(): Promise<{ ok: boolean; cleared: number }> {
  return request("/jobs/clear", { method: "POST", body: "{}" });
}

export function getJobAgents(id: string): Promise<{ agents: SwarmAgent[] }> {
  return request(`/jobs/${id}/agents`);
}

export function getJobArtifacts(jobId: string): Promise<{ artifacts: ArtifactMeta[] }> {
  return request(`/jobs/${jobId}/artifacts`);
}

export function rerunResearch(briefingId: string): Promise<{ ok: boolean; jobId: string }> {
  return request(`/inbox/${briefingId}/rerun`, { method: "POST", body: "{}" });
}

// ---------------------------------------------------------------------------
// Learning Runs
// ---------------------------------------------------------------------------

export interface LearningRun {
  id: number;
  startedAt: string;
  completedAt: string | null;
  status: "running" | "done" | "skipped" | "error";
  skipReason: string | null;
  threadsCount: number;
  messagesCount: number;
  researchCount: number;
  tasksCount: number;
  knowledgeCount: number;
  factsExtracted: number;
  beliefsCreated: number;
  beliefsReinforced: number;
  lowImportanceSkipped: number;
  factsJson: string | null;
  durationMs: number | null;
  error: string | null;
}

export async function getLearningRuns(): Promise<{ runs: LearningRun[] }> {
  return request("/learning/runs");
}

// ---------------------------------------------------------------------------
// Programs
// ---------------------------------------------------------------------------

export interface Program {
  id: string;
  title: string;
  question: string;
  family: "general" | "work" | "travel" | "buying";
  executionMode: ReportExecution;
  intervalHours: number;
  chatId: number | null;
  threadId: string | null;
  lastRunAt: string | null;
  nextRunAt: string;
  status: string;
  createdAt: string;
  preferences: string[];
  constraints: string[];
  openQuestions: string[];
  objective?: string | null;
  phase?: "monitor" | "explore" | "decide" | "act" | "prepare";
  deliveryMode?: "interval" | "change-gated";
  sourceRefs?: string[];
  latestBriefId?: string | null;
  lastDeliveredAt?: string | null;
  lastEvaluatedAt?: string | null;
  lastSignalHash?: string | null;
  actionSummary?: {
    openCount: number;
    completedCount: number;
    staleOpenCount: number;
  };
  latestBriefSummary?: {
    id: string;
    generatedAt: string;
    type: string;
    recommendationSummary: string | null;
    sourceJobId: string | null;
    sourceJobKind: string | null;
  } | null;
}

export interface ProgramMutationResult {
  program: Program;
  created: boolean;
  duplicateReason: "thread" | "equivalent" | null;
}

export function getPrograms(): Promise<Program[]> {
  return request("/programs");
}

export function createProgramApi(data: {
  title: string;
  question: string;
  family?: "general" | "work" | "travel" | "buying";
  executionMode?: ReportExecution;
  intervalHours?: number;
  startAt?: string;
  chatId?: number | null;
  threadId?: string | null;
  preferences?: string[];
  constraints?: string[];
  openQuestions?: string[];
}): Promise<ProgramMutationResult> {
  return request("/programs", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateProgramApi(id: string, data: {
  title?: string;
  question?: string;
  family?: "general" | "work" | "travel" | "buying";
  executionMode?: ReportExecution;
  intervalHours?: number;
  startAt?: string;
  preferences?: string[];
  constraints?: string[];
  openQuestions?: string[];
}): Promise<Program> {
  return request(`/programs/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function deleteProgramApi(id: string): Promise<{ ok: boolean }> {
  return request(`/programs/${id}`, { method: "DELETE" });
}

export function pauseProgramApi(id: string): Promise<{ ok: boolean }> {
  return request(`/programs/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ action: "pause" }),
  });
}

export function resumeProgramApi(id: string): Promise<{ ok: boolean }> {
  return request(`/programs/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ action: "resume" }),
  });
}

// ---------------------------------------------------------------------------
// Schedules
// ---------------------------------------------------------------------------

export interface Schedule {
  id: string;
  label: string;
  type: ReportExecution;
  goal: string;
  intervalHours: number;
  chatId: number | null;
  threadId: string | null;
  lastRunAt: string | null;
  nextRunAt: string;
  status: string;
  createdAt: string;
}

export function getSchedules(): Promise<Schedule[]> {
  return request("/schedules");
}

export function createScheduleApi(data: {
  label: string;
  goal: string;
  type?: ReportExecution;
  intervalHours?: number;
  startAt?: string;
}): Promise<Schedule> {
  return request("/schedules", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function deleteScheduleApi(id: string): Promise<{ ok: boolean }> {
  return request(`/schedules/${id}`, { method: "DELETE" });
}

export function pauseScheduleApi(id: string): Promise<{ ok: boolean }> {
  return request(`/schedules/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ action: "pause" }),
  });
}

export function resumeScheduleApi(id: string): Promise<{ ok: boolean }> {
  return request(`/schedules/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ action: "resume" }),
  });
}

// ---- Watches ----

export interface WatchTemplate {
  id: string;
  name: string;
  description: string;
  category: "price" | "news" | "competitor" | "availability" | "general";
  defaultIntervalHours: number;
  defaultDeliveryMode: "always" | "change-gated";
  defaultDepthLevel: "quick" | "standard" | "deep";
}

export interface WatchHistoryBriefing {
  id: string;
  generatedAt: string;
  type: string;
  status: string;
  signalHash: string | null;
  sourceJobId: string | null;
  sourceJobKind: string | null;
  recommendationSummary: string | null;
}

export interface WatchHistoryJob {
  id: string;
  status: string;
  goal: string;
  createdAt: string;
  queuedAt: string | null;
  completedAt: string | null;
  briefingId: string | null;
  resultType: string | null;
}

export interface WatchHistoryAction {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface WatchHistory {
  watch: Program;
  history: {
    briefings: WatchHistoryBriefing[];
    actions: WatchHistoryAction[];
    researchJobs: WatchHistoryJob[];
    analysisJobs: WatchHistoryJob[];
  };
}

export function getWatches(): Promise<Program[]> {
  return request("/watches");
}

export function getWatchApi(id: string): Promise<Program> {
  return request(`/watches/${id}`);
}

export function getWatchHistoryApi(id: string): Promise<WatchHistory> {
  return request(`/watches/${id}/history`);
}

export function getWatchTemplates(): Promise<WatchTemplate[]> {
  return request("/watches/templates");
}

export function createWatchApi(data: {
  title: string;
  question: string;
  family?: "general" | "work" | "travel" | "buying";
  executionMode?: "research" | "analysis";
  intervalHours?: number;
  startAt?: string;
  chatId?: number | null;
  threadId?: string | null;
  preferences?: string[];
  constraints?: string[];
  openQuestions?: string[];
}): Promise<{ watch: Program; created: boolean; duplicateReason: "thread" | "equivalent" | null }> {
  return request("/watches", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function followTopic(topic: string): Promise<{
  watch: Program;
  created: boolean;
  duplicateReason: "thread" | "equivalent" | null;
}> {
  return request("/watches/follow", {
    method: "POST",
    body: JSON.stringify({ topic }),
  });
}

export function createWatchFromTemplateApi(data: {
  templateId: string;
  subject: string;
}): Promise<{
  watch: Program;
  created: boolean;
  duplicateReason: "thread" | "equivalent" | null;
  template: { id: string; depthLevel: string };
}> {
  return request("/watches/from-template", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateWatchApi(id: string, data: {
  title?: string;
  question?: string;
  family?: "general" | "work" | "travel" | "buying";
  executionMode?: "research" | "analysis";
  intervalHours?: number;
  startAt?: string;
  preferences?: string[];
  constraints?: string[];
  openQuestions?: string[];
}): Promise<Program> {
  return request(`/watches/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function deleteWatchApi(id: string): Promise<{ ok: boolean }> {
  return request(`/watches/${id}`, { method: "DELETE" });
}

export function pauseWatchApi(id: string): Promise<{ ok: boolean }> {
  return request(`/watches/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ action: "pause" }),
  });
}

export function resumeWatchApi(id: string): Promise<{ ok: boolean }> {
  return request(`/watches/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ action: "resume" }),
  });
}

export function triggerWatchRunApi(id: string): Promise<{ ok: boolean; jobId: string; depth: string }> {
  return request(`/watches/${id}/run`, {
    method: "POST",
    body: "{}",
  });
}

// ---- Library (unified) ----

export function librarySearch(q: string, limit = 20): Promise<LibrarySearchResult[]> {
  return request(`/library/search?q=${encodeURIComponent(q)}&limit=${limit}`);
}

export function getLibraryStats(): Promise<LibraryStats> {
  return request("/library/stats");
}

export interface ProfileSummary {
  summary: string;
  categories: Record<string, number>;
  totalBeliefs: number;
  coreBeliefs: number;
}

export function getProfile(): Promise<ProfileSummary> {
  return request<ProfileSummary>("/library/profile");
}

export interface QualityScore {
  score: number;
  memory: { total: number; neverAccessed: number; reinforced: number; utilization: number; reinforcementRate: number };
  feedback: { digestsRated: number; avgRating: number | null; corrections: number; activity: number };
  knowledge: { insights: number; findings: number; watchesActive: number; growth: number };
}

export function getQualityScore(): Promise<QualityScore> {
  return request<QualityScore>("/library/quality");
}

export function getFindings(watchId?: string): Promise<ResearchFinding[]> {
  const qs = watchId ? `?watchId=${encodeURIComponent(watchId)}` : "";
  return request(`/library/findings${qs}`);
}

export interface TopicInsight {
  id: string;
  watchId: string | null;
  topic: string;
  insight: string;
  confidence: number;
  cycleCount: number;
  sources: string[];
  createdAt: string;
  updatedAt: string;
}

export function getInsights(watchId?: string): Promise<TopicInsight[]> {
  const params = watchId ? `?watchId=${encodeURIComponent(watchId)}` : "";
  return request<TopicInsight[]>(`/library/insights${params}`);
}

// ---- Digests ----

export async function getDigests(): Promise<{ digests: Array<{ id: string; generatedAt: string; sections: Record<string, unknown>; status: string; type: string }> }> {
  const data = await request<{ briefings?: unknown[]; digests?: unknown[] }>("/digests");
  // Server returns { briefings: [...] } — normalize to { digests: [...] }
  return { digests: (data.briefings ?? data.digests ?? []) as Array<{ id: string; generatedAt: string; sections: Record<string, unknown>; status: string; type: string }> };
}

export function getDigest(id: string): Promise<{ digest: Record<string, unknown> }> {
  return request(`/digests/${id}`);
}

export function getDigestSources(id: string): Promise<{ sources: Array<{ id: string; type: string; statement: string; confidence: number }> }> {
  return request(`/digests/${id}/sources`);
}

export function refreshDigests(): Promise<{ ok: boolean; digestId?: string; message?: string }> {
  return request("/digests/refresh", { method: "POST", body: "{}" });
}

export function correctDigest(id: string, input: { beliefId: string; correctedStatement: string; note?: string }): Promise<{ ok: boolean }> {
  return request(`/digests/${id}/correct`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function rateDigest(id: string, input: { rating: number; feedback?: string }): Promise<{ ok: boolean }> {
  return request(`/digests/${id}/rate`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function rerunDigestResearch(id: string): Promise<{ ok: boolean; jobId: string }> {
  return request(`/digests/${id}/rerun`, { method: "POST", body: "{}" });
}

export function getDigestSuggestions(id: string): Promise<{ suggestions: Array<{ title: string; description?: string; priority?: string }> }> {
  return request(`/digests/${id}/suggestions`);
}

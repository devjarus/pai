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
} from "./types";

const BASE = "/api";

/**
 * Translates raw API/network errors into human-readable messages.
 * Matches against known error patterns and HTTP status codes.
 */
function humanizeError(status: number, body: string): string {
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
    case 403:
      return "Authentication failed. Check your API key in Settings.";
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { ...init?.headers as Record<string, string> };
  // Only set Content-Type for requests with a body to avoid Fastify empty JSON body errors
  if (init?.body) {
    headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
  }

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers,
      credentials: "include",
    });
  } catch (err) {
    // Network-level errors (server down, no connection, etc.)
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("Failed to fetch") || message.includes("NetworkError") || message.includes("ECONNREFUSED")) {
      throw new Error("Unable to reach the server. Is it running?");
    }
    if (message.includes("AbortError") || message.includes("aborted")) {
      throw new Error("Request was cancelled.");
    }
    throw new Error("Unable to reach the server.");
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(humanizeError(res.status, body));
  }
  return res.json() as Promise<T>;
}

// ---- Auth ----

export async function getAuthStatus(): Promise<AuthStatus> {
  const res = await fetch(`/api/auth/status`, {
    credentials: "include",
    signal: AbortSignal.timeout(5000),
  });
  return res.json();
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

export async function refreshToken(): Promise<{ ok: boolean; accessToken: string }> {
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
  return request<Belief[]>(`/beliefs${query ? `?${query}` : ""}`);
}

export function getBelief(id: string): Promise<Belief> {
  return request<Belief>(`/beliefs/${id}`);
}

export function searchMemory(q: string): Promise<Belief[]> {
  return request<Belief[]>(`/search?q=${encodeURIComponent(q)}`);
}

export function getStats(): Promise<MemoryStats> {
  return request<MemoryStats>("/stats");
}

export function remember(text: string): Promise<{ ok: boolean }> {
  return request("/remember", {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export function forgetBelief(id: string): Promise<{ ok: boolean }> {
  return request(`/forget/${id}`, { method: "POST", body: "{}" });
}

export function clearAllMemory(): Promise<{ ok: boolean; cleared: number }> {
  return request("/memory/clear", { method: "POST", body: "{}" });
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

export function createThread(title?: string, agentName?: string): Promise<Thread> {
  return request<Thread>("/threads", {
    method: "POST",
    body: JSON.stringify({ title, agentName }),
  });
}

export function deleteThread(id: string): Promise<{ ok: boolean }> {
  return request(`/threads/${id}`, { method: "DELETE" });
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

// ---- Knowledge ----

export function getKnowledgeSources(): Promise<KnowledgeSource[]> {
  return request<KnowledgeSource[]>("/knowledge/sources");
}

export function searchKnowledge(q: string): Promise<KnowledgeSearchResult[]> {
  return request<KnowledgeSearchResult[]>(`/knowledge/search?q=${encodeURIComponent(q)}`);
}

export function learnFromUrl(url: string, options?: { crawl?: boolean; force?: boolean }): Promise<{ ok: boolean; title?: string; chunks?: number; skipped?: boolean; crawling?: boolean; subPages?: number }> {
  return request("/knowledge/learn", {
    method: "POST",
    body: JSON.stringify({ url, ...options }),
  });
}

export function crawlSubPages(sourceId: string): Promise<{ ok: boolean; subPages: number; crawling?: boolean; message?: string }> {
  return request(`/knowledge/sources/${sourceId}/crawl`, {
    method: "POST",
    body: "{}",
  });
}

export function getCrawlStatus(): Promise<{ jobs: CrawlJob[] }> {
  return request<{ jobs: CrawlJob[] }>("/knowledge/crawl-status");
}

export function getSourceChunks(id: string): Promise<Array<{ id: string; content: string; chunkIndex: number }>> {
  return request<Array<{ id: string; content: string; chunkIndex: number }>>(`/knowledge/sources/${id}/chunks`);
}

export function reindexKnowledge(): Promise<{ ok: boolean; reindexed: number }> {
  return request("/knowledge/reindex", { method: "POST", body: "{}" });
}

export function reindexKnowledgeSource(id: string): Promise<{ ok: boolean; chunks: number }> {
  return request(`/knowledge/sources/${id}/reindex`, { method: "POST", body: "{}" });
}

export function deleteKnowledgeSource(id: string): Promise<{ ok: boolean }> {
  return request(`/knowledge/sources/${id}`, { method: "DELETE" });
}

export function updateKnowledgeSource(id: string, data: { tags: string | null }): Promise<{ ok: boolean }> {
  return request(`/knowledge/sources/${id}`, { method: "PATCH", body: JSON.stringify(data), headers: { "Content-Type": "application/json" } });
}

// ---- Config ----

export function getConfig(): Promise<ConfigInfo> {
  return request<ConfigInfo>("/config");
}

export function updateConfig(updates: {
  provider?: string;
  model?: string;
  baseUrl?: string;
  embedModel?: string;
  embedProvider?: string;
  apiKey?: string;
  dataDir?: string;
  telegramToken?: string;
  telegramEnabled?: boolean;
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

export function getTasks(params?: { status?: string; goalId?: string }): Promise<Task[]> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (params?.goalId) qs.set("goalId", params.goalId);
  const query = qs.toString();
  return request<Task[]>(`/tasks${query ? `?${query}` : ""}`);
}

export function createTask(input: {
  title: string;
  description?: string;
  priority?: string;
  dueDate?: string;
  goalId?: string;
}): Promise<Task> {
  return request<Task>("/tasks", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateTask(
  id: string,
  updates: { title?: string; priority?: string; dueDate?: string },
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

// ---- Goals ----

export function getGoals(): Promise<Goal[]> {
  return request<Goal[]>("/goals");
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

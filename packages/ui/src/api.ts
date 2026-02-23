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
} from "./types";

const BASE = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { ...init?.headers as Record<string, string> };
  // Only set Content-Type for requests with a body to avoid Fastify empty JSON body errors
  if (init?.body) {
    headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
  }
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
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

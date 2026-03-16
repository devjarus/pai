/**
 * Typed HTTP client for the pai API.
 * Used by probes to exercise the product like a real user.
 */

const BASE = process.env.PAI_URL || "http://127.0.0.1:3141";

let authToken: string | undefined;

async function request<T>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T; ms: number }> {
  const start = Date.now();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const ms = Date.now() - start;
  const text = await res.text();
  let data: T;
  try {
    data = JSON.parse(text) as T;
  } catch {
    data = text as unknown as T;
  }

  return { status: res.status, data, ms };
}

export async function login(email: string, password: string): Promise<boolean> {
  const res = await request<{ token?: string }>("POST", "/api/auth/login", { email, password });
  if (res.status === 200 && res.data.token) {
    authToken = res.data.token;
    return true;
  }
  return false;
}

export async function health(): Promise<{ ok: boolean; provider?: string; ms: number }> {
  const res = await request<{ ok: boolean; provider?: string }>("GET", "/api/health");
  return { ...res.data, ms: res.ms };
}

// Library
export async function librarySearch(q: string) {
  return request<{ results: Array<{ id: string; sourceType: string; title: string; snippet: string; score: number }> }>("GET", `/api/library/search?q=${encodeURIComponent(q)}`);
}

export async function libraryStats() {
  return request<Record<string, number>>("GET", "/api/library/stats");
}

export async function libraryMemories() {
  return request<{ memories: Array<{ id: string; statement: string; confidence: number; status: string }> }>("GET", "/api/library/memories");
}

export async function libraryFindings() {
  return request<{ findings: Array<{ id: string; summary: string; domain: string; confidence: number; sources: unknown[]; createdAt: string }> }>("GET", "/api/library/findings");
}

export async function libraryDocuments() {
  return request<{ documents: Array<{ id: string; url: string; title: string }> }>("GET", "/api/library/documents");
}

// Watches
export async function listWatches() {
  return request<Array<{ id: string; title: string; status: string; lastRunAt: string; nextRunAt: string }>>("GET", "/api/watches");
}

export async function watchTemplates() {
  return request<Array<{ id: string; name: string; description: string }>>("GET", "/api/watches/templates");
}

// Digests
export async function listDigests() {
  return request<{ briefings: Array<{ id: string; type: string; generatedAt: string; status: string }> }>("GET", "/api/digests");
}

export async function getDigest(id: string) {
  return request<{ id: string; sections: Record<string, unknown>; type: string }>("GET", `/api/digests/${id}`);
}

export async function digestSuggestions(id: string) {
  return request<{ suggestions: Array<{ title: string; description: string }> }>("GET", `/api/digests/${id}/suggestions`);
}

// Tasks
export async function listTasks() {
  return request<Array<{ id: string; title: string; status: string; programId?: string; briefId?: string }>>("GET", "/api/tasks");
}

// Chat
export async function chat(message: string) {
  const start = Date.now();
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: JSON.stringify({
      messages: [{ role: "user", content: message }],
    }),
  });
  const ms = Date.now() - start;
  const text = await res.text();
  return { status: res.status, text, ms };
}

// Observability
export async function observabilityOverview() {
  return request<{ totalSpans: number; errorCount: number; topProcesses: Array<{ process: string; count: number; errors: number }> }>("GET", "/api/observability/overview");
}

export async function recentErrors() {
  return request<Array<{ id: string; process: string; error: string; createdAt: string }>>("GET", "/api/observability/recent-errors");
}

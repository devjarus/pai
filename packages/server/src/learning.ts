import type { Migration, Storage } from "@personal-ai/core";

export const learningMigrations: Migration[] = [
  {
    version: 1,
    up: `CREATE TABLE IF NOT EXISTS learning_watermarks (
      source TEXT PRIMARY KEY,
      last_processed_at TEXT NOT NULL
    );`,
  },
];

export function getWatermark(storage: Storage, source: string): string {
  const rows = storage.query<{ last_processed_at: string }>(
    "SELECT last_processed_at FROM learning_watermarks WHERE source = ?",
    [source],
  );
  if (rows[0]) return rows[0].last_processed_at;
  // First run: default to 24 hours ago
  const defaultTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  storage.run(
    "INSERT INTO learning_watermarks (source, last_processed_at) VALUES (?, ?)",
    [source, defaultTime],
  );
  return defaultTime;
}

export function updateWatermark(storage: Storage, source: string, timestamp: string): void {
  storage.run(
    "INSERT OR REPLACE INTO learning_watermarks (source, last_processed_at) VALUES (?, ?)",
    [source, timestamp],
  );
}

interface ThreadSignal {
  threadId: string;
  messages: Array<{ role: string; content: string; createdAt: string }>;
}

interface ResearchSignal {
  id: string;
  goal: string;
  reportSnippet: string;
}

interface TaskSignal {
  title: string;
  priority: string;
  completedAt: string;
}

interface KnowledgeSignal {
  title: string;
  url: string;
  firstChunk: string;
}

export interface GatheredSignals {
  threads: ThreadSignal[];
  research: ResearchSignal[];
  tasks: TaskSignal[];
  knowledge: KnowledgeSignal[];
  isEmpty: boolean;
}

export function gatherSignals(storage: Storage): GatheredSignals {
  const threadsWm = getWatermark(storage, "threads");
  const researchWm = getWatermark(storage, "research");
  const tasksWm = getWatermark(storage, "tasks");
  const knowledgeWm = getWatermark(storage, "knowledge");

  // 1. Chat threads — recent user messages, grouped by thread, max 3 threads
  const recentMessages = storage.query<{
    thread_id: string; role: string; content: string; created_at: string;
  }>(
    `SELECT thread_id, role, content, created_at FROM thread_messages
     WHERE created_at > ? AND role = 'user'
     ORDER BY created_at DESC LIMIT 60`,
    [threadsWm],
  );
  const threadMap = new Map<string, ThreadSignal>();
  for (const msg of recentMessages) {
    if (threadMap.size >= 3 && !threadMap.has(msg.thread_id)) continue;
    let thread = threadMap.get(msg.thread_id);
    if (!thread) {
      thread = { threadId: msg.thread_id, messages: [] };
      threadMap.set(msg.thread_id, thread);
    }
    if (thread.messages.length < 20) {
      thread.messages.push({ role: msg.role, content: msg.content, createdAt: msg.created_at });
    }
  }
  const threads = [...threadMap.values()];

  // 2. Research reports — completed since last watermark
  let research: ResearchSignal[] = [];
  try {
    research = storage.query<{ id: string; goal: string; report: string | null }>(
      `SELECT id, goal, report FROM research_jobs
       WHERE status = 'done' AND completed_at > ?
       ORDER BY completed_at DESC LIMIT 5`,
      [researchWm],
    ).map((r) => ({
      id: r.id,
      goal: r.goal,
      reportSnippet: (r.report ?? "").slice(0, 500),
    }));
  } catch { /* research_jobs table may not exist */ }

  // 3. Completed tasks
  let tasks: TaskSignal[] = [];
  try {
    tasks = storage.query<{ title: string; priority: string; completed_at: string }>(
      `SELECT title, priority, completed_at FROM tasks
       WHERE status = 'done' AND completed_at > ?
       ORDER BY completed_at DESC LIMIT 10`,
      [tasksWm],
    ).map((t) => ({
      title: t.title,
      priority: t.priority,
      completedAt: t.completed_at,
    }));
  } catch { /* tasks table may not exist */ }

  // 4. New knowledge sources
  let knowledge: KnowledgeSignal[] = [];
  try {
    const sources = storage.query<{ id: string; title: string | null; url: string }>(
      `SELECT id, title, url FROM knowledge_sources
       WHERE fetched_at > ?
       ORDER BY fetched_at DESC LIMIT 10`,
      [knowledgeWm],
    );
    knowledge = sources.map((s) => {
      const chunk = storage.query<{ content: string }>(
        `SELECT content FROM knowledge_chunks WHERE source_id = ? ORDER BY chunk_index ASC LIMIT 1`,
        [s.id],
      );
      return {
        title: s.title ?? s.url,
        url: s.url,
        firstChunk: (chunk[0]?.content ?? "").slice(0, 200),
      };
    });
  } catch { /* knowledge tables may not exist */ }

  const isEmpty = threads.length === 0 && research.length === 0 && tasks.length === 0 && knowledge.length === 0;
  return { threads, research, tasks, knowledge, isEmpty };
}

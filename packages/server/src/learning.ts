import { generateText } from "ai";
import type { LanguageModel } from "ai";
import { remember, getContextBudget, getProviderOptions } from "@personal-ai/core";
import type { Migration, PluginContext, Storage } from "@personal-ai/core";

export const learningMigrations: Migration[] = [
  {
    version: 1,
    up: `CREATE TABLE IF NOT EXISTS learning_watermarks (
      source TEXT PRIMARY KEY,
      last_processed_at TEXT NOT NULL
    );`,
  },
  {
    version: 2,
    up: `CREATE TABLE IF NOT EXISTS learning_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      skip_reason TEXT,
      threads_count INTEGER NOT NULL DEFAULT 0,
      messages_count INTEGER NOT NULL DEFAULT 0,
      research_count INTEGER NOT NULL DEFAULT 0,
      tasks_count INTEGER NOT NULL DEFAULT 0,
      knowledge_count INTEGER NOT NULL DEFAULT 0,
      facts_extracted INTEGER NOT NULL DEFAULT 0,
      beliefs_created INTEGER NOT NULL DEFAULT 0,
      beliefs_reinforced INTEGER NOT NULL DEFAULT 0,
      low_importance_skipped INTEGER NOT NULL DEFAULT 0,
      facts_json TEXT,
      duration_ms INTEGER,
      error TEXT
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

export function insertLearningRun(storage: Storage, startedAt: string): number {
  storage.run(
    "INSERT INTO learning_runs (started_at, status) VALUES (?, 'running')",
    [startedAt],
  );
  const row = storage.query<{ id: number }>("SELECT last_insert_rowid() as id");
  return row[0]!.id;
}

export function updateLearningRun(
  storage: Storage,
  id: number,
  fields: Partial<Omit<LearningRun, "id" | "startedAt">>,
): void {
  const sets: string[] = [];
  const vals: unknown[] = [];
  const map: Record<string, string> = {
    completedAt: "completed_at",
    status: "status",
    skipReason: "skip_reason",
    threadsCount: "threads_count",
    messagesCount: "messages_count",
    researchCount: "research_count",
    tasksCount: "tasks_count",
    knowledgeCount: "knowledge_count",
    factsExtracted: "facts_extracted",
    beliefsCreated: "beliefs_created",
    beliefsReinforced: "beliefs_reinforced",
    lowImportanceSkipped: "low_importance_skipped",
    factsJson: "facts_json",
    durationMs: "duration_ms",
    error: "error",
  };
  for (const [key, col] of Object.entries(map)) {
    if (key in fields) {
      sets.push(`${col} = ?`);
      vals.push((fields as Record<string, unknown>)[key] ?? null);
    }
  }
  if (sets.length === 0) return;
  vals.push(id);
  storage.run(`UPDATE learning_runs SET ${sets.join(", ")} WHERE id = ?`, vals);
}

export function listLearningRuns(storage: Storage, limit = 20): LearningRun[] {
  return storage.query<{
    id: number;
    started_at: string;
    completed_at: string | null;
    status: string;
    skip_reason: string | null;
    threads_count: number;
    messages_count: number;
    research_count: number;
    tasks_count: number;
    knowledge_count: number;
    facts_extracted: number;
    beliefs_created: number;
    beliefs_reinforced: number;
    low_importance_skipped: number;
    facts_json: string | null;
    duration_ms: number | null;
    error: string | null;
  }>(
    "SELECT * FROM learning_runs ORDER BY id DESC LIMIT ?",
    [limit],
  ).map((r) => ({
    id: r.id,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    status: r.status as LearningRun["status"],
    skipReason: r.skip_reason,
    threadsCount: r.threads_count,
    messagesCount: r.messages_count,
    researchCount: r.research_count,
    tasksCount: r.tasks_count,
    knowledgeCount: r.knowledge_count,
    factsExtracted: r.facts_extracted,
    beliefsCreated: r.beliefs_created,
    beliefsReinforced: r.beliefs_reinforced,
    lowImportanceSkipped: r.low_importance_skipped,
    factsJson: r.facts_json,
    durationMs: r.duration_ms,
    error: r.error,
  }));
}

export function recoverStaleLearningRuns(storage: Storage): number {
  const result = storage.run(
    `UPDATE learning_runs SET status = 'error', error = 'Server restarted', completed_at = ? WHERE status = 'running'`,
    [new Date().toISOString()],
  );
  return result.changes;
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

export interface ExtractedFact {
  fact: string;
  factType: "factual" | "preference" | "procedural" | "architectural";
  importance: number;
  subject: string;
}

export function buildLearningPrompt(signals: GatheredSignals): string {
  const parts: string[] = [];

  if (signals.threads.length > 0) {
    const msgCount = signals.threads.reduce((acc, t) => acc + t.messages.length, 0);
    parts.push(`RECENT CONVERSATIONS (${msgCount} messages across ${signals.threads.length} threads):`);
    for (const t of signals.threads) {
      parts.push(t.messages.map((m) => `- ${m.content}`).join("\n"));
    }
  }

  if (signals.research.length > 0) {
    parts.push(`\nCOMPLETED RESEARCH (${signals.research.length} reports):`);
    for (const r of signals.research) {
      parts.push(`- Goal: ${r.goal}\n  Findings: ${r.reportSnippet}`);
    }
  }

  if (signals.tasks.length > 0) {
    parts.push(`\nCOMPLETED TASKS (${signals.tasks.length}):`);
    for (const t of signals.tasks) {
      parts.push(`- [${t.priority}] ${t.title}`);
    }
  }

  if (signals.knowledge.length > 0) {
    parts.push(`\nNEW KNOWLEDGE SOURCES (${signals.knowledge.length}):`);
    for (const k of signals.knowledge) {
      parts.push(`- ${k.title} (${k.url}): ${k.firstChunk}`);
    }
  }

  return `You are a background learning agent analyzing recent user activity to extract useful knowledge.

Review the following activity and extract personal facts, topic interests, procedural patterns, and recurring themes.

${parts.join("\n")}

Guidelines:
- ONLY extract high-signal personal facts: core preferences, important decisions, key relationships, work patterns
- Do NOT extract trivial observations, one-off mentions, or casual remarks
- Do NOT extract generic knowledge or common facts (e.g., "Bitcoin is a cryptocurrency")
- Do NOT extract greetings, pleasantries, or meta-conversation about the AI
- Do NOT extract facts about what the user asked or searched for — only what they stated/decided/prefer
- Each fact must be specific and attributable to a person (use "owner" for the user)
- Rate importance 1-10: 1-3 trivial (skip these), 4-6 useful context, 7-9 core preference/decision
- Only include facts you'd rate importance 4 or higher
- Maximum 10 facts total — quality over quantity
- Keep each fact under 20 words

Respond with ONLY a JSON array (no markdown, no explanation):
[{"fact":"...","factType":"factual|preference|procedural|architectural","importance":N,"subject":"owner|name"},...]

If nothing worth extracting, respond with: []`;
}

export function parseLearningResponse(text: string): ExtractedFact[] {
  let jsonText = text.trim();
  const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch?.[1]) jsonText = fenceMatch[1].trim();

  try {
    const parsed = JSON.parse(jsonText);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item: Record<string, unknown>) =>
        typeof item.fact === "string" &&
        typeof item.factType === "string" &&
        typeof item.importance === "number" &&
        typeof item.subject === "string" &&
        (item.fact as string).length > 0
      )
      .slice(0, 10)
      .map((item: Record<string, unknown>) => ({
        fact: String(item.fact),
        factType: String(item.factType) as ExtractedFact["factType"],
        importance: Number(item.importance),
        subject: String(item.subject),
      }));
  } catch {
    return [];
  }
}

export async function runBackgroundLearning(ctx: PluginContext, signal?: AbortSignal): Promise<void> {
  const start = Date.now();
  ctx.logger.info("Background learning: starting");

  // Concurrent-run guard
  const running = ctx.storage.query<{ count: number }>(
    "SELECT COUNT(*) as count FROM learning_runs WHERE status = 'running'",
  );
  if ((running[0]?.count ?? 0) > 0) {
    ctx.logger.info("Background learning: skipped (run already in progress)");
    return;
  }

  // Insert a running row
  const startedAt = new Date().toISOString();
  const runId = insertLearningRun(ctx.storage, startedAt);

  // Health check
  try {
    const health = await ctx.llm.health();
    if (!health.ok) {
      ctx.logger.info("Background learning: skipped (LLM unavailable)");
      updateLearningRun(ctx.storage, runId, {
        status: "skipped",
        skipReason: "llm_unavailable",
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - start,
      });
      return;
    }
  } catch {
    ctx.logger.info("Background learning: skipped (LLM health check failed)");
    updateLearningRun(ctx.storage, runId, {
      status: "skipped",
      skipReason: "llm_unavailable",
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - start,
    });
    return;
  }

  // Phase 1: Gather signals
  const signals = gatherSignals(ctx.storage);
  const messageCount = signals.threads.reduce((acc, t) => acc + t.messages.length, 0);

  ctx.logger.info("Background learning: signals gathered", {
    threadCount: signals.threads.length,
    messageCount,
    researchCount: signals.research.length,
    taskCount: signals.tasks.length,
    knowledgeCount: signals.knowledge.length,
  });

  // Update run with signal counts
  updateLearningRun(ctx.storage, runId, {
    threadsCount: signals.threads.length,
    messagesCount: messageCount,
    researchCount: signals.research.length,
    tasksCount: signals.tasks.length,
    knowledgeCount: signals.knowledge.length,
  });

  if (signals.isEmpty) {
    const now = new Date().toISOString();
    updateWatermark(ctx.storage, "threads", now);
    updateWatermark(ctx.storage, "research", now);
    updateWatermark(ctx.storage, "tasks", now);
    updateWatermark(ctx.storage, "knowledge", now);
    updateLearningRun(ctx.storage, runId, {
      status: "skipped",
      skipReason: "no_signals",
      completedAt: now,
      durationMs: Date.now() - start,
    });
    ctx.logger.info("Background learning: nothing new, skipped LLM call", {
      durationMs: Date.now() - start,
    });
    return;
  }

  // Check abort before LLM call
  if (signal?.aborted) {
    const now = new Date().toISOString();
    updateWatermark(ctx.storage, "threads", now);
    updateWatermark(ctx.storage, "research", now);
    updateWatermark(ctx.storage, "tasks", now);
    updateWatermark(ctx.storage, "knowledge", now);
    updateLearningRun(ctx.storage, runId, {
      status: "skipped",
      skipReason: "shutdown",
      completedAt: now,
      durationMs: Date.now() - start,
    });
    ctx.logger.info("Background learning: aborted before LLM call");
    return;
  }

  // Phase 2: LLM extraction
  const prompt = buildLearningPrompt(signals);
  let facts: ExtractedFact[] = [];

  try {
    const llmStart = Date.now();
    const budget = getContextBudget(ctx.config.llm.provider, ctx.config.llm.model, ctx.config.llm.contextWindow);
    const result = await generateText({
      model: ctx.llm.getModel() as LanguageModel,
      prompt,
      temperature: 0.3,
      maxRetries: 1,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      providerOptions: getProviderOptions(ctx.config.llm.provider, budget.contextWindow) as any,
    });
    ctx.logger.debug("Background learning: LLM call complete", {
      durationMs: Date.now() - llmStart,
    });
    facts = parseLearningResponse(result.text);
  } catch (err) {
    ctx.logger.error("Background learning: LLM extraction failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    updateLearningRun(ctx.storage, runId, {
      status: "error",
      error: err instanceof Error ? err.message : String(err),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - start,
    });
    return; // Don't update watermarks on LLM failure
  }

  // Phase 3: Store facts via remember() — only those above importance threshold
  let created = 0;
  let reinforced = 0;
  let skipped = 0;

  for (const fact of facts) {
    // Check abort before each remember call
    if (signal?.aborted) {
      ctx.logger.info("Background learning: aborted during fact storage");
      break;
    }
    // Skip low-importance facts to avoid noise buildup
    if (fact.importance < 4) {
      skipped++;
      continue;
    }
    try {
      const result = await remember(ctx.storage, ctx.llm, fact.fact, ctx.logger);
      if (result.isReinforcement) {
        reinforced++;
      } else {
        created++;
      }
    } catch (err) {
      ctx.logger.debug("Background learning: failed to store a fact", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Phase 4: Update watermarks
  const now = new Date().toISOString();
  updateWatermark(ctx.storage, "threads", now);
  updateWatermark(ctx.storage, "research", now);
  updateWatermark(ctx.storage, "tasks", now);
  updateWatermark(ctx.storage, "knowledge", now);

  const duration = Date.now() - start;

  // Persist final run outcome
  updateLearningRun(ctx.storage, runId, {
    status: signal?.aborted ? "skipped" : "done",
    skipReason: signal?.aborted ? "shutdown" : undefined,
    completedAt: now,
    factsExtracted: facts.length,
    beliefsCreated: created,
    beliefsReinforced: reinforced,
    lowImportanceSkipped: skipped,
    factsJson: facts.length > 0 ? JSON.stringify(facts) : null,
    durationMs: duration,
  });

  ctx.logger.info("Background learning: complete", {
    factsExtracted: facts.length,
    beliefsCreated: created,
    beliefsReinforced: reinforced,
    lowImportanceSkipped: skipped,
    durationMs: duration,
  });
}

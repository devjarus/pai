import { generateText } from "ai";
import type { LanguageModel } from "ai";
import { remember } from "@personal-ai/core";
import type { Migration, PluginContext, Storage } from "@personal-ai/core";

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

export async function runBackgroundLearning(ctx: PluginContext): Promise<void> {
  const start = Date.now();
  ctx.logger.info("Background learning: starting");

  // Health check
  try {
    const health = await ctx.llm.health();
    if (!health.ok) {
      ctx.logger.info("Background learning: skipped (LLM unavailable)");
      return;
    }
  } catch {
    ctx.logger.info("Background learning: skipped (LLM health check failed)");
    return;
  }

  // Phase 1: Gather signals
  const signals = gatherSignals(ctx.storage);

  ctx.logger.info("Background learning: signals gathered", {
    threadCount: signals.threads.length,
    messageCount: signals.threads.reduce((acc, t) => acc + t.messages.length, 0),
    researchCount: signals.research.length,
    taskCount: signals.tasks.length,
    knowledgeCount: signals.knowledge.length,
  });

  if (signals.isEmpty) {
    const now = new Date().toISOString();
    updateWatermark(ctx.storage, "threads", now);
    updateWatermark(ctx.storage, "research", now);
    updateWatermark(ctx.storage, "tasks", now);
    updateWatermark(ctx.storage, "knowledge", now);
    ctx.logger.info("Background learning: nothing new, skipped LLM call", {
      durationMs: Date.now() - start,
    });
    return;
  }

  // Phase 2: LLM extraction
  const prompt = buildLearningPrompt(signals);
  let facts: ExtractedFact[] = [];

  try {
    const llmStart = Date.now();
    const result = await generateText({
      model: ctx.llm.getModel() as LanguageModel,
      prompt,
      temperature: 0.3,
      maxRetries: 1,
    });
    ctx.logger.debug("Background learning: LLM call complete", {
      durationMs: Date.now() - llmStart,
    });
    facts = parseLearningResponse(result.text);
  } catch (err) {
    ctx.logger.error("Background learning: LLM extraction failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return; // Don't update watermarks on LLM failure
  }

  // Phase 3: Store facts via remember() — only those above importance threshold
  let created = 0;
  let reinforced = 0;
  let skipped = 0;

  for (const fact of facts) {
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
  ctx.logger.info("Background learning: complete", {
    factsExtracted: facts.length,
    beliefsCreated: created,
    beliefsReinforced: reinforced,
    lowImportanceSkipped: skipped,
    durationMs: duration,
  });
}

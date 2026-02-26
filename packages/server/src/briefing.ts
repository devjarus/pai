import { generateObject } from "ai";
import type { LanguageModel } from "ai";
import { z } from "zod";
import type { Migration, PluginContext } from "@personal-ai/core";
import { listBeliefs, memoryStats, listSources } from "@personal-ai/core";
import { listTasks, listGoals } from "@personal-ai/plugin-tasks";

// --- Types ---

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

export interface BriefingRow {
  id: string;
  generated_at: string;
  sections: string;
  raw_context: string | null;
  status: string;
}

export interface Briefing {
  id: string;
  generatedAt: string;
  sections: BriefingSection;
  status: string;
}

// --- Migration ---

export const briefingMigrations: Migration[] = [
  {
    version: 1,
    up: `
      CREATE TABLE IF NOT EXISTS briefings (
        id TEXT PRIMARY KEY,
        generated_at TEXT NOT NULL DEFAULT (datetime('now')),
        sections TEXT NOT NULL DEFAULT '{}',
        raw_context TEXT,
        status TEXT NOT NULL DEFAULT 'ready'
      );
      CREATE INDEX IF NOT EXISTS idx_briefings_generated_at ON briefings(generated_at);
    `,
  },
];

// --- Data Access ---

export function getLatestBriefing(storage: PluginContext["storage"]): Briefing | null {
  const rows = storage.query<BriefingRow>(
    "SELECT * FROM briefings WHERE status = 'ready' ORDER BY generated_at DESC LIMIT 1",
    [],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    generatedAt: row.generated_at,
    sections: JSON.parse(row.sections),
    status: row.status,
  };
}

export function getBriefingById(storage: PluginContext["storage"], id: string): Briefing | null {
  const rows = storage.query<BriefingRow>(
    "SELECT * FROM briefings WHERE id = ?",
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    generatedAt: row.generated_at,
    sections: JSON.parse(row.sections),
    status: row.status,
  };
}

export function listBriefings(storage: PluginContext["storage"]): Array<{ id: string; generatedAt: string }> {
  return storage.query<{ id: string; generated_at: string }>(
    "SELECT id, generated_at FROM briefings WHERE status = 'ready' ORDER BY generated_at DESC LIMIT 30",
    [],
  ).map((r) => ({ id: r.id, generatedAt: r.generated_at }));
}

function pruneOldBriefings(storage: PluginContext["storage"]): void {
  storage.run(
    "DELETE FROM briefings WHERE generated_at < datetime('now', '-30 days')",
    [],
  );
}

// --- Zod Schema for Structured Output ---

const briefingSectionsSchema = z.object({
  greeting: z.string(),
  taskFocus: z.object({
    summary: z.string(),
    items: z.array(z.object({
      id: z.string(),
      title: z.string(),
      priority: z.string(),
      insight: z.string(),
    })),
  }),
  memoryInsights: z.object({
    summary: z.string(),
    highlights: z.array(z.object({
      statement: z.string(),
      type: z.string(),
      detail: z.string(),
    })),
  }),
  suggestions: z.array(z.object({
    title: z.string(),
    reason: z.string(),
    action: z.string().optional(),
    actionTarget: z.string().optional(),
  })),
});

// --- Generation ---

export async function generateBriefing(ctx: PluginContext): Promise<Briefing | null> {
  try {
    const health = await ctx.llm.health();
    if (!health.ok) return null;
  } catch {
    return null;
  }

  const tasks = listTasks(ctx.storage, "open");
  const goals = listGoals(ctx.storage).filter((g) => g.status === "active");
  const recentBeliefs = listBeliefs(ctx.storage, "active").slice(0, 20);
  const stats = memoryStats(ctx.storage);
  const sources = listSources(ctx.storage).slice(0, 10);

  const now = new Date();
  const ownerRow = ctx.storage.query<{ name: string | null }>(
    "SELECT name FROM owner LIMIT 1",
    [],
  );
  const ownerName = ownerRow[0]?.name || "there";

  const rawContext = {
    ownerName,
    date: now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }),
    time: now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true }),
    tasks: tasks.map((t) => ({ id: t.id, title: t.title, priority: t.priority, dueDate: t.due_date })),
    goals: goals.map((g) => ({ title: g.title })),
    beliefs: recentBeliefs.map((b) => ({
      statement: b.statement,
      type: b.type,
      confidence: b.confidence,
      updatedAt: b.updated_at,
      accessCount: b.access_count,
    })),
    stats: {
      totalBeliefs: stats.beliefs.active,
      avgConfidence: stats.avgConfidence,
      episodes: stats.episodes,
    },
    knowledgeSources: sources.map((s) => ({ title: s.title, url: s.url })),
  };

  const prompt = `You are a personal AI assistant generating a daily briefing for ${ownerName}.
Today is ${rawContext.date}, ${rawContext.time}.

Based on the following context, generate an insightful, concise daily briefing.

OPEN TASKS (${tasks.length}):
${JSON.stringify(rawContext.tasks, null, 2)}

ACTIVE GOALS (${goals.length}):
${JSON.stringify(rawContext.goals, null, 2)}

RECENT MEMORY (${recentBeliefs.length} beliefs, ${stats.beliefs.active} total active):
${JSON.stringify(rawContext.beliefs, null, 2)}

KNOWLEDGE SOURCES (${sources.length}):
${JSON.stringify(rawContext.knowledgeSources, null, 2)}

Guidelines:
- The greeting should be warm and include key numbers naturally (e.g., "Good morning, ${ownerName}. You have 3 open tasks and your memory has grown to 45 beliefs.")
- taskFocus.items: Pick the most important tasks (max 5). For each, provide a brief insight about why it matters or what to prioritize.
- memoryInsights.highlights: Pick the most interesting recent beliefs (max 3). Note anything noteworthy — new learnings, high confidence items, or rarely accessed beliefs that might be worth revisiting.
- suggestions: Provide 2-3 actionable recommendations. These could be: review stale beliefs, tackle a specific task, learn about a topic related to existing knowledge, or consolidate related memories.
- Keep everything concise. Each insight/suggestion should be 1-2 sentences max.`;

  const id = crypto.randomUUID();
  ctx.storage.run(
    "INSERT INTO briefings (id, generated_at, sections, raw_context, status) VALUES (?, datetime('now'), '{}', ?, 'generating')",
    [id, JSON.stringify(rawContext)],
  );

  try {
    const result = await generateObject({
      model: ctx.llm.getModel() as LanguageModel,
      schema: briefingSectionsSchema,
      prompt,
      maxRetries: 1,
    });

    const sections = JSON.stringify(result.object);
    ctx.storage.run(
      "UPDATE briefings SET sections = ?, status = 'ready' WHERE id = ?",
      [sections, id],
    );

    pruneOldBriefings(ctx.storage);

    return {
      id,
      generatedAt: new Date().toISOString(),
      sections: result.object,
      status: "ready",
    };
  } catch (err) {
    ctx.logger.error("Briefing generation failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    ctx.storage.run(
      "UPDATE briefings SET status = 'failed' WHERE id = ?",
      [id],
    );
    return null;
  }
}

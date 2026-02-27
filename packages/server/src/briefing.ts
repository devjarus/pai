import { generateText } from "ai";
import type { LanguageModel } from "ai";
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
  type: string;
}

export interface Briefing {
  id: string;
  generatedAt: string;
  sections: BriefingSection;
  status: string;
  type: string;
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
  {
    version: 2,
    up: `ALTER TABLE briefings ADD COLUMN type TEXT NOT NULL DEFAULT 'daily';`,
  },
];

// --- Data Access ---

export function getLatestBriefing(storage: PluginContext["storage"]): Briefing | null {
  const rows = storage.query<BriefingRow>(
    "SELECT * FROM briefings WHERE status = 'ready' AND type = 'daily' ORDER BY generated_at DESC LIMIT 1",
    [],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    generatedAt: row.generated_at,
    sections: JSON.parse(row.sections),
    status: row.status,
    type: row.type,
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
    type: row.type,
  };
}

export function listBriefings(storage: PluginContext["storage"]): Array<{ id: string; generatedAt: string }> {
  return storage.query<{ id: string; generated_at: string }>(
    "SELECT id, generated_at FROM briefings WHERE status = 'ready' AND type = 'daily' ORDER BY generated_at DESC LIMIT 30",
    [],
  ).map((r) => ({ id: r.id, generatedAt: r.generated_at }));
}

export function listAllBriefings(storage: PluginContext["storage"]): Briefing[] {
  const rows = storage.query<BriefingRow>(
    "SELECT * FROM briefings WHERE status = 'ready' ORDER BY generated_at DESC LIMIT 30",
    [],
  );
  return rows.map((row) => ({
    id: row.id,
    generatedAt: row.generated_at,
    sections: JSON.parse(row.sections),
    status: row.status,
    type: row.type,
  }));
}

export function clearAllBriefings(storage: PluginContext["storage"]): number {
  const count = storage.query<{ cnt: number }>("SELECT COUNT(*) as cnt FROM briefings")[0]?.cnt ?? 0;
  storage.run("DELETE FROM briefings");
  return count;
}

export function getResearchBriefings(storage: PluginContext["storage"]): Briefing[] {
  const rows = storage.query<BriefingRow>(
    "SELECT * FROM briefings WHERE status = 'ready' AND type = 'research' ORDER BY generated_at DESC LIMIT 20",
    [],
  );
  return rows.map((row) => ({
    id: row.id,
    generatedAt: row.generated_at,
    sections: JSON.parse(row.sections),
    status: row.status,
    type: row.type,
  }));
}

export function createResearchBriefing(
  storage: PluginContext["storage"],
  id: string,
  report: string,
  goal: string,
): void {
  storage.run(
    "INSERT INTO briefings (id, generated_at, sections, raw_context, status, type) VALUES (?, datetime('now'), ?, null, 'ready', 'research')",
    [id, JSON.stringify({ report, goal })],
  );
}

function pruneOldBriefings(storage: PluginContext["storage"]): void {
  storage.run(
    "DELETE FROM briefings WHERE generated_at < datetime('now', '-30 days')",
    [],
  );
}

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
  const stats = memoryStats(ctx.storage);
  const sources = listSources(ctx.storage).slice(0, 10);

  // Recently completed tasks (last 7 days) — to celebrate progress
  const recentlyDone = listTasks(ctx.storage, "done").filter((t) => {
    if (!t.completed_at) return false;
    const age = Date.now() - new Date(t.completed_at).getTime();
    return age < 7 * 24 * 60 * 60 * 1000;
  }).slice(0, 5);

  // Recently updated/new beliefs (last 3 days) — what's actually changed
  const allBeliefs = listBeliefs(ctx.storage, "active");
  const recentBeliefs = allBeliefs
    .filter((b) => {
      const age = Date.now() - new Date(b.updated_at).getTime();
      return age < 3 * 24 * 60 * 60 * 1000;
    })
    .slice(0, 15);
  // If few recent beliefs, pad with highest-confidence ones
  const topBeliefs = recentBeliefs.length >= 10
    ? recentBeliefs
    : [...recentBeliefs, ...allBeliefs.filter((b) => !recentBeliefs.some((r) => r.id === b.id)).slice(0, 10 - recentBeliefs.length)];

  // Recent episodes (conversations/interactions) — what user has been doing
  let recentEpisodes: Array<{ content: string; timestamp: string }> = [];
  try {
    recentEpisodes = ctx.storage.query<{ content: string; timestamp: string }>(
      "SELECT content, timestamp FROM episodes ORDER BY timestamp DESC LIMIT 10",
    );
  } catch { /* episodes table may not exist */ }

  // Previous briefing — to avoid repetition
  let previousGreeting = "";
  try {
    const prev = ctx.storage.query<{ sections: string }>(
      "SELECT sections FROM briefings WHERE status = 'ready' AND type = 'daily' ORDER BY generated_at DESC LIMIT 1",
    );
    if (prev[0]) {
      const parsed = JSON.parse(prev[0].sections);
      previousGreeting = parsed.greeting ?? "";
    }
  } catch { /* ignore */ }

  const now = new Date();
  let ownerName = "there";
  try {
    const ownerRow = ctx.storage.query<{ name: string | null }>(
      "SELECT name FROM owner LIMIT 1",
      [],
    );
    ownerName = ownerRow[0]?.name || "there";
  } catch {
    // owner table may not exist yet
  }

  const rawContext = {
    ownerName,
    date: now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }),
    time: now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true }),
    tasks: tasks.map((t) => ({ id: t.id, title: t.title, priority: t.priority, dueDate: t.due_date })),
    recentlyCompleted: recentlyDone.map((t) => ({ title: t.title, completedAt: t.completed_at })),
    goals: goals.map((g) => ({ title: g.title })),
    beliefs: topBeliefs.map((b) => ({
      statement: b.statement,
      type: b.type,
      confidence: b.confidence,
      updatedAt: b.updated_at,
      accessCount: b.access_count,
      isNew: (Date.now() - new Date(b.updated_at).getTime()) < 24 * 60 * 60 * 1000,
    })),
    recentActivity: recentEpisodes.map((e) => e.content.slice(0, 100)),
    stats: {
      totalBeliefs: stats.beliefs.active,
      avgConfidence: stats.avgConfidence,
      episodes: stats.episodes,
    },
    knowledgeSources: sources.map((s) => ({ title: s.title, url: s.url })),
  };

  const prompt = `You are a personal AI assistant generating a daily briefing for ${ownerName}.
Today is ${rawContext.date}, ${rawContext.time}.

Generate a FRESH, insightful briefing based on the following context. Each briefing should feel unique — highlight what changed, what's new, what progress was made.

OPEN TASKS (${tasks.length}):
${JSON.stringify(rawContext.tasks, null, 2)}

RECENTLY COMPLETED (${recentlyDone.length}):
${JSON.stringify(rawContext.recentlyCompleted, null, 2)}

ACTIVE GOALS (${goals.length}):
${JSON.stringify(rawContext.goals, null, 2)}

MEMORY — RECENT & TOP BELIEFS (${topBeliefs.length} shown, ${stats.beliefs.active} total active):
${JSON.stringify(rawContext.beliefs, null, 2)}

RECENT ACTIVITY (last conversations/interactions):
${rawContext.recentActivity.length > 0 ? rawContext.recentActivity.join("\n") : "(no recent activity)"}

KNOWLEDGE SOURCES (${sources.length}):
${JSON.stringify(rawContext.knowledgeSources, null, 2)}

${previousGreeting ? `PREVIOUS BRIEFING GREETING (do NOT repeat this — say something different):\n"${previousGreeting}"\n` : ""}
Guidelines:
- The greeting should be warm, unique each time, and reference what's actually happening — recent completions, new learnings, time of day, or recent activity. Don't just repeat stats.
- taskFocus.items: Pick the most URGENT or RELEVANT tasks right now (max 5). For each, provide a brief insight about why it matters today or what to prioritize next.
- memoryInsights.highlights: Prefer beliefs marked "isNew: true" (recently learned). Note new patterns, contradictions, or connections between beliefs. If nothing is new, highlight something the user hasn't accessed recently.
- suggestions: Provide 2-3 actionable, SPECIFIC recommendations. Reference actual tasks, beliefs, or knowledge by name. Suggest concrete next steps.
- Keep everything concise. Each insight/suggestion should be 1-2 sentences max.

Respond ONLY with a valid JSON object matching this exact shape (no markdown, no explanation):
{
  "greeting": "string",
  "taskFocus": { "summary": "string", "items": [{ "id": "string", "title": "string", "priority": "string", "insight": "string" }] },
  "memoryInsights": { "summary": "string", "highlights": [{ "statement": "string", "type": "string", "detail": "string" }] },
  "suggestions": [{ "title": "string", "reason": "string", "action": "recall|task|learn (optional)", "actionTarget": "string (optional)" }]
}`;

  const id = crypto.randomUUID();
  ctx.storage.run(
    "INSERT INTO briefings (id, generated_at, sections, raw_context, status) VALUES (?, datetime('now'), '{}', ?, 'generating')",
    [id, JSON.stringify(rawContext)],
  );

  try {
    const result = await generateText({
      model: ctx.llm.getModel() as LanguageModel,
      prompt,
      maxRetries: 1,
    });

    // Extract JSON from the response (handle possible markdown code fences)
    let jsonText = result.text.trim();
    const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch?.[1]) jsonText = fenceMatch[1].trim();

    const parsed = JSON.parse(jsonText) as BriefingSection;

    const sections = JSON.stringify(parsed);
    ctx.storage.run(
      "UPDATE briefings SET sections = ?, status = 'ready' WHERE id = ?",
      [sections, id],
    );

    pruneOldBriefings(ctx.storage);

    return {
      id,
      generatedAt: new Date().toISOString(),
      sections: parsed,
      status: "ready",
      type: "daily",
    };
  } catch (err) {
    console.error("Briefing generation failed:", err instanceof Error ? err.message : String(err));
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

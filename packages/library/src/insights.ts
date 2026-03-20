import type { Storage, Migration } from "@personal-ai/core";
import { nanoid } from "nanoid";

// ---- Types ----

export interface TopicInsight {
  id: string;
  watchId: string | null;
  topic: string;
  insight: string;
  confidence: number;
  cycleCount: number;
  sources: string[]; // finding IDs that contributed
  createdAt: string;
  updatedAt: string;
}

interface InsightRow {
  id: string;
  watch_id: string | null;
  topic: string;
  insight: string;
  confidence: number;
  cycle_count: number;
  sources_json: string;
  created_at: string;
  updated_at: string;
}

// ---- Migrations ----

export const insightMigrations: Migration[] = [
  {
    version: 1,
    up: `
      CREATE TABLE IF NOT EXISTS topic_insights (
        id TEXT PRIMARY KEY,
        watch_id TEXT,
        topic TEXT NOT NULL,
        insight TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.7,
        cycle_count INTEGER NOT NULL DEFAULT 1,
        sources_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_topic_insights_watch ON topic_insights(watch_id);
      CREATE INDEX IF NOT EXISTS idx_topic_insights_topic ON topic_insights(topic);
    `,
  },
];

// ---- Helpers ----

function rowToInsight(row: InsightRow): TopicInsight {
  return {
    id: row.id,
    watchId: row.watch_id,
    topic: row.topic,
    insight: row.insight,
    confidence: row.confidence,
    cycleCount: row.cycle_count,
    sources: JSON.parse(row.sources_json) as string[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---- CRUD ----

export function createInsight(
  storage: Storage,
  input: { watchId?: string; topic: string; insight: string; confidence?: number; sources?: string[] },
): TopicInsight {
  const id = nanoid();
  storage.run(
    `INSERT INTO topic_insights (id, watch_id, topic, insight, confidence, sources_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, input.watchId ?? null, input.topic, input.insight, input.confidence ?? 0.7, JSON.stringify(input.sources ?? [])],
  );
  return getInsight(storage, id)!;
}

export function updateInsight(
  storage: Storage,
  id: string,
  updates: { insight?: string; confidence?: number; cycleCount?: number; sources?: string[] },
): TopicInsight | null {
  const existing = getInsight(storage, id);
  if (!existing) return null;

  const sets: string[] = ["updated_at = datetime('now')"];
  const params: unknown[] = [];
  if (updates.insight !== undefined) { sets.push("insight = ?"); params.push(updates.insight); }
  if (updates.confidence !== undefined) { sets.push("confidence = ?"); params.push(updates.confidence); }
  if (updates.cycleCount !== undefined) { sets.push("cycle_count = ?"); params.push(updates.cycleCount); }
  if (updates.sources !== undefined) { sets.push("sources_json = ?"); params.push(JSON.stringify(updates.sources)); }

  params.push(id);
  storage.run(`UPDATE topic_insights SET ${sets.join(", ")} WHERE id = ?`, params);
  return getInsight(storage, id);
}

export function getInsight(storage: Storage, id: string): TopicInsight | null {
  const rows = storage.query<InsightRow>("SELECT * FROM topic_insights WHERE id = ?", [id]);
  return rows[0] ? rowToInsight(rows[0]) : null;
}

export function listInsights(storage: Storage, watchId?: string): TopicInsight[] {
  if (watchId) {
    return storage.query<InsightRow>(
      "SELECT * FROM topic_insights WHERE watch_id = ? ORDER BY confidence DESC, updated_at DESC",
      [watchId],
    ).map(rowToInsight);
  }
  return storage.query<InsightRow>(
    "SELECT * FROM topic_insights ORDER BY confidence DESC, updated_at DESC",
  ).map(rowToInsight);
}

export function deleteInsight(storage: Storage, id: string): boolean {
  const result = storage.run("DELETE FROM topic_insights WHERE id = ?", [id]);
  return result.changes > 0;
}

export function deleteInsightsForWatch(storage: Storage, watchId: string): number {
  const result = storage.run("DELETE FROM topic_insights WHERE watch_id = ?", [watchId]);
  return result.changes;
}

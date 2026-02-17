import type { Storage, Migration } from "@personal-ai/core";
import { nanoid } from "nanoid";

export const memoryMigrations: Migration[] = [
  {
    version: 1,
    up: `
      CREATE TABLE episodes (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        context TEXT,
        action TEXT NOT NULL,
        outcome TEXT,
        tags_json TEXT DEFAULT '[]'
      );
      CREATE TABLE beliefs (
        id TEXT PRIMARY KEY,
        statement TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.5,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE belief_episodes (
        belief_id TEXT NOT NULL REFERENCES beliefs(id),
        episode_id TEXT NOT NULL REFERENCES episodes(id),
        PRIMARY KEY (belief_id, episode_id)
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS beliefs_fts USING fts5(statement, content=beliefs, content_rowid=rowid);
      CREATE TRIGGER beliefs_ai AFTER INSERT ON beliefs BEGIN
        INSERT INTO beliefs_fts(rowid, statement) VALUES (new.rowid, new.statement);
      END;
      CREATE TRIGGER beliefs_ad AFTER DELETE ON beliefs BEGIN
        INSERT INTO beliefs_fts(beliefs_fts, rowid, statement) VALUES ('delete', old.rowid, old.statement);
      END;
      CREATE TRIGGER beliefs_au AFTER UPDATE ON beliefs BEGIN
        INSERT INTO beliefs_fts(beliefs_fts, rowid, statement) VALUES ('delete', old.rowid, old.statement);
        INSERT INTO beliefs_fts(rowid, statement) VALUES (new.rowid, new.statement);
      END;
    `,
  },
  {
    version: 2,
    up: `
      CREATE TABLE belief_changes (
        id TEXT PRIMARY KEY,
        belief_id TEXT NOT NULL REFERENCES beliefs(id),
        change_type TEXT NOT NULL,
        detail TEXT,
        episode_id TEXT REFERENCES episodes(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
];

export interface Episode {
  id: string;
  timestamp: string;
  context: string | null;
  action: string;
  outcome: string | null;
  tags_json: string;
}

export interface Belief {
  id: string;
  statement: string;
  confidence: number;
  status: string;
  created_at: string;
  updated_at: string;
}

const HALF_LIFE_DAYS = 30;

export function effectiveConfidence(belief: Belief): number {
  const updatedAt = new Date(belief.updated_at + "Z").getTime();
  const now = Date.now();
  const daysSinceUpdate = (now - updatedAt) / (1000 * 60 * 60 * 24);
  return belief.confidence * Math.pow(0.5, daysSinceUpdate / HALF_LIFE_DAYS);
}

export function createEpisode(
  storage: Storage,
  input: { context?: string; action: string; outcome?: string; tags?: string[] },
): Episode {
  const id = nanoid();
  storage.run(
    "INSERT INTO episodes (id, context, action, outcome, tags_json) VALUES (?, ?, ?, ?, ?)",
    [id, input.context ?? null, input.action, input.outcome ?? null, JSON.stringify(input.tags ?? [])],
  );
  return storage.query<Episode>("SELECT * FROM episodes WHERE id = ?", [id])[0]!;
}

export function listEpisodes(storage: Storage, limit = 50): Episode[] {
  return storage.query<Episode>("SELECT * FROM episodes ORDER BY timestamp DESC LIMIT ?", [limit]);
}

export function createBelief(
  storage: Storage,
  input: { statement: string; confidence: number },
): Belief {
  const id = nanoid();
  storage.run("INSERT INTO beliefs (id, statement, confidence) VALUES (?, ?, ?)", [
    id,
    input.statement,
    input.confidence,
  ]);
  return storage.query<Belief>("SELECT * FROM beliefs WHERE id = ?", [id])[0]!;
}

const FTS5_OPERATORS = /\b(AND|OR|NOT|NEAR)\b/gi;
const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "can", "shall", "to", "of", "in", "for",
  "on", "with", "at", "by", "from", "as", "into", "about", "than",
  "its", "it", "this", "that", "these", "those", "i", "we", "you",
  "he", "she", "they", "me", "him", "her", "us", "them", "my", "our",
  "your", "his", "their", "more", "most", "very", "also", "just",
  "generally", "actually", "definitely", "really", "compared",
]);

export function searchBeliefs(storage: Storage, query: string, limit = 10): Belief[] {
  const words = query
    .replace(FTS5_OPERATORS, "")
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !STOP_WORDS.has(w.toLowerCase()));
  const sanitized = words.map((w) => `"${w}"`).join(" OR ");
  if (!sanitized) return [];
  return storage.query<Belief>(
    `SELECT b.* FROM beliefs b
     JOIN beliefs_fts fts ON b.rowid = fts.rowid
     WHERE beliefs_fts MATCH ? AND b.status = 'active'
     ORDER BY rank LIMIT ?`,
    [sanitized, limit],
  ).map((b) => ({ ...b, confidence: effectiveConfidence(b) }));
}

export function listBeliefs(storage: Storage, status = "active"): Belief[] {
  const beliefs = storage.query<Belief>(
    "SELECT * FROM beliefs WHERE status = ?",
    [status],
  );
  return beliefs
    .map((b) => ({ ...b, confidence: effectiveConfidence(b) }))
    .sort((a, b) => b.confidence - a.confidence);
}

export function linkBeliefToEpisode(storage: Storage, beliefId: string, episodeId: string): void {
  storage.run("INSERT OR IGNORE INTO belief_episodes (belief_id, episode_id) VALUES (?, ?)", [
    beliefId,
    episodeId,
  ]);
}

export function reinforceBelief(storage: Storage, beliefId: string, delta = 0.1): void {
  storage.run(
    "UPDATE beliefs SET confidence = MIN(1.0, confidence + ?), updated_at = datetime('now') WHERE id = ?",
    [delta, beliefId],
  );
}

export interface BeliefChange {
  id: string;
  belief_id: string;
  change_type: string;
  detail: string | null;
  episode_id: string | null;
  created_at: string;
}

export function logBeliefChange(
  storage: Storage,
  input: { beliefId: string; changeType: string; detail?: string; episodeId?: string },
): void {
  const id = nanoid();
  storage.run(
    "INSERT INTO belief_changes (id, belief_id, change_type, detail, episode_id) VALUES (?, ?, ?, ?, ?)",
    [id, input.beliefId, input.changeType, input.detail ?? null, input.episodeId ?? null],
  );
}

export function getBeliefHistory(storage: Storage, beliefId: string): BeliefChange[] {
  return storage.query<BeliefChange>(
    "SELECT * FROM belief_changes WHERE belief_id = ? ORDER BY created_at DESC, rowid DESC",
    [beliefId],
  );
}

export function getMemoryContext(storage: Storage, query: string, beliefLimit = 5, episodeLimit = 5): string {
  const beliefs = searchBeliefs(storage, query, beliefLimit);
  const episodes = listEpisodes(storage, episodeLimit);

  const beliefSection = beliefs.length > 0
    ? beliefs.map((b) => `- [${b.confidence.toFixed(1)}] ${b.statement}`).join("\n")
    : "No relevant beliefs found.";

  const episodeSection = episodes.length > 0
    ? episodes.map((e) => `- [${e.timestamp}] ${e.action}`).join("\n")
    : "No recent observations.";

  return `## Relevant beliefs\n${beliefSection}\n\n## Recent observations\n${episodeSection}`;
}

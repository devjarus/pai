import type { Storage, Migration, LLMClient } from "../types.js";
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
  {
    version: 3,
    up: `
      ALTER TABLE beliefs ADD COLUMN type TEXT NOT NULL DEFAULT 'insight';
      CREATE TABLE belief_embeddings (
        belief_id TEXT PRIMARY KEY REFERENCES beliefs(id),
        embedding TEXT NOT NULL
      );
    `,
  },
  {
    version: 4,
    up: `
      CREATE TABLE episode_embeddings (
        episode_id TEXT PRIMARY KEY REFERENCES episodes(id),
        embedding TEXT NOT NULL
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
  type: string;
  created_at: string;
  updated_at: string;
}

const HALF_LIFE_DAYS = 30;

function decayConfidence(confidence: number, updatedAt: string): number {
  const ts = new Date(updatedAt + "Z").getTime();
  const daysSinceUpdate = (Date.now() - ts) / (1000 * 60 * 60 * 24);
  return confidence * Math.pow(0.5, daysSinceUpdate / HALF_LIFE_DAYS);
}

export function effectiveConfidence(belief: Belief): number {
  return decayConfidence(belief.confidence, belief.updated_at);
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
  input: { statement: string; confidence: number; type?: string },
): Belief {
  const id = nanoid();
  storage.run("INSERT INTO beliefs (id, statement, confidence, type) VALUES (?, ?, ?, ?)", [
    id,
    input.statement,
    input.confidence,
    input.type ?? "insight",
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

export function forgetBelief(storage: Storage, beliefId: string): void {
  const rows = storage.query<Pick<Belief, "id">>(
    "SELECT id FROM beliefs WHERE id = ? AND status = 'active' LIMIT 1",
    [beliefId],
  );
  const id = rows[0]?.id ?? (() => {
    const prefixMatches = storage.query<Pick<Belief, "id">>(
      "SELECT id FROM beliefs WHERE id LIKE ? AND status = 'active' ORDER BY created_at DESC LIMIT 2",
      [`${beliefId}%`],
    );
    if (prefixMatches.length === 0) throw new Error(`No active belief matches "${beliefId}".`);
    if (prefixMatches.length > 1) throw new Error(`Belief id prefix "${beliefId}" is ambiguous. Provide more characters.`);
    return prefixMatches[0]!.id;
  })();
  storage.run("UPDATE beliefs SET status = 'forgotten', updated_at = datetime('now') WHERE id = ?", [id]);
  logBeliefChange(storage, { beliefId: id, changeType: "forgotten", detail: "Manually forgotten by user" });
}

export function pruneBeliefs(storage: Storage, threshold = 0.05): string[] {
  const beliefs = storage.query<Belief>("SELECT * FROM beliefs WHERE status = 'active'");
  const toPrune = beliefs.filter((b) => effectiveConfidence(b) < threshold);
  for (const b of toPrune) {
    storage.run("UPDATE beliefs SET status = 'pruned', updated_at = datetime('now') WHERE id = ?", [b.id]);
    logBeliefChange(storage, { beliefId: b.id, changeType: "pruned", detail: `Effective confidence ${effectiveConfidence(b).toFixed(3)} below threshold ${threshold}` });
  }
  return toPrune.map((b) => b.id);
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
  const exact = storage.query<BeliefChange>(
    "SELECT * FROM belief_changes WHERE belief_id = ? ORDER BY created_at DESC, rowid DESC",
    [beliefId],
  );
  if (exact.length > 0) return exact;
  return storage.query<BeliefChange>(
    "SELECT * FROM belief_changes WHERE belief_id LIKE ? ORDER BY created_at DESC, rowid DESC",
    [`${beliefId}%`],
  );
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export interface SimilarBelief {
  beliefId: string;
  statement: string;
  confidence: number;
  similarity: number;
  type: string;
}

export function storeEmbedding(storage: Storage, beliefId: string, embedding: number[]): void {
  storage.run(
    "INSERT OR REPLACE INTO belief_embeddings (belief_id, embedding) VALUES (?, ?)",
    [beliefId, JSON.stringify(embedding)],
  );
}

export function findSimilarBeliefs(
  storage: Storage,
  queryEmbedding: number[],
  limit: number,
): SimilarBelief[] {
  const rows = storage.query<{ belief_id: string; embedding: string; statement: string; confidence: number; updated_at: string; type: string }>(
    `SELECT be.belief_id, be.embedding, b.statement, b.confidence, b.updated_at, b.type
     FROM belief_embeddings be
     JOIN beliefs b ON b.id = be.belief_id
     WHERE b.status = 'active'`,
  );

  return rows
    .map((row) => {
      const emb = JSON.parse(row.embedding) as number[];
      return {
        beliefId: row.belief_id,
        statement: row.statement,
        confidence: decayConfidence(row.confidence, row.updated_at),
        similarity: cosineSimilarity(queryEmbedding, emb),
        type: row.type,
      };
    })
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

export interface SimilarEpisode {
  episodeId: string;
  action: string;
  timestamp: string;
  similarity: number;
}

export function storeEpisodeEmbedding(storage: Storage, episodeId: string, embedding: number[]): void {
  storage.run(
    "INSERT OR REPLACE INTO episode_embeddings (episode_id, embedding) VALUES (?, ?)",
    [episodeId, JSON.stringify(embedding)],
  );
}

export function findSimilarEpisodes(
  storage: Storage,
  queryEmbedding: number[],
  limit: number,
): SimilarEpisode[] {
  const rows = storage.query<{ episode_id: string; embedding: string; action: string; timestamp: string }>(
    `SELECT ee.episode_id, ee.embedding, e.action, e.timestamp
     FROM episode_embeddings ee
     JOIN episodes e ON e.id = ee.episode_id`,
  );

  return rows
    .map((row) => {
      const emb = JSON.parse(row.embedding) as number[];
      return {
        episodeId: row.episode_id,
        action: row.action,
        timestamp: row.timestamp,
        similarity: cosineSimilarity(queryEmbedding, emb),
      };
    })
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

export interface ReflectionResult {
  duplicates: Array<{ ids: string[]; statements: string[]; similarity: number }>;
  stale: Array<{ id: string; statement: string; effectiveConfidence: number }>;
  total: number;
}

export function reflect(storage: Storage, options?: { similarityThreshold?: number; staleThreshold?: number; limit?: number }): ReflectionResult {
  const simThreshold = options?.similarityThreshold ?? 0.85;
  const staleThreshold = options?.staleThreshold ?? 0.1;
  const limit = options?.limit ?? 200;

  const rows = storage.query<{ belief_id: string; embedding: string; statement: string; confidence: number; updated_at: string }>(
    `SELECT be.belief_id, be.embedding, b.statement, b.confidence, b.updated_at
     FROM belief_embeddings be
     JOIN beliefs b ON b.id = be.belief_id
     WHERE b.status = 'active'
     ORDER BY b.updated_at DESC
     LIMIT ?`,
    [limit],
  );

  // Find near-duplicate pairs
  const seen = new Set<string>();
  const duplicates: ReflectionResult["duplicates"] = [];
  for (let i = 0; i < rows.length; i++) {
    if (seen.has(rows[i]!.belief_id)) continue;
    const embA = JSON.parse(rows[i]!.embedding) as number[];
    const cluster = [rows[i]!];
    for (let j = i + 1; j < rows.length; j++) {
      if (seen.has(rows[j]!.belief_id)) continue;
      const embB = JSON.parse(rows[j]!.embedding) as number[];
      if (cosineSimilarity(embA, embB) >= simThreshold) {
        cluster.push(rows[j]!);
        seen.add(rows[j]!.belief_id);
      }
    }
    if (cluster.length > 1) {
      seen.add(rows[i]!.belief_id);
      duplicates.push({
        ids: cluster.map((r) => r.belief_id),
        statements: cluster.map((r) => r.statement),
        similarity: simThreshold,
      });
    }
  }

  // Find stale beliefs
  const allBeliefs = storage.query<Belief>("SELECT * FROM beliefs WHERE status = 'active'");
  const stale = allBeliefs
    .filter((b) => effectiveConfidence(b) < staleThreshold)
    .map((b) => ({ id: b.id, statement: b.statement, effectiveConfidence: effectiveConfidence(b) }));

  return { duplicates, stale, total: allBeliefs.length };
}

export interface MemoryStats {
  beliefs: { total: number; active: number; invalidated: number; forgotten: number };
  episodes: number;
  avgConfidence: number;
  oldestBelief: string | null;
  newestBelief: string | null;
}

export function memoryStats(storage: Storage): MemoryStats {
  const counts = storage.query<{ status: string; cnt: number }>(
    "SELECT status, COUNT(*) as cnt FROM beliefs GROUP BY status",
  );
  const statusMap: Record<string, number> = {};
  let total = 0;
  for (const r of counts) { statusMap[r.status] = r.cnt; total += r.cnt; }

  const epCount = storage.query<{ cnt: number }>("SELECT COUNT(*) as cnt FROM episodes")[0]!.cnt;

  const avgRow = storage.query<{ avg: number | null }>(
    "SELECT AVG(confidence) as avg FROM beliefs WHERE status = 'active'",
  )[0];

  const oldest = storage.query<{ created_at: string }>(
    "SELECT created_at FROM beliefs WHERE status = 'active' ORDER BY created_at ASC LIMIT 1",
  )[0]?.created_at ?? null;

  const newest = storage.query<{ created_at: string }>(
    "SELECT created_at FROM beliefs WHERE status = 'active' ORDER BY created_at DESC LIMIT 1",
  )[0]?.created_at ?? null;

  return {
    beliefs: {
      total,
      active: statusMap["active"] ?? 0,
      invalidated: statusMap["invalidated"] ?? 0,
      forgotten: statusMap["forgotten"] ?? 0,
    },
    episodes: epCount,
    avgConfidence: avgRow?.avg ?? 0,
    oldestBelief: oldest,
    newestBelief: newest,
  };
}

export interface MemoryExport {
  version: number;
  exported_at: string;
  beliefs: Belief[];
  episodes: Episode[];
  belief_changes: BeliefChange[];
}

export function exportMemory(storage: Storage): MemoryExport {
  return {
    version: 1,
    exported_at: new Date().toISOString(),
    beliefs: storage.query<Belief>("SELECT * FROM beliefs"),
    episodes: storage.query<Episode>("SELECT * FROM episodes"),
    belief_changes: storage.query<BeliefChange>("SELECT * FROM belief_changes"),
  };
}

export function importMemory(storage: Storage, data: MemoryExport): { beliefs: number; episodes: number } {
  if (!data || !Array.isArray(data.episodes) || !Array.isArray(data.beliefs)) {
    throw new Error("Invalid import format. Expected { beliefs: [], episodes: [], belief_changes?: [] }.");
  }
  let beliefs = 0;
  let episodes = 0;

  for (const ep of data.episodes) {
    const exists = storage.query<{ id: string }>("SELECT id FROM episodes WHERE id = ?", [ep.id]);
    if (exists.length === 0) {
      storage.run(
        "INSERT INTO episodes (id, timestamp, context, action, outcome, tags_json) VALUES (?, ?, ?, ?, ?, ?)",
        [ep.id, ep.timestamp, ep.context, ep.action, ep.outcome, ep.tags_json],
      );
      episodes++;
    }
  }

  for (const b of data.beliefs) {
    const exists = storage.query<{ id: string }>("SELECT id FROM beliefs WHERE id = ?", [b.id]);
    if (exists.length === 0) {
      storage.run(
        "INSERT INTO beliefs (id, statement, confidence, status, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [b.id, b.statement, b.confidence, b.status, b.type, b.created_at, b.updated_at],
      );
      beliefs++;
    }
  }

  for (const bc of data.belief_changes ?? []) {
    const exists = storage.query<{ id: string }>("SELECT id FROM belief_changes WHERE id = ?", [bc.id]);
    if (exists.length === 0) {
      storage.run(
        "INSERT INTO belief_changes (id, belief_id, change_type, detail, episode_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        [bc.id, bc.belief_id, bc.change_type, bc.detail, bc.episode_id, bc.created_at],
      );
    }
  }

  return { beliefs, episodes };
}

export async function getMemoryContext(
  storage: Storage,
  query: string,
  options?: { llm?: LLMClient; beliefLimit?: number; episodeLimit?: number },
): Promise<string> {
  const beliefLimit = options?.beliefLimit ?? 5;
  const episodeLimit = options?.episodeLimit ?? 5;

  let beliefs: Array<{ statement: string; confidence: number; type: string }> = [];
  let episodes: Array<{ action: string; timestamp: string }> = [];

  if (options?.llm) {
    try {
      const { embedding } = await options.llm.embed(query);
      beliefs = findSimilarBeliefs(storage, embedding, beliefLimit)
        .filter((s) => s.similarity > 0.3)
        .map((s) => ({ statement: s.statement, confidence: s.confidence, type: s.type }));
      episodes = findSimilarEpisodes(storage, embedding, episodeLimit)
        .filter((s) => s.similarity > 0.3)
        .map((s) => ({ action: s.action, timestamp: s.timestamp }));
    } catch {
      // Fallback to FTS5/recent on embedding failure
    }
  }
  if (beliefs.length === 0) {
    beliefs = searchBeliefs(storage, query, beliefLimit).map((b) => ({
      statement: b.statement, confidence: b.confidence, type: b.type,
    }));
  }
  if (episodes.length === 0) {
    episodes = listEpisodes(storage, episodeLimit);
  }

  // Sort beliefs by confidence (strongest first)
  beliefs.sort((a, b) => b.confidence - a.confidence);

  const beliefSection = beliefs.length > 0
    ? beliefs.map((b) => `- [${b.type}|${b.confidence.toFixed(1)}] ${b.statement}`).join("\n")
    : "No relevant beliefs found.";

  const episodeSection = episodes.length > 0
    ? episodes.map((e) => `- [${e.timestamp}] ${e.action}`).join("\n")
    : "No recent observations.";

  return `## Relevant beliefs\n${beliefSection}\n\n## Recent observations\n${episodeSection}`;
}

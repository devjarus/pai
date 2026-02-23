import type { Storage, Migration, LLMClient, Logger } from "../types.js";
import { nanoid } from "nanoid";
import { knowledgeSearch } from "../knowledge.js";
import type { KnowledgeSearchResult } from "../knowledge.js";

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
  {
    version: 5,
    up: `
      ALTER TABLE beliefs ADD COLUMN superseded_by TEXT REFERENCES beliefs(id);
      ALTER TABLE beliefs ADD COLUMN supersedes TEXT REFERENCES beliefs(id);
    `,
  },
  {
    version: 6,
    up: `
      ALTER TABLE beliefs ADD COLUMN importance INTEGER NOT NULL DEFAULT 5;
      ALTER TABLE beliefs ADD COLUMN last_accessed TEXT;
      ALTER TABLE beliefs ADD COLUMN access_count INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 7,
    up: `
      ALTER TABLE beliefs ADD COLUMN stability REAL NOT NULL DEFAULT 1.0;
    `,
  },
  {
    version: 8,
    up: `
      CREATE TABLE belief_links (
        belief_a TEXT NOT NULL REFERENCES beliefs(id),
        belief_b TEXT NOT NULL REFERENCES beliefs(id),
        PRIMARY KEY (belief_a, belief_b)
      );
    `,
  },
  {
    version: 9,
    up: `
      CREATE INDEX IF NOT EXISTS idx_beliefs_status ON beliefs(status);
      CREATE INDEX IF NOT EXISTS idx_beliefs_status_updated ON beliefs(status, updated_at);
      CREATE INDEX IF NOT EXISTS idx_belief_links_a ON belief_links(belief_a);
      CREATE INDEX IF NOT EXISTS idx_belief_links_b ON belief_links(belief_b);
      CREATE INDEX IF NOT EXISTS idx_belief_episodes_belief ON belief_episodes(belief_id);
      CREATE INDEX IF NOT EXISTS idx_belief_changes_belief ON belief_changes(belief_id);
    `,
  },
  {
    version: 10,
    up: `
      ALTER TABLE beliefs ADD COLUMN subject TEXT DEFAULT 'owner';
      CREATE INDEX IF NOT EXISTS idx_beliefs_subject ON beliefs(subject);
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
  superseded_by: string | null;
  supersedes: string | null;
  importance: number;
  last_accessed: string | null;
  access_count: number;
  stability: number;
  /** Who this belief is about: "owner" (default), or a person's name */
  subject: string;
}

const BASE_HALF_LIFE_DAYS = 30;

function decayConfidence(confidence: number, updatedAt: string, stability = 1.0): number {
  const ts = new Date(updatedAt + "Z").getTime();
  const daysSinceUpdate = (Date.now() - ts) / (1000 * 60 * 60 * 24);
  const halfLife = BASE_HALF_LIFE_DAYS * stability;
  return confidence * Math.pow(0.5, daysSinceUpdate / halfLife);
}

export function effectiveConfidence(belief: Belief): number {
  return decayConfidence(belief.confidence, belief.updated_at, belief.stability ?? 1.0);
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
  input: { statement: string; confidence: number; type?: string; importance?: number; subject?: string },
): Belief {
  const id = nanoid();
  const importance = input.importance ?? 5;
  const subject = input.subject ?? "owner";
  storage.run("INSERT INTO beliefs (id, statement, confidence, type, importance, subject) VALUES (?, ?, ?, ?, ?, ?)", [
    id,
    input.statement,
    input.confidence,
    input.type ?? "insight",
    importance,
    subject,
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
  const beliefs = status === "all"
    ? storage.query<Belief>("SELECT * FROM beliefs")
    : storage.query<Belief>("SELECT * FROM beliefs WHERE status = ?", [status]);
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

export function countSupportingEpisodes(storage: Storage, beliefId: string): number {
  const rows = storage.query<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM belief_episodes WHERE belief_id = ?",
    [beliefId],
  );
  return rows[0]?.cnt ?? 0;
}

export function linkSupersession(storage: Storage, oldBeliefId: string, newBeliefId: string): void {
  storage.run("UPDATE beliefs SET superseded_by = ? WHERE id = ?", [newBeliefId, oldBeliefId]);
  storage.run("UPDATE beliefs SET supersedes = ? WHERE id = ?", [oldBeliefId, newBeliefId]);
}

export function linkBeliefs(storage: Storage, beliefA: string, beliefB: string): void {
  // Store in canonical order to prevent duplicates
  const [a, b] = beliefA < beliefB ? [beliefA, beliefB] : [beliefB, beliefA];
  storage.run("INSERT OR IGNORE INTO belief_links (belief_a, belief_b) VALUES (?, ?)", [a, b]);
}

export function getLinkedBeliefs(storage: Storage, beliefId: string): string[] {
  const rows = storage.query<{ belief_a: string; belief_b: string }>(
    "SELECT belief_a, belief_b FROM belief_links WHERE belief_a = ? OR belief_b = ?",
    [beliefId, beliefId],
  );
  return rows.map((r) => r.belief_a === beliefId ? r.belief_b : r.belief_a);
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
  // Dimension mismatch (e.g. switching between embedding models) — can't compare
  if (a.length !== b.length || a.length === 0) return 0;
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
  /** Multi-factor ranking score (similarity + importance + recency) */
  similarity: number;
  /** Raw cosine similarity between query and belief embeddings */
  cosine?: number;
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
  const rows = storage.query<{ belief_id: string; embedding: string; statement: string; confidence: number; updated_at: string; type: string; stability: number }>(
    `SELECT be.belief_id, be.embedding, b.statement, b.confidence, b.updated_at, b.type, b.stability
     FROM belief_embeddings be
     JOIN beliefs b ON b.id = be.belief_id
     WHERE b.status = 'active'`,
  );

  return rows
    .map((row) => {
      try {
        const emb = JSON.parse(row.embedding) as number[];
        if (!Array.isArray(emb)) return null;
        return {
          beliefId: row.belief_id,
          statement: row.statement,
          confidence: decayConfidence(row.confidence, row.updated_at, row.stability),
          similarity: cosineSimilarity(queryEmbedding, emb),
          type: row.type,
        };
      } catch {
        // Corrupted embedding — skip this row
        return null;
      }
    })
    .filter((r): r is SimilarBelief => r !== null)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

export function recordAccess(storage: Storage, beliefId: string): void {
  // SM-2 inspired: each retrieval increases stability by 0.1 (capped at 5.0)
  // stability 1.0 = 30-day half-life, stability 5.0 = 150-day half-life
  storage.run(
    "UPDATE beliefs SET access_count = access_count + 1, last_accessed = datetime('now'), stability = MIN(5.0, stability + 0.1) WHERE id = ?",
    [beliefId],
  );
}

export function semanticSearch(
  storage: Storage,
  queryEmbedding: number[],
  limit: number,
  queryText?: string,
): SimilarBelief[] {
  const rows = storage.query<{
    belief_id: string; embedding: string; statement: string;
    confidence: number; updated_at: string; type: string;
    importance: number; last_accessed: string | null; access_count: number;
    stability: number; subject: string;
  }>(
    `SELECT be.belief_id, be.embedding, b.statement, b.confidence, b.updated_at,
            b.type, b.importance, b.last_accessed, b.access_count, b.stability, b.subject
     FROM belief_embeddings be
     JOIN beliefs b ON b.id = be.belief_id
     WHERE b.status = 'active'`,
  );

  // Subject-aware boosting: detect mentioned subjects in query
  const queryLower = queryText?.toLowerCase() ?? "";
  let mentionedSubjects = new Set<string>();
  if (queryLower) {
    const knownSubjects = storage.query<{ subject: string }>(
      "SELECT DISTINCT subject FROM beliefs WHERE status = 'active' AND subject != 'owner' AND subject != 'general'",
    ).map((r) => r.subject);
    mentionedSubjects = new Set(knownSubjects.filter((s) => queryLower.includes(s)));
  }

  const now = Date.now();
  const COSINE_THRESHOLD = 0.2;
  const scored = rows
    .map((row) => {
      let emb: number[];
      try {
        emb = JSON.parse(row.embedding) as number[];
        if (!Array.isArray(emb)) return null;
      } catch {
        return null; // Corrupted embedding — skip
      }
      const cosine = cosineSimilarity(queryEmbedding, emb);
      const confidence = decayConfidence(row.confidence, row.updated_at, row.stability);

      // Recency: exponential decay based on last access or update time
      const accessTs = row.last_accessed
        ? new Date(row.last_accessed + "Z").getTime()
        : new Date(row.updated_at + "Z").getTime();
      const daysSinceAccess = (now - accessTs) / (1000 * 60 * 60 * 24);
      const recency = Math.exp(-0.023 * daysSinceAccess); // ~30-day half-life

      // Importance: normalized to 0-1 from 1-10 scale
      const importance = row.importance / 10;

      // Stability bonus: rewards well-established beliefs (capped at 1.0)
      const stabilityBonus = Math.min(row.stability / 5.0, 1.0);

      // Subject match: boost beliefs whose subject is mentioned in the query
      const subjectMatch = (mentionedSubjects.size > 0 && mentionedSubjects.has(row.subject)) ? 1.0 : 0.0;

      // Multi-factor score: semantic relevance + importance + recency + stability + subject match
      let score = 0.5 * cosine + 0.2 * importance + 0.1 * recency + 0.05 * stabilityBonus + 0.15 * subjectMatch;

      // Deprioritize generic insight-type beliefs to reduce noise
      if (row.type === "insight") {
        score *= 0.5;
      }

      return {
        beliefId: row.belief_id,
        statement: row.statement,
        confidence,
        similarity: score, // ranking score
        cosine,            // raw cosine for filtering
        type: row.type,
      };
    })
    .filter((r): r is SimilarBelief & { cosine: number } => r !== null);

  // Filter by cosine similarity threshold, then sort by ranking score
  const results = scored
    .filter((r) => r.cosine >= COSINE_THRESHOLD)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);

  // Graph traversal: batch-fetch linked neighbors for top-3 results (avoids N+1)
  const resultIds = new Set(results.map((r) => r.beliefId));
  const neighbors: SimilarBelief[] = [];
  const top3 = results.slice(0, 3);
  if (top3.length > 0) {
    const top3Ids = top3.map((r) => r.beliefId);
    const placeholders = top3Ids.map(() => "?").join(",");
    const scoreMap = new Map(top3.map((r) => [r.beliefId, r.similarity]));

    // Single query: get all linked belief IDs for top-3 results
    const linkRows = storage.query<{ belief_a: string; belief_b: string }>(
      `SELECT belief_a, belief_b FROM belief_links WHERE belief_a IN (${placeholders}) OR belief_b IN (${placeholders})`,
      [...top3Ids, ...top3Ids],
    );

    const linkedIds = new Set<string>();
    const linkedScoreMap = new Map<string, number>();
    for (const row of linkRows) {
      const sourceId = top3Ids.includes(row.belief_a) ? row.belief_a : row.belief_b;
      const linkedId = row.belief_a === sourceId ? row.belief_b : row.belief_a;
      if (!resultIds.has(linkedId) && !linkedIds.has(linkedId)) {
        linkedIds.add(linkedId);
        linkedScoreMap.set(linkedId, (scoreMap.get(sourceId) ?? 0) * 0.8);
      }
    }

    // Single query: fetch all linked beliefs at once
    if (linkedIds.size > 0) {
      const linkedArr = [...linkedIds];
      const linkedPlaceholders = linkedArr.map(() => "?").join(",");
      const linkedBeliefs = storage.query<{ id: string; statement: string; confidence: number; updated_at: string; type: string; stability: number }>(
        `SELECT id, statement, confidence, updated_at, type, stability FROM beliefs WHERE id IN (${linkedPlaceholders}) AND status = 'active'`,
        linkedArr,
      );
      for (const b of linkedBeliefs) {
        neighbors.push({
          beliefId: b.id,
          statement: b.statement,
          confidence: decayConfidence(b.confidence, b.updated_at, b.stability),
          similarity: linkedScoreMap.get(b.id) ?? 0,
          type: b.type,
        });
      }
    }
  }
  const combined = [...results, ...neighbors].slice(0, limit);

  // Batch-record access for returned beliefs (single UPDATE instead of N)
  if (combined.length > 0) {
    const ids = combined.map((r) => r.beliefId);
    const placeholders = ids.map(() => "?").join(",");
    storage.run(
      `UPDATE beliefs SET access_count = access_count + 1, last_accessed = datetime('now'), stability = MIN(5.0, stability + 0.1) WHERE id IN (${placeholders})`,
      ids,
    );
  }

  return combined;
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
      try {
        const emb = JSON.parse(row.embedding) as number[];
        if (!Array.isArray(emb)) return null;
        return {
          episodeId: row.episode_id,
          action: row.action,
          timestamp: row.timestamp,
          similarity: cosineSimilarity(queryEmbedding, emb),
        };
      } catch {
        return null;
      }
    })
    .filter((r): r is SimilarEpisode => r !== null)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

export interface ReflectionResult {
  duplicates: Array<{ ids: string[]; statements: string[]; similarity: number }>;
  stale: Array<{ id: string; statement: string; effectiveConfidence: number }>;
  total: number;
  skippedEmbeddings?: number;
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

  // Parse embeddings upfront, skipping malformed ones
  const parsed: Array<{ row: typeof rows[number]; emb: number[] }> = [];
  let skippedEmbeddings = 0;
  for (const row of rows) {
    try {
      const emb = JSON.parse(row!.embedding) as number[];
      if (Array.isArray(emb) && emb.length > 0) {
        parsed.push({ row: row!, emb });
      } else {
        skippedEmbeddings++;
      }
    } catch {
      skippedEmbeddings++;
    }
  }

  // Find near-duplicate pairs
  const seen = new Set<string>();
  const duplicates: ReflectionResult["duplicates"] = [];
  for (let i = 0; i < parsed.length; i++) {
    if (seen.has(parsed[i]!.row.belief_id)) continue;
    const cluster = [parsed[i]!.row];
    for (let j = i + 1; j < parsed.length; j++) {
      if (seen.has(parsed[j]!.row.belief_id)) continue;
      if (cosineSimilarity(parsed[i]!.emb, parsed[j]!.emb) >= simThreshold) {
        cluster.push(parsed[j]!.row);
        seen.add(parsed[j]!.row.belief_id);
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

  return { duplicates, stale, total: allBeliefs.length, skippedEmbeddings };
}

export function mergeDuplicates(
  storage: Storage,
  clusters: ReflectionResult["duplicates"],
): { merged: number; kept: string[] } {
  let merged = 0;
  const kept: string[] = [];

  for (const cluster of clusters) {
    if (cluster.ids.length < 2) continue;

    // Find the belief with highest effective confidence
    const beliefs = cluster.ids
      .map((id) => storage.query<Belief>("SELECT * FROM beliefs WHERE id = ?", [id])[0])
      .filter((b): b is Belief => b != null);

    if (beliefs.length < 2) continue;

    beliefs.sort((a, b) => effectiveConfidence(b) - effectiveConfidence(a));
    const winner = beliefs[0]!;
    kept.push(winner.id);

    for (const loser of beliefs.slice(1)) {
      // Transfer episodes from loser to winner
      const episodes = storage.query<{ episode_id: string }>(
        "SELECT episode_id FROM belief_episodes WHERE belief_id = ?",
        [loser.id],
      );
      for (const ep of episodes) {
        const exists = storage.query<{ c: number }>(
          "SELECT COUNT(*) as c FROM belief_episodes WHERE belief_id = ? AND episode_id = ?",
          [winner.id, ep.episode_id],
        );
        if (exists[0]!.c === 0) {
          storage.run("INSERT INTO belief_episodes (belief_id, episode_id) VALUES (?, ?)", [winner.id, ep.episode_id]);
        }
      }

      // Invalidate loser and create supersession link
      storage.run("UPDATE beliefs SET status = 'invalidated', updated_at = datetime('now') WHERE id = ?", [loser.id]);
      linkSupersession(storage, loser.id, winner.id);
      logBeliefChange(storage, {
        beliefId: loser.id,
        changeType: "contradicted",
        detail: `Merged into duplicate ${winner.id}`,
      });
      merged++;
    }

    // Reinforce winner
    reinforceBelief(storage, winner.id);
    logBeliefChange(storage, {
      beliefId: winner.id,
      changeType: "reinforced",
      detail: `Absorbed ${beliefs.length - 1} duplicate(s)`,
    });
  }

  return { merged, kept };
}

export async function synthesize(
  storage: Storage,
  llm: LLMClient,
): Promise<{ metaBeliefs: string[]; clustersProcessed: number }> {
  // Use a lower threshold (0.6) to find thematic clusters, not just near-duplicates
  const reflection = reflect(storage, { similarityThreshold: 0.6 });
  const metaBeliefs: string[] = [];

  for (const cluster of reflection.duplicates.slice(0, 5)) {
    if (cluster.statements.length < 2) continue;

    const result = await llm.chat([
      {
        role: "system",
        content:
          "You synthesize higher-order patterns from a set of related beliefs. " +
          "Extract ONE general principle that explains why these beliefs exist together. " +
          "Reply with a single sentence under 20 words. No quotes.",
      },
      {
        role: "user",
        content: `Related beliefs:\n${cluster.statements.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n\nWhat general principle connects these?`,
      },
    ], { temperature: 0.3 });

    const statement = result.text.trim();
    if (!statement) continue;

    // Create meta-belief with high stability (decays slower)
    const belief = createBelief(storage, { statement, confidence: 0.8, type: "meta" });
    storage.run("UPDATE beliefs SET stability = 3.0 WHERE id = ?", [belief.id]);

    // Try to embed the meta-belief
    try {
      const { embedding } = await llm.embed(statement);
      storeEmbedding(storage, belief.id, embedding);
    } catch {
      // Proceed without embedding
    }

    // Link meta-belief to its source beliefs
    for (const sourceId of cluster.ids) {
      linkBeliefs(storage, belief.id, sourceId);
    }

    logBeliefChange(storage, {
      beliefId: belief.id,
      changeType: "created",
      detail: `Synthesized from ${cluster.ids.length} beliefs: ${cluster.ids.join(", ")}`,
    });

    metaBeliefs.push(statement);
  }

  return { metaBeliefs, clustersProcessed: reflection.duplicates.length };
}

export async function findContradictions(
  storage: Storage,
  llm: LLMClient,
  limit = 20,
): Promise<Array<{ beliefA: Belief; beliefB: Belief; explanation: string }>> {
  const rows = storage.query<{ belief_id: string; embedding: string }>(
    `SELECT be.belief_id, be.embedding
     FROM belief_embeddings be
     JOIN beliefs b ON b.id = be.belief_id
     WHERE b.status = 'active'
     ORDER BY b.updated_at DESC
     LIMIT 200`,
  );

  const parsed: Array<{ beliefId: string; emb: number[] }> = [];
  for (const row of rows) {
    try {
      const emb = JSON.parse(row.embedding) as number[];
      if (Array.isArray(emb) && emb.length > 0) {
        parsed.push({ beliefId: row.belief_id, emb });
      }
    } catch { /* skip malformed */ }
  }

  const candidates: Array<{ idA: string; idB: string; similarity: number }> = [];
  for (let i = 0; i < parsed.length; i++) {
    for (let j = i + 1; j < parsed.length; j++) {
      const sim = cosineSimilarity(parsed[i]!.emb, parsed[j]!.emb);
      if (sim >= 0.4 && sim <= 0.85) {
        candidates.push({ idA: parsed[i]!.beliefId, idB: parsed[j]!.beliefId, similarity: sim });
      }
    }
  }

  candidates.sort((a, b) => b.similarity - a.similarity);
  const topCandidates = candidates.slice(0, limit);
  if (topCandidates.length === 0) return [];

  const allIds = [...new Set(topCandidates.flatMap((c) => [c.idA, c.idB]))];
  const placeholders = allIds.map(() => "?").join(",");
  const beliefRows = storage.query<Belief>(
    `SELECT * FROM beliefs WHERE id IN (${placeholders})`,
    allIds,
  );
  const beliefMap = new Map(beliefRows.map((b) => [b.id, b]));

  // Build pairs list for batch LLM check
  const pairs: Array<{ index: number; beliefA: Belief; beliefB: Belief }> = [];
  for (let i = 0; i < topCandidates.length; i++) {
    const beliefA = beliefMap.get(topCandidates[i]!.idA);
    const beliefB = beliefMap.get(topCandidates[i]!.idB);
    if (beliefA && beliefB) {
      pairs.push({ index: i + 1, beliefA, beliefB });
    }
  }
  if (pairs.length === 0) return [];

  // Single batched LLM call instead of N separate calls
  const pairsList = pairs.map((p) =>
    `${p.index}. "${p.beliefA.statement}" vs "${p.beliefB.statement}"`
  ).join("\n");

  const result = await llm.chat([
    {
      role: "system",
      content: `You are a contradiction detector. You will be given numbered pairs of beliefs. For each pair, determine if they CONTRADICT each other — meaning they cannot both be true at the same time.

Reply with one line per pair, in order:
- "N. CONTRADICTION: <brief explanation>" if they contradict
- "N. COMPATIBLE" if they can coexist

Only output the numbered verdicts, nothing else.`,
    },
    {
      role: "user",
      content: pairsList,
    },
  ], { temperature: 0 });

  // Parse batched response
  const contradictions: Array<{ beliefA: Belief; beliefB: Belief; explanation: string }> = [];
  const lines = result.text.trim().split("\n");
  for (const line of lines) {
    const match = line.match(/^(\d+)\.\s*CONTRADICTION:\s*(.+)/i);
    if (!match) continue;
    const idx = parseInt(match[1]!, 10);
    const pair = pairs.find((p) => p.index === idx);
    if (pair) {
      contradictions.push({ beliefA: pair.beliefA, beliefB: pair.beliefB, explanation: `CONTRADICTION: ${match[2]!.trim()}` });
    }
  }

  return contradictions;
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

export interface MemoryExportV1 {
  version: 1;
  exported_at: string;
  beliefs: Belief[];
  episodes: Episode[];
  belief_changes: BeliefChange[];
}

export interface MemoryExportV2 {
  version: 2;
  exported_at: string;
  beliefs: Belief[];
  episodes: Episode[];
  belief_changes: BeliefChange[];
  belief_episodes: Array<{ belief_id: string; episode_id: string }>;
  belief_embeddings: Array<{ belief_id: string; embedding: string }>;
  episode_embeddings: Array<{ episode_id: string; embedding: string }>;
  belief_links: Array<{ belief_a: string; belief_b: string }>;
}

export type MemoryExport = MemoryExportV1 | MemoryExportV2;

/**
 * Backfill subjects on existing beliefs that are all tagged "owner".
 * Uses the LLM to detect who each belief is about.
 * Batches beliefs for efficiency (10 per LLM call).
 * Returns the number of beliefs re-tagged.
 */
export async function backfillSubjects(storage: Storage, llm: LLMClient, logger?: Logger): Promise<number> {
  const beliefs = storage.query<{ id: string; statement: string }>(
    "SELECT id, statement FROM beliefs WHERE status = 'active' AND subject = 'owner'",
  );

  if (beliefs.length === 0) return 0;

  let updated = 0;
  const batchSize = 10;

  for (let i = 0; i < beliefs.length; i += batchSize) {
    const batch = beliefs.slice(i, i + batchSize);
    const numbered = batch.map((b, idx) => `${idx + 1}. "${b.statement}"`).join("\n");

    try {
      const result = await llm.chat([
        {
          role: "system",
          content:
            "You identify WHO a belief/fact is about. For each numbered statement, reply with ONLY the person's name " +
            "(e.g., \"Alex\", \"Bob\") or \"owner\" if it's about the AI's owner generically " +
            "(e.g., \"User prefers X\", \"He likes Y\"), or \"general\" if it's about a system, concept, or no specific person. " +
            "Reply with one answer per line in the format: NUMBER. SUBJECT\n" +
            "Examples:\n1. owner\n2. Alex\n3. general\n4. Bob",
        },
        { role: "user", content: numbered },
      ], { temperature: 0 });

      const lines = result.text.trim().split("\n");
      for (const line of lines) {
        const parsed = /^(\d+)\.\s*(.+)$/.exec(line.trim());
        if (!parsed) continue;
        const idx = parseInt(parsed[1]!, 10) - 1;
        const subject = parsed[2]!.trim().toLowerCase();
        if (idx < 0 || idx >= batch.length) continue;
        if (subject === "owner" || subject === "general" || !subject) continue;

        storage.run(
          "UPDATE beliefs SET subject = ?, updated_at = datetime('now') WHERE id = ?",
          [subject, batch[idx]!.id],
        );
        updated++;
      }
    } catch (err) {
      logger?.warn("backfillSubjects batch failed", {
        batchStart: i,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return updated;
}

export function exportMemory(storage: Storage): MemoryExportV2 {
  return {
    version: 2,
    exported_at: new Date().toISOString(),
    beliefs: storage.query<Belief>("SELECT * FROM beliefs"),
    episodes: storage.query<Episode>("SELECT * FROM episodes"),
    belief_changes: storage.query<BeliefChange>("SELECT * FROM belief_changes"),
    belief_episodes: storage.query<{ belief_id: string; episode_id: string }>("SELECT * FROM belief_episodes"),
    belief_embeddings: storage.query<{ belief_id: string; embedding: string }>("SELECT * FROM belief_embeddings"),
    episode_embeddings: storage.query<{ episode_id: string; embedding: string }>("SELECT * FROM episode_embeddings"),
    belief_links: storage.query<{ belief_a: string; belief_b: string }>("SELECT * FROM belief_links"),
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
        `INSERT INTO beliefs (id, statement, confidence, status, type, created_at, updated_at,
         importance, stability, access_count, last_accessed, supersedes, superseded_by, subject)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          b.id, b.statement, b.confidence, b.status, b.type ?? "insight",
          b.created_at, b.updated_at,
          b.importance ?? 5, b.stability ?? 1.0, b.access_count ?? 0,
          b.last_accessed ?? null, b.supersedes ?? null, b.superseded_by ?? null,
          b.subject ?? "owner",
        ],
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

  // V2 tables: belief_episodes, embeddings, links
  if (data.version === 2) {
    for (const be of data.belief_episodes ?? []) {
      const exists = storage.query<{ belief_id: string }>(
        "SELECT belief_id FROM belief_episodes WHERE belief_id = ? AND episode_id = ?",
        [be.belief_id, be.episode_id],
      );
      if (exists.length === 0) {
        storage.run(
          "INSERT OR IGNORE INTO belief_episodes (belief_id, episode_id) VALUES (?, ?)",
          [be.belief_id, be.episode_id],
        );
      }
    }

    for (const emb of data.belief_embeddings ?? []) {
      storage.run(
        "INSERT OR IGNORE INTO belief_embeddings (belief_id, embedding) VALUES (?, ?)",
        [emb.belief_id, emb.embedding],
      );
    }

    for (const emb of data.episode_embeddings ?? []) {
      storage.run(
        "INSERT OR IGNORE INTO episode_embeddings (episode_id, embedding) VALUES (?, ?)",
        [emb.episode_id, emb.embedding],
      );
    }

    for (const link of data.belief_links ?? []) {
      storage.run(
        "INSERT OR IGNORE INTO belief_links (belief_a, belief_b) VALUES (?, ?)",
        [link.belief_a, link.belief_b],
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
  const beliefLimit = options?.beliefLimit ?? 8;
  const episodeLimit = options?.episodeLimit ?? 8;

  let beliefs: Array<{ statement: string; confidence: number; type: string; stability: number; subject: string }> = [];
  let episodes: Array<{ action: string; timestamp: string }> = [];

  if (options?.llm) {
    try {
      const { embedding } = await options.llm.embed(query);
      const similar = semanticSearch(storage, embedding, beliefLimit, query);
      // Fetch stability and subject for context-retrieved beliefs
      beliefs = similar.map((s) => {
        const row = storage.query<{ stability: number; subject: string }>(
          "SELECT stability, subject FROM beliefs WHERE id = ?", [s.beliefId],
        )[0];
        return { statement: s.statement, confidence: s.confidence, type: s.type, stability: row?.stability ?? 1.0, subject: row?.subject ?? "owner" };
      });
      episodes = findSimilarEpisodes(storage, embedding, episodeLimit)
        .filter((s) => s.similarity > 0.3)
        .map((s) => ({ action: s.action, timestamp: s.timestamp }));
    } catch {
      // Fallback to FTS5/recent on embedding failure
    }
  }
  // FTS fallback when semantic search returns no results (cosine mismatch)
  if (beliefs.length === 0) {
    beliefs = searchBeliefs(storage, query, beliefLimit).map((b) => ({
      statement: b.statement, confidence: b.confidence, type: b.type, stability: b.stability ?? 1.0, subject: b.subject ?? "owner",
    }));
  }
  if (episodes.length === 0) {
    episodes = listEpisodes(storage, episodeLimit);
  }

  // Sort beliefs by confidence (strongest first)
  beliefs.sort((a, b) => b.confidence - a.confidence);

  // Group beliefs by subject for clearer multi-person context
  let beliefSection: string;
  if (beliefs.length === 0) {
    beliefSection = "No relevant beliefs found.";
  } else {
    const grouped: Record<string, typeof beliefs> = {};
    for (const b of beliefs) {
      const key = b.subject || "owner";
      if (!grouped[key]) grouped[key] = [];
      grouped[key]!.push(b);
    }
    const subjects = Object.keys(grouped);
    if (subjects.length === 1 && subjects[0] === "owner") {
      // Single-subject (owner only) — flat list as before
      beliefSection = beliefs.map((b) => {
        const stabilityTag = b.stability >= 3.0 ? " [well-established]" : b.stability >= 2.0 ? " [established]" : "";
        return `- [${b.type}|${b.confidence.toFixed(1)}] ${b.statement}${stabilityTag}`;
      }).join("\n");
    } else {
      // Multi-subject — group by person
      const sections: string[] = [];
      for (const [subj, items] of Object.entries(grouped)) {
        const label = subj === "owner" ? "About the owner" : `About ${subj}`;
        const lines = items!.map((b) => {
          const stabilityTag = b.stability >= 3.0 ? " [well-established]" : b.stability >= 2.0 ? " [established]" : "";
          return `  - [${b.type}|${b.confidence.toFixed(1)}] ${b.statement}${stabilityTag}`;
        }).join("\n");
        sections.push(`**${label}:**\n${lines}`);
      }
      beliefSection = sections.join("\n");
    }
  }

  const episodeSection = episodes.length > 0
    ? episodes.map((e) => `- [${e.timestamp}] ${e.action}`).join("\n")
    : "No recent observations.";

  return `## Relevant beliefs\n${beliefSection}\n\n## Recent observations\n${episodeSection}`;
}

// ---- Unified Retrieval ----

export interface UnifiedRetrievalResult {
  beliefs: Array<{ statement: string; confidence: number; type: string; stability: number; subject: string; score: number }>;
  knowledge: Array<{ content: string; sourceTitle: string | null; sourceUrl: string; score: number }>;
  formatted: string;
}

/**
 * Unified retrieval across beliefs and knowledge with a single embedding call.
 * Returns combined context from memory beliefs, knowledge chunks, and recent episodes.
 */
export async function retrieveContext(
  storage: Storage,
  query: string,
  options?: { llm?: LLMClient; beliefLimit?: number; knowledgeLimit?: number; episodeLimit?: number },
): Promise<UnifiedRetrievalResult> {
  const beliefLimit = options?.beliefLimit ?? 8;
  const knowledgeLimit = options?.knowledgeLimit ?? 5;
  const episodeLimit = options?.episodeLimit ?? 5;

  let beliefs: UnifiedRetrievalResult["beliefs"] = [];
  let knowledge: UnifiedRetrievalResult["knowledge"] = [];
  let episodes: Array<{ action: string; timestamp: string }> = [];

  // One embedding call, shared across belief + knowledge search
  let queryEmbedding: number[] | undefined;
  if (options?.llm) {
    try {
      const result = await options.llm.embed(query);
      queryEmbedding = result.embedding;
    } catch {
      // Fall through to FTS-only paths
    }
  }

  // --- Beliefs ---
  if (queryEmbedding) {
    const similar = semanticSearch(storage, queryEmbedding, beliefLimit, query);
    beliefs = similar.map((s) => {
      const row = storage.query<{ stability: number; subject: string }>(
        "SELECT stability, subject FROM beliefs WHERE id = ?", [s.beliefId],
      )[0];
      return {
        statement: s.statement, confidence: s.confidence, type: s.type,
        stability: row?.stability ?? 1.0, subject: row?.subject ?? "owner",
        score: s.similarity,
      };
    });
    episodes = findSimilarEpisodes(storage, queryEmbedding, episodeLimit)
      .filter((s) => s.similarity > 0.3)
      .map((s) => ({ action: s.action, timestamp: s.timestamp }));
  }
  // FTS fallback
  if (beliefs.length === 0) {
    beliefs = searchBeliefs(storage, query, beliefLimit).map((b) => ({
      statement: b.statement, confidence: b.confidence, type: b.type,
      stability: b.stability ?? 1.0, subject: b.subject ?? "owner", score: 0.5,
    }));
  }
  if (episodes.length === 0) {
    episodes = listEpisodes(storage, episodeLimit);
  }

  // --- Knowledge ---
  if (options?.llm && knowledgeLimit > 0) {
    try {
      const kResults = await knowledgeSearch(storage, options.llm, query, knowledgeLimit, { queryEmbedding });
      knowledge = kResults.map((r: KnowledgeSearchResult) => ({
        content: r.chunk.content,
        sourceTitle: r.source.title,
        sourceUrl: r.source.url,
        score: r.score,
      }));
    } catch {
      // Knowledge search failed — continue without
    }
  }

  // --- Format ---
  beliefs.sort((a, b) => b.confidence - a.confidence);
  const formatted = formatUnifiedContext(beliefs, knowledge, episodes);

  return { beliefs, knowledge, formatted };
}

function formatUnifiedContext(
  beliefs: UnifiedRetrievalResult["beliefs"],
  knowledge: UnifiedRetrievalResult["knowledge"],
  episodes: Array<{ action: string; timestamp: string }>,
): string {
  const sections: string[] = [];

  // Beliefs section
  if (beliefs.length > 0) {
    const lines = beliefs.map((b) => {
      const stabilityTag = b.stability >= 3.0 ? " [well-established]" : b.stability >= 2.0 ? " [established]" : "";
      const subj = b.subject && b.subject !== "owner" ? ` [about: ${b.subject}]` : "";
      return `- [${b.type}|${b.confidence.toFixed(1)}]${subj} ${b.statement}${stabilityTag}`;
    }).join("\n");
    sections.push(`## Relevant beliefs\n${lines}`);
  } else {
    sections.push("## Relevant beliefs\nNo relevant beliefs found.");
  }

  // Knowledge section
  if (knowledge.length > 0) {
    const lines = knowledge.map((k) => {
      const pct = Math.round(k.score * 100);
      const src = k.sourceTitle ?? k.sourceUrl;
      const snippet = k.content.length > 300 ? k.content.slice(0, 300) + "…" : k.content;
      return `- [knowledge|${pct}%] (${src}) ${snippet}`;
    }).join("\n");
    sections.push(`## Knowledge base\n${lines}`);
  }

  // Episodes section
  if (episodes.length > 0) {
    const lines = episodes.map((e) => `- [${e.timestamp}] ${e.action}`).join("\n");
    sections.push(`## Recent observations\n${lines}`);
  }

  return sections.join("\n\n");
}

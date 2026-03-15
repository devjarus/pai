import type { Storage } from "@personal-ai/core";

export type LibrarySourceType = "memory" | "document" | "finding";

export interface LibrarySearchResult {
  id: string;
  sourceType: LibrarySourceType;
  title: string;
  snippet: string;
  score: number;
  createdAt: string;
  meta?: Record<string, unknown>;
}

interface BeliefFtsRow {
  id: string;
  statement: string;
  confidence: number;
  created_at: string;
  rank: number;
}

interface KnowledgeFtsRow {
  id: string;
  content: string;
  source_title: string | null;
  source_url: string;
  created_at: string;
  rank: number;
}

interface FindingFtsRow {
  id: string;
  summary: string;
  goal: string;
  domain: string;
  confidence: number;
  created_at: string;
  rank: number;
}

function buildFtsQuery(query: string): string {
  const words = query.split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  return words.map((w) => `"${w}"`).join(" OR ");
}

export function unifiedSearch(
  storage: Storage,
  query: string,
  limit = 20,
): LibrarySearchResult[] {
  const ftsQuery = buildFtsQuery(query);
  if (!ftsQuery) return [];

  const results: LibrarySearchResult[] = [];

  // Search beliefs (memories)
  try {
    const beliefs = storage.query<BeliefFtsRow>(
      `SELECT b.id, b.statement, b.confidence, b.created_at, fts.rank
       FROM beliefs b
       JOIN beliefs_fts fts ON b.rowid = fts.rowid
       WHERE beliefs_fts MATCH ? AND b.status = 'active'
       ORDER BY fts.rank`,
      [ftsQuery],
    );
    for (const row of beliefs) {
      results.push({
        id: row.id,
        sourceType: "memory",
        title: row.statement.slice(0, 80),
        snippet: row.statement,
        score: -row.rank, // FTS5 rank is negative; negate for sorting
        createdAt: row.created_at,
        meta: { confidence: row.confidence },
      });
    }
  } catch {
    // beliefs_fts may not exist in minimal setups
  }

  // Search knowledge chunks (documents)
  try {
    const chunks = storage.query<KnowledgeFtsRow>(
      `SELECT kc.id, kc.content, ks.title AS source_title, ks.url AS source_url, kc.created_at, fts.rank
       FROM knowledge_chunks kc
       JOIN knowledge_chunks_fts fts ON kc.rowid = fts.rowid
       JOIN knowledge_sources ks ON kc.source_id = ks.id
       WHERE knowledge_chunks_fts MATCH ?
       ORDER BY fts.rank`,
      [ftsQuery],
    );
    for (const row of chunks) {
      results.push({
        id: row.id,
        sourceType: "document",
        title: row.source_title ?? row.source_url,
        snippet: row.content.slice(0, 200),
        score: -row.rank,
        createdAt: row.created_at,
        meta: { sourceUrl: row.source_url },
      });
    }
  } catch {
    // knowledge_chunks_fts may not exist
  }

  // Search research findings
  try {
    const findings = storage.query<FindingFtsRow>(
      `SELECT rf.id, rf.summary, rf.goal, rf.domain, rf.confidence, rf.created_at, fts.rank
       FROM research_findings rf
       JOIN research_findings_fts fts ON rf.rowid = fts.rowid
       WHERE research_findings_fts MATCH ?
       ORDER BY fts.rank`,
      [ftsQuery],
    );
    for (const row of findings) {
      results.push({
        id: row.id,
        sourceType: "finding",
        title: row.goal,
        snippet: row.summary,
        score: -row.rank,
        createdAt: row.created_at,
        meta: { domain: row.domain, confidence: row.confidence },
      });
    }
  } catch {
    // research_findings_fts may not exist
  }

  // Sort by score descending and return top N
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

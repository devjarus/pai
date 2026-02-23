import type { Storage, Migration, LLMClient } from "./types.js";
import { nanoid } from "nanoid";

// ---- Schema ----

export const knowledgeMigrations: Migration[] = [
  {
    version: 1,
    up: `
      CREATE TABLE IF NOT EXISTS knowledge_sources (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL UNIQUE,
        title TEXT,
        fetched_at TEXT NOT NULL,
        chunk_count INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS knowledge_chunks (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        embedding TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_chunks_source ON knowledge_chunks(source_id);
    `,
  },
  {
    version: 2,
    up: `
      CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunks_fts USING fts5(content, content=knowledge_chunks, content_rowid=rowid);
      CREATE TRIGGER knowledge_chunks_ai AFTER INSERT ON knowledge_chunks BEGIN
        INSERT INTO knowledge_chunks_fts(rowid, content) VALUES (new.rowid, new.content);
      END;
      CREATE TRIGGER knowledge_chunks_ad AFTER DELETE ON knowledge_chunks BEGIN
        INSERT INTO knowledge_chunks_fts(knowledge_chunks_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
      END;
      CREATE TRIGGER knowledge_chunks_au AFTER UPDATE ON knowledge_chunks BEGIN
        INSERT INTO knowledge_chunks_fts(knowledge_chunks_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
        INSERT INTO knowledge_chunks_fts(rowid, content) VALUES (new.rowid, new.content);
      END;
      INSERT INTO knowledge_chunks_fts(rowid, content) SELECT rowid, content FROM knowledge_chunks;
    `,
  },
  {
    version: 3,
    up: `ALTER TABLE knowledge_sources ADD COLUMN tags TEXT;`,
  },
];

// ---- Types ----

export interface KnowledgeSource {
  id: string;
  url: string;
  title: string | null;
  fetched_at: string;
  chunk_count: number;
  tags: string | null;
}

export interface KnowledgeChunk {
  id: string;
  source_id: string;
  content: string;
  chunk_index: number;
  embedding: number[] | null;
  created_at: string;
}

export interface KnowledgeSearchResult {
  chunk: KnowledgeChunk;
  source: KnowledgeSource;
  score: number;
}

// ---- Chunking ----

/**
 * Split markdown content into chunks of approximately `targetWords` words.
 * Splits on paragraph boundaries (double newline) to keep chunks coherent.
 */
export function chunkContent(markdown: string, targetWords = 500): string[] {
  const paragraphs = markdown.split(/\n{2,}/);
  const chunks: string[] = [];
  let current: string[] = [];
  let currentWords = 0;

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    const paraWords = trimmed.split(/\s+/).length;

    if (currentWords > 0 && currentWords + paraWords > targetWords) {
      chunks.push(current.join("\n\n"));
      current = [trimmed];
      currentWords = paraWords;
    } else {
      current.push(trimmed);
      currentWords += paraWords;
    }
  }

  if (current.length > 0) {
    chunks.push(current.join("\n\n"));
  }

  return chunks;
}

// ---- Storage operations ----

/** Check if a URL has already been learned */
export function hasSource(storage: Storage, url: string): KnowledgeSource | null {
  const rows = storage.query<KnowledgeSource>(
    "SELECT * FROM knowledge_sources WHERE url = ?",
    [normalizeUrl(url)],
  );
  return rows[0] ?? null;
}

/** List all learned sources */
export function listSources(storage: Storage): KnowledgeSource[] {
  return storage.query<KnowledgeSource>(
    "SELECT * FROM knowledge_sources ORDER BY fetched_at DESC",
  );
}

/** Normalize URL for dedup (strip trailing slash, fragment, common tracking params) */
function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    // Remove common tracking params
    for (const p of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "ref"]) {
      u.searchParams.delete(p);
    }
    // Remove trailing slash
    u.pathname = u.pathname.replace(/\/+$/, "") || "/";
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Store a learned URL with its chunks and embeddings.
 * Returns the source record. Skips if URL already exists.
 */
export async function learnFromContent(
  storage: Storage,
  llm: LLMClient,
  url: string,
  title: string,
  markdown: string,
  options?: { force?: boolean; tags?: string },
): Promise<{ source: KnowledgeSource; chunksStored: number; skipped: boolean }> {
  const normalizedUrl = normalizeUrl(url);

  // Dedup check
  const existing = hasSource(storage, normalizedUrl);
  if (existing) {
    if (!options?.force) {
      return { source: existing, chunksStored: 0, skipped: true };
    }
    // Force re-learn: delete old source and chunks first
    forgetSource(storage, existing.id);
  }

  const chunks = chunkContent(markdown);
  const domain = new URL(normalizedUrl).hostname;
  const contextualChunks = chunks.map((chunk) =>
    `# ${title}\nSource: ${domain}\n\n${chunk}`
  );
  const sourceId = nanoid();
  const now = new Date().toISOString();

  // Store source
  storage.run(
    "INSERT INTO knowledge_sources (id, url, title, fetched_at, chunk_count, tags) VALUES (?, ?, ?, ?, ?, ?)",
    [sourceId, normalizedUrl, title, now, contextualChunks.length, options?.tags ?? null],
  );

  // Embed and store chunks
  let stored = 0;
  for (let i = 0; i < contextualChunks.length; i++) {
    const chunk = contextualChunks[i]!;
    const chunkId = nanoid();

    let embedding: number[] | null = null;
    try {
      const result = await llm.embed(chunk);
      embedding = result.embedding;
    } catch {
      // Continue without embedding — search will skip this chunk
    }

    storage.run(
      "INSERT INTO knowledge_chunks (id, source_id, content, chunk_index, embedding, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [chunkId, sourceId, chunk, i, embedding ? JSON.stringify(embedding) : null, now],
    );
    stored++;
  }

  const source = storage.query<KnowledgeSource>(
    "SELECT * FROM knowledge_sources WHERE id = ?",
    [sourceId],
  )[0]!;

  return { source, chunksStored: stored, skipped: false };
}

// ---- FTS5 search ----

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

/** Full-text search over knowledge chunks (FTS5) */
export function searchKnowledgeFTS(storage: Storage, query: string, limit = 10): KnowledgeChunk[] {
  const words = query
    .replace(FTS5_OPERATORS, "")
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !STOP_WORDS.has(w.toLowerCase()));
  const sanitized = words.map((w) => `"${w}"`).join(" OR ");
  if (!sanitized) return [];
  return storage.query<KnowledgeChunk>(
    `SELECT kc.* FROM knowledge_chunks kc
     JOIN knowledge_chunks_fts fts ON kc.rowid = fts.rowid
     WHERE knowledge_chunks_fts MATCH ? ORDER BY rank LIMIT ?`,
    [sanitized, limit],
  ).map((row) => ({
    ...row,
    embedding: row.embedding ? (JSON.parse(row.embedding as unknown as string) as number[]) : null,
  }));
}

/** Attach source metadata to scored chunks */
function attachSources(
  storage: Storage,
  scored: Array<{ chunk: KnowledgeChunk; score: number }>,
): KnowledgeSearchResult[] {
  const sourceIds = [...new Set(scored.map((s) => s.chunk.source_id))];
  const sources = new Map<string, KnowledgeSource>();
  for (const sid of sourceIds) {
    const source = storage.query<KnowledgeSource>(
      "SELECT * FROM knowledge_sources WHERE id = ?",
      [sid],
    )[0];
    if (source) sources.set(sid, source);
  }
  return scored
    .filter((s) => sources.has(s.chunk.source_id))
    .map((s) => ({
      chunk: s.chunk,
      source: sources.get(s.chunk.source_id)!,
      score: s.score,
    }));
}

/** Find sources whose title or tags match the query */
function findMatchingSources(storage: Storage, query: string): KnowledgeSource[] {
  const words = query
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !STOP_WORDS.has(w.toLowerCase()));
  if (words.length === 0) return [];

  const conditions = words.map(() => "(LOWER(title) LIKE ? OR LOWER(tags) LIKE ?)").join(" OR ");
  const params = words.flatMap((w) => {
    const pattern = `%${w.toLowerCase()}%`;
    return [pattern, pattern];
  });
  return storage.query<KnowledgeSource>(
    `SELECT * FROM knowledge_sources WHERE ${conditions}`, params,
  );
}

/** Semantic search over knowledge chunks with FTS prefilter */
export async function knowledgeSearch(
  storage: Storage,
  llm: LLMClient,
  query: string,
  limit = 5,
  options?: { queryEmbedding?: number[] },
): Promise<KnowledgeSearchResult[]> {
  // Phase 1: FTS prefilter — get candidate chunk IDs
  const ftsCandidates = searchKnowledgeFTS(storage, query, limit * 10);
  const ftsIds = new Set(ftsCandidates.map((c) => c.id));

  // Phase 1b: Source-level matching — find sources by title/tags and add their chunks
  const matchingSources = findMatchingSources(storage, query);
  const matchingSourceIds = new Set(matchingSources.map((s) => s.id));
  for (const source of matchingSources) {
    const chunks = storage.query<KnowledgeChunk & { embedding: string | null }>(
      "SELECT * FROM knowledge_chunks WHERE source_id = ?", [source.id],
    ).map((row) => ({
      ...row,
      embedding: row.embedding ? JSON.parse(row.embedding) as number[] : null,
    }));
    for (const chunk of chunks) {
      if (!ftsIds.has(chunk.id)) {
        ftsCandidates.push(chunk);
        ftsIds.add(chunk.id);
      }
    }
  }

  // Phase 2: Embed query (skip if pre-computed)
  let queryEmbedding = options?.queryEmbedding;
  if (!queryEmbedding) {
    try {
      const result = await llm.embed(query);
      queryEmbedding = result.embedding;
    } catch {
      // Embedding failed — return FTS-only results with score 0.5
      if (ftsCandidates.length > 0) {
        const scored = ftsCandidates.slice(0, limit).map((chunk) => ({ chunk, score: 0.5 }));
        return attachSources(storage, scored);
      }
      return [];
    }
  }

  // Phase 3: Score candidates by cosine similarity
  let scored: Array<{ chunk: KnowledgeChunk; score: number }> = [];

  const COSINE_THRESHOLD = 0.5;
  // Chunks from sources matched by title/tags get a score boost
  const SOURCE_MATCH_BOOST = 0.15;

  if (ftsIds.size > 0) {
    // Score only FTS candidates
    for (const chunk of ftsCandidates) {
      if (!chunk.embedding) continue;
      const embedding = Array.isArray(chunk.embedding) ? chunk.embedding : JSON.parse(chunk.embedding as unknown as string) as number[];
      let sim = cosineSimilarity(queryEmbedding, embedding);
      if (matchingSourceIds.has(chunk.source_id)) sim += SOURCE_MATCH_BOOST;
      if (sim >= COSINE_THRESHOLD) {
        scored.push({ chunk: { ...chunk, embedding }, score: sim });
      }
    }
  }

  // If FTS found nothing, fall back to full scan (preserves current behavior for purely semantic queries)
  if (ftsIds.size === 0) {
    const rows = storage.query<{
      id: string; source_id: string; content: string;
      chunk_index: number; embedding: string; created_at: string;
    }>("SELECT * FROM knowledge_chunks WHERE embedding IS NOT NULL");

    for (const row of rows) {
      const embedding = JSON.parse(row.embedding) as number[];
      let sim = cosineSimilarity(queryEmbedding, embedding);
      if (matchingSourceIds.has(row.source_id)) sim += SOURCE_MATCH_BOOST;
      if (sim >= COSINE_THRESHOLD) {
        scored.push({ chunk: { ...row, embedding }, score: sim });
      }
    }
  }

  scored.sort((a, b) => b.score - a.score);

  // Source diversity: cap chunks per source only when results span 3+ sources
  // (if few sources match, user likely wants depth from those sources)
  const uniqueSources = new Set(scored.map((s) => s.chunk.source_id));
  if (uniqueSources.size >= 3) {
    const perSource: Record<string, number> = {};
    const diverse: typeof scored = [];
    for (const item of scored) {
      const sid = item.chunk.source_id;
      perSource[sid] = (perSource[sid] ?? 0) + 1;
      if (perSource[sid] <= 2) diverse.push(item);
      if (diverse.length >= limit) break;
    }
    return attachSources(storage, diverse);
  }

  return attachSources(storage, scored.slice(0, limit));
}

/** Get chunks for a source */
export function getSourceChunks(storage: Storage, sourceId: string): KnowledgeChunk[] {
  return storage.query<KnowledgeChunk & { embedding: string | null }>(
    "SELECT id, source_id, content, chunk_index, created_at FROM knowledge_chunks WHERE source_id = ? ORDER BY chunk_index",
    [sourceId],
  ).map((row) => ({ ...row, embedding: null }));
}

/** Delete a source and all its chunks */
export function forgetSource(storage: Storage, sourceId: string): boolean {
  const source = storage.query<KnowledgeSource>(
    "SELECT * FROM knowledge_sources WHERE id = ?",
    [sourceId],
  )[0];
  if (!source) return false;

  storage.run("DELETE FROM knowledge_chunks WHERE source_id = ?", [sourceId]);
  storage.run("DELETE FROM knowledge_sources WHERE id = ?", [sourceId]);
  return true;
}

// ---- Re-indexing ----

/** Strip contextual header (# title\nSource: domain\n\n) from chunk content */
export function stripChunkHeader(content: string): string {
  return content.replace(/^# .+\nSource: .+\n\n/, "");
}

/**
 * Re-index a single source: strip old headers, re-chunk, prepend fresh headers, re-embed.
 * Returns number of new chunks stored.
 */
export async function reindexSource(
  storage: Storage, llm: LLMClient, sourceId: string,
): Promise<number> {
  const source = storage.query<KnowledgeSource>(
    "SELECT * FROM knowledge_sources WHERE id = ?", [sourceId],
  )[0];
  if (!source) throw new Error(`Source not found: ${sourceId}`);

  // Get existing chunks ordered by index
  const oldChunks = storage.query<KnowledgeChunk>(
    "SELECT * FROM knowledge_chunks WHERE source_id = ? ORDER BY chunk_index",
    [sourceId],
  );

  // Strip headers and reconstruct markdown
  const markdown = oldChunks.map((c) => stripChunkHeader(c.content)).join("\n\n");

  // Re-chunk and prepend contextual headers
  const chunks = chunkContent(markdown);
  const domain = new URL(source.url).hostname;
  const title = source.title ?? "Untitled";
  const contextualChunks = chunks.map((chunk) =>
    `# ${title}\nSource: ${domain}\n\n${chunk}`
  );

  // Delete old chunks
  storage.run("DELETE FROM knowledge_chunks WHERE source_id = ?", [sourceId]);

  // Insert new chunks with fresh embeddings
  const now = new Date().toISOString();
  for (let i = 0; i < contextualChunks.length; i++) {
    const chunk = contextualChunks[i]!;
    const chunkId = nanoid();
    let embedding: number[] | null = null;
    try {
      const result = await llm.embed(chunk);
      embedding = result.embedding;
    } catch {
      // Continue without embedding
    }
    storage.run(
      "INSERT INTO knowledge_chunks (id, source_id, content, chunk_index, embedding, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [chunkId, sourceId, chunk, i, embedding ? JSON.stringify(embedding) : null, now],
    );
  }

  // Update chunk count
  storage.run("UPDATE knowledge_sources SET chunk_count = ? WHERE id = ?", [contextualChunks.length, sourceId]);

  return contextualChunks.length;
}

/**
 * Re-index all sources with contextual chunk headers.
 * Returns total number of sources re-indexed.
 */
export async function reindexAllSources(
  storage: Storage, llm: LLMClient,
): Promise<number> {
  const sources = listSources(storage);
  let count = 0;
  for (const source of sources) {
    await reindexSource(storage, llm, source.id);
    count++;
  }
  return count;
}

// ---- Helpers ----

function cosineSimilarity(a: number[], b: number[]): number {
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

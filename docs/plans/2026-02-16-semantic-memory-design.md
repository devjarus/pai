# Semantic Memory with Embeddings

**Date:** 2026-02-16
**Status:** Approved

## Problem

The memory system has three quality issues:

1. **Belief quality** — LLM extracts vague generalized lessons instead of preserving what the user said. "I like coffee in the morning" becomes "Starting your day with a consistent habit can provide a sense of routine."
2. **Recall quality** — FTS5 with OR semantics is too loose. Searching "coffee" misses the belief because the word was abstracted away.
3. **Duplicate beliefs** — Similar beliefs pile up. Dedup only checks top 3 FTS5 matches, missing semantic duplicates.

## Design

### 1. Belief Types (fact + insight)

Add `type` column to beliefs: `fact` (preserves what user said) vs `insight` (LLM inference).

Extraction prompt produces structured JSON with both:
```json
{ "fact": "User likes coffee in the morning", "insight": "Morning routines provide consistency" }
```

Both stored as separate beliefs linked to the same episode. Recall works on exact terms (fact) AND concepts (insight).

### 2. Embeddings via Ollama

Store embedding vectors per belief using Ollama's `nomic-embed-text` model (or equivalent). Vectors stored as JSON arrays in SQLite — no vector DB needed.

Add `embed(text): Promise<number[]>` to `LLMClient` interface. Implement using Vercel AI SDK's `embed()` with the Ollama provider (already a dependency).

Works with both local Ollama and Ollama Cloud.

### 3. Semantic Search

Replace FTS5-only search with cosine similarity on embeddings for dedup and recall. FTS5 kept as keyword fallback.

Cosine similarity computed in JS:
```typescript
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
```

All embeddings loaded into memory for comparison (fine for single-user scale, thousands of beliefs).

### 4. Smart Dedup/Merge

During `remember()`:
1. Embed the new belief statement
2. Find top 5 beliefs by cosine similarity
3. If similarity > 0.85 — LLM confirms merge, update statement + boost confidence
4. If similarity 0.5-0.85 — check for contradiction (existing flow)
5. If similarity < 0.5 — create new belief

### Schema (Migration 3)

```sql
ALTER TABLE beliefs ADD COLUMN type TEXT NOT NULL DEFAULT 'insight';
CREATE TABLE belief_embeddings (
  belief_id TEXT PRIMARY KEY REFERENCES beliefs(id),
  embedding TEXT NOT NULL
);
```

### Files to Modify

- `packages/core/src/types.ts` — add `embed()` to `LLMClient`
- `packages/core/src/llm.ts` — implement `embed()` using Vercel AI SDK
- `packages/core/test/llm.test.ts` — test embed function
- `packages/plugin-memory/src/memory.ts` — embedding storage, cosine similarity, semantic search
- `packages/plugin-memory/src/remember.ts` — dual extraction (fact+insight), semantic dedup/merge
- `packages/plugin-memory/src/index.ts` — migration 3, updated commands
- `packages/plugin-memory/test/memory.test.ts` — embedding and semantic search tests
- `packages/plugin-memory/test/remember.test.ts` — dual extraction, merge flow tests

### What Stays the Same

- FTS5 kept as keyword fallback for `recall` command
- Confidence decay formula unchanged
- Change tracking / audit trail unchanged
- Context packing interface unchanged (returns same markdown format)
- CLI command interface unchanged — same commands, better results
- `getMemoryContext()` export unchanged for cross-plugin use

### Configuration

Embedding model configurable via `PAI_LLM_EMBED_MODEL` env var, default `nomic-embed-text`. Uses same provider/base URL as chat model.

## Risks

- **Cold start:** First run needs to pull `nomic-embed-text` (~274MB). Ollama Cloud avoids this.
- **Performance:** Cosine similarity over all beliefs is O(n). Fine for thousands, not millions. Single-user scale is well within bounds.
- **Embedding model mismatch:** If user changes embedding model, old vectors are incompatible. Would need re-embedding (future concern).

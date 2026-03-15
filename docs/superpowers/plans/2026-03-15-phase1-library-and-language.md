# Phase 1: Library & Language — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a unified Library domain by merging memory + knowledge + curator, add ResearchFinding entity, build unified search, rename all user-facing language, and scaffold the agent harness.

**Architecture:** The `library` package wraps existing memory and knowledge modules under a unified API. No table renames — internal schemas stay as-is. A presentation layer maps internal names (belief, briefing, scheduled_job) to user-facing names (memory, digest, watch). The agent harness is a lightweight wrapper around Vercel AI SDK.

**Tech Stack:** TypeScript 5.7+, better-sqlite3, Vitest, Fastify 5, React 19, TanStack Query, Vercel AI SDK 6

**Spec:** `docs/superpowers/specs/2026-03-15-four-pillars-roadmap-design.md`

---

## Chunk 1: Library Package — Core Structure

### Task 1: Scaffold the `library` package

**Files:**
- Create: `packages/library/package.json`
- Create: `packages/library/tsconfig.json`
- Create: `packages/library/src/index.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@personal-ai/library",
  "version": "0.1.0",
  "description": "Unified knowledge layer: memories, documents, findings",
  "license": "MIT",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@personal-ai/core": "workspace:*"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

Follow the same pattern as `packages/core/tsconfig.json`. Extend from root if one exists, otherwise create standalone with `"module": "NodeNext"`, `"target": "ES2022"`, `"strict": true`.

- [ ] **Step 3: Create src/index.ts with re-exports**

This is the unified public API. It re-exports from memories, documents, findings, search, and curator submodules. Start with a stub:

```typescript
// Unified Library API
// Memories (re-exported from core memory module)
export { listBeliefs, searchBeliefs, semanticSearch, forgetBelief, correctBelief, memoryStats, remember, rememberStructured, getMemoryContext, retrieveContext, getBeliefHistory, listBeliefProvenance } from "@personal-ai/core";
export type { Belief, BeliefChange, MemoryStats, RememberOptions } from "@personal-ai/core";

// Documents (re-exported from core knowledge module)
export { listSources, getSourceChunks, learnFromContent, knowledgeSearch, forgetSource, cleanupExpiredSources } from "@personal-ai/core";
export type { KnowledgeSource, KnowledgeChunk, KnowledgeSearchResult } from "@personal-ai/core";

// Findings (new — will be implemented in Task 3)
// export { ... } from "./findings.js";

// Unified search (new — will be implemented in Task 5)
// export { unifiedSearch } from "./search.js";
```

- [ ] **Step 4: Create vitest.config.ts**

Follow the same pattern as `packages/core/vitest.config.ts`. Minimal config:

```typescript
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { globals: false } });
```

- [ ] **Step 5: Run pnpm install to link workspace package**

Run: `pnpm install`

Note: The workspace file `pnpm-workspace.yaml` uses `packages: ["packages/*"]` so the new library package is auto-discovered.

- [ ] **Step 6: Verify build**

Run: `cd packages/library && pnpm build`
Expected: Successful compilation with no errors

- [ ] **Step 7: Commit**

```bash
git add packages/library/
git commit -m "feat(library): scaffold library package with re-exports from core"
```

---

### Task 2: Add ResearchFinding types and migration

**Files:**
- Create: `packages/library/src/findings.ts`
- Create: `packages/library/test/findings.test.ts`

- [ ] **Step 1: Write the failing test for findings CRUD**

```typescript
// packages/library/test/findings.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { createStorage } from "@personal-ai/core";
import { findingsMigrations, createFinding, getFinding, listFindings, listFindingsForWatch, deleteFinding } from "../src/findings.js";

describe("findings", () => {
  let storage: ReturnType<typeof createStorage>;

  beforeEach(() => {
    storage = createStorage(":memory:", [...findingsMigrations]);
  });

  it("creates and retrieves a finding", () => {
    const finding = createFinding(storage, {
      goal: "Find cheapest GPU",
      domain: "general",
      summary: "RTX 4090 is $1599 on Newegg",
      confidence: 0.85,
      agentName: "Researcher",
      depthLevel: "standard",
      sources: [{ url: "https://newegg.com", title: "Newegg", fetchedAt: new Date().toISOString(), relevance: 0.9 }],
    });
    expect(finding.id).toBeTruthy();
    expect(finding.summary).toBe("RTX 4090 is $1599 on Newegg");

    const retrieved = getFinding(storage, finding.id);
    expect(retrieved).toEqual(finding);
  });

  it("lists findings filtered by watch", () => {
    createFinding(storage, { goal: "GPU prices", domain: "general", summary: "Finding 1", confidence: 0.8, agentName: "Researcher", depthLevel: "quick", sources: [], watchId: "watch-1" });
    createFinding(storage, { goal: "Flight deals", domain: "flight", summary: "Finding 2", confidence: 0.7, agentName: "FlightScout", depthLevel: "standard", sources: [] });

    const all = listFindings(storage);
    expect(all).toHaveLength(2);

    const forWatch = listFindingsForWatch(storage, "watch-1");
    expect(forWatch).toHaveLength(1);
    expect(forWatch[0].summary).toBe("Finding 1");
  });

  it("deletes a finding", () => {
    const finding = createFinding(storage, { goal: "test", domain: "general", summary: "to delete", confidence: 0.5, agentName: "test", depthLevel: "quick", sources: [] });
    deleteFinding(storage, finding.id);
    expect(getFinding(storage, finding.id)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/library && pnpm test`
Expected: FAIL — module `../src/findings.js` not found

- [ ] **Step 3: Implement findings module**

```typescript
// packages/library/src/findings.ts
import type { Storage, Migration } from "@personal-ai/core";
import { nanoid } from "nanoid";

export interface ResearchFindingSource {
  url: string;
  title: string;
  fetchedAt: string;
  relevance: number;
}

export interface ResearchFinding {
  id: string;
  watchId?: string;
  digestId?: string;
  goal: string;
  domain: string;
  summary: string;
  structuredData?: Record<string, unknown>;
  sources: ResearchFindingSource[];
  confidence: number;
  agentName: string;
  depthLevel: "quick" | "standard" | "deep";
  previousFindingId?: string;
  delta?: { changed: string[]; significance: number };
  createdAt: string;
  updatedAt: string;
}

export interface CreateFindingInput {
  goal: string;
  domain: string;
  summary: string;
  confidence: number;
  agentName: string;
  depthLevel: "quick" | "standard" | "deep";
  sources: ResearchFindingSource[];
  watchId?: string;
  digestId?: string;
  structuredData?: Record<string, unknown>;
  previousFindingId?: string;
  delta?: { changed: string[]; significance: number };
}

export const findingsMigrations: Migration[] = [
  {
    version: 1,
    up: `
      CREATE TABLE IF NOT EXISTS research_findings (
        id TEXT PRIMARY KEY,
        watch_id TEXT,
        digest_id TEXT,
        goal TEXT NOT NULL,
        domain TEXT NOT NULL DEFAULT 'general',
        summary TEXT NOT NULL,
        structured_data TEXT,
        sources TEXT NOT NULL DEFAULT '[]',
        confidence REAL NOT NULL DEFAULT 0.7,
        agent_name TEXT NOT NULL,
        depth_level TEXT NOT NULL DEFAULT 'standard',
        previous_finding_id TEXT,
        delta TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_findings_watch ON research_findings(watch_id);
      CREATE INDEX IF NOT EXISTS idx_findings_domain ON research_findings(domain);
      CREATE VIRTUAL TABLE IF NOT EXISTS research_findings_fts USING fts5(summary, content=research_findings, content_rowid=rowid);
      CREATE TRIGGER research_findings_ai AFTER INSERT ON research_findings BEGIN
        INSERT INTO research_findings_fts(rowid, summary) VALUES (new.rowid, new.summary);
      END;
      CREATE TRIGGER research_findings_ad AFTER DELETE ON research_findings BEGIN
        INSERT INTO research_findings_fts(research_findings_fts, rowid, summary) VALUES ('delete', old.rowid, old.summary);
      END;
      CREATE TRIGGER research_findings_au AFTER UPDATE ON research_findings BEGIN
        INSERT INTO research_findings_fts(research_findings_fts, rowid, summary) VALUES ('delete', old.rowid, old.summary);
        INSERT INTO research_findings_fts(rowid, summary) VALUES (new.rowid, new.summary);
      END;
    `,
  },
];

function rowToFinding(row: Record<string, unknown>): ResearchFinding {
  return {
    id: row.id as string,
    watchId: (row.watch_id as string) || undefined,
    digestId: (row.digest_id as string) || undefined,
    goal: row.goal as string,
    domain: row.domain as string,
    summary: row.summary as string,
    structuredData: row.structured_data ? JSON.parse(row.structured_data as string) : undefined,
    sources: JSON.parse((row.sources as string) || "[]"),
    confidence: row.confidence as number,
    agentName: row.agent_name as string,
    depthLevel: row.depth_level as ResearchFinding["depthLevel"],
    previousFindingId: (row.previous_finding_id as string) || undefined,
    delta: row.delta ? JSON.parse(row.delta as string) : undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function createFinding(storage: Storage, input: CreateFindingInput): ResearchFinding {
  const id = nanoid();
  const now = new Date().toISOString();
  storage.db.prepare(`
    INSERT INTO research_findings (id, watch_id, digest_id, goal, domain, summary, structured_data, sources, confidence, agent_name, depth_level, previous_finding_id, delta, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.watchId ?? null,
    input.digestId ?? null,
    input.goal,
    input.domain,
    input.summary,
    input.structuredData ? JSON.stringify(input.structuredData) : null,
    JSON.stringify(input.sources),
    input.confidence,
    input.agentName,
    input.depthLevel,
    input.previousFindingId ?? null,
    input.delta ? JSON.stringify(input.delta) : null,
    now,
    now,
  );
  return getFinding(storage, id)!;
}

export function getFinding(storage: Storage, id: string): ResearchFinding | undefined {
  const row = storage.db.prepare("SELECT * FROM research_findings WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? rowToFinding(row) : undefined;
}

export function listFindings(storage: Storage, limit = 50): ResearchFinding[] {
  const rows = storage.db.prepare("SELECT * FROM research_findings ORDER BY created_at DESC LIMIT ?").all(limit) as Record<string, unknown>[];
  return rows.map(rowToFinding);
}

export function listFindingsForWatch(storage: Storage, watchId: string): ResearchFinding[] {
  const rows = storage.db.prepare("SELECT * FROM research_findings WHERE watch_id = ? ORDER BY created_at DESC").all(watchId) as Record<string, unknown>[];
  return rows.map(rowToFinding);
}

export function deleteFinding(storage: Storage, id: string): void {
  storage.db.prepare("DELETE FROM research_findings WHERE id = ?").run(id);
}
```

- [ ] **Step 4: Add nanoid dependency to library package**

```bash
cd packages/library && pnpm add nanoid@^5.0.0
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/library && pnpm test`
Expected: All 3 tests PASS

- [ ] **Step 6: Export findings from library index**

Update `packages/library/src/index.ts` — uncomment the findings exports:

```typescript
// Findings
export { findingsMigrations, createFinding, getFinding, listFindings, listFindingsForWatch, deleteFinding } from "./findings.js";
export type { ResearchFinding, CreateFindingInput, ResearchFindingSource } from "./findings.js";
```

- [ ] **Step 7: Commit**

```bash
git add packages/library/
git commit -m "feat(library): add ResearchFinding entity with CRUD and FTS5"
```

---

### Task 3: Unified search across memories, documents, and findings

**Files:**
- Create: `packages/library/src/search.ts`
- Create: `packages/library/test/search.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/library/test/search.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { createStorage, memoryMigrations, knowledgeMigrations } from "@personal-ai/core";
import { findingsMigrations } from "../src/findings.js";
import { unifiedSearch } from "../src/search.js";
import type { Storage } from "@personal-ai/core";

describe("unifiedSearch", () => {
  let storage: Storage;

  beforeEach(() => {
    storage = createStorage(":memory:", [...memoryMigrations, ...knowledgeMigrations, ...findingsMigrations]);
  });

  it("returns results from all three sources", () => {
    // Insert a belief directly
    storage.db.prepare("INSERT INTO beliefs (id, statement, confidence, status, created_at, updated_at) VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))").run("b1", "User prefers window seats", 0.9, "active");

    // Insert a knowledge chunk directly
    storage.db.prepare("INSERT INTO knowledge_sources (id, url, title, fetched_at) VALUES (?, ?, ?, datetime('now'))").run("ks1", "https://example.com", "Example");
    storage.db.prepare("INSERT INTO knowledge_chunks (id, source_id, content, chunk_index, created_at) VALUES (?, ?, ?, ?, datetime('now'))").run("kc1", "ks1", "Window seats have better views on flights", 0);

    // Insert a finding directly
    storage.db.prepare("INSERT INTO research_findings (id, goal, domain, summary, sources, confidence, agent_name, depth_level, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))").run("f1", "seat preferences", "general", "Most travelers prefer window seats for scenery", "[]", 0.8, "Researcher", "standard");

    const results = unifiedSearch(storage, "window seats");
    expect(results.length).toBeGreaterThanOrEqual(1);
    // Each result should have a source type
    const sourceTypes = results.map(r => r.sourceType);
    expect(sourceTypes).toEqual(expect.arrayContaining(["memory"]));
  });

  it("returns empty for no matches", () => {
    const results = unifiedSearch(storage, "zzz_no_match_zzz");
    expect(results).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/library && pnpm test`
Expected: FAIL — module `../src/search.js` not found

- [ ] **Step 3: Implement unified search**

```typescript
// packages/library/src/search.ts
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

/**
 * Search across memories (beliefs), documents (knowledge chunks), and findings.
 * Uses FTS5 for text matching across all three tables.
 */
export function unifiedSearch(storage: Storage, query: string, limit = 20): LibrarySearchResult[] {
  const results: LibrarySearchResult[] = [];
  const ftsQuery = query.split(/\s+/).map(w => `"${w}"`).join(" OR ");

  // Search memories (beliefs FTS)
  try {
    const beliefs = storage.db.prepare(`
      SELECT b.id, b.statement, b.confidence, b.created_at, b.subject
      FROM beliefs b
      JOIN beliefs_fts fts ON b.rowid = fts.rowid
      WHERE beliefs_fts MATCH ? AND b.status = 'active'
      ORDER BY rank
      LIMIT ?
    `).all(ftsQuery, limit) as Array<Record<string, unknown>>;

    for (const row of beliefs) {
      results.push({
        id: row.id as string,
        sourceType: "memory",
        title: (row.subject as string) || "Memory",
        snippet: row.statement as string,
        score: row.confidence as number,
        createdAt: row.created_at as string,
        meta: { confidence: row.confidence },
      });
    }
  } catch { /* FTS table may not exist in minimal setups */ }

  // Search documents (knowledge chunks FTS)
  try {
    const chunks = storage.db.prepare(`
      SELECT kc.id, kc.content, kc.created_at, ks.title AS source_title, ks.url
      FROM knowledge_chunks kc
      JOIN knowledge_chunks_fts fts ON kc.rowid = fts.rowid
      JOIN knowledge_sources ks ON kc.source_id = ks.id
      WHERE knowledge_chunks_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(ftsQuery, limit) as Array<Record<string, unknown>>;

    for (const row of chunks) {
      results.push({
        id: row.id as string,
        sourceType: "document",
        title: (row.source_title as string) || "Document",
        snippet: (row.content as string).slice(0, 300),
        score: 0.5, // FTS rank-based, normalized later
        createdAt: row.created_at as string,
        meta: { url: row.url },
      });
    }
  } catch { /* FTS table may not exist */ }

  // Search findings (research findings FTS)
  try {
    const findings = storage.db.prepare(`
      SELECT rf.id, rf.summary, rf.confidence, rf.created_at, rf.domain, rf.agent_name
      FROM research_findings rf
      JOIN research_findings_fts fts ON rf.rowid = fts.rowid
      WHERE research_findings_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(ftsQuery, limit) as Array<Record<string, unknown>>;

    for (const row of findings) {
      results.push({
        id: row.id as string,
        sourceType: "finding",
        title: `${row.domain} research`,
        snippet: row.summary as string,
        score: row.confidence as number,
        createdAt: row.created_at as string,
        meta: { domain: row.domain, agentName: row.agent_name },
      });
    }
  } catch { /* FTS table may not exist */ }

  // Sort by score descending, take top N
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}
```

- [ ] **Step 4: Export from index**

Add to `packages/library/src/index.ts`:

```typescript
// Unified search
export { unifiedSearch } from "./search.js";
export type { LibrarySearchResult, LibrarySourceType } from "./search.js";
```

- [ ] **Step 5: Run tests**

Run: `cd packages/library && pnpm test`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/library/
git commit -m "feat(library): unified search across memories, documents, findings"
```

---

### Task 4: Findings embedding support

**Files:**
- Create: `packages/library/src/findings-embed.ts`
- Modify: `packages/library/src/findings.ts` — add embedding storage

- [ ] **Step 1: Add embedding table to findings migration**

Add a second migration to `findingsMigrations` in `packages/library/src/findings.ts`:

```typescript
{
  version: 2,
  up: `
    CREATE TABLE IF NOT EXISTS research_finding_embeddings (
      finding_id TEXT PRIMARY KEY REFERENCES research_findings(id) ON DELETE CASCADE,
      embedding TEXT NOT NULL
    );
  `,
},
```

- [ ] **Step 2: Create findings-embed.ts**

```typescript
// packages/library/src/findings-embed.ts
import type { Storage, LLMClient } from "@personal-ai/core";

export function storeFindingEmbedding(storage: Storage, findingId: string, embedding: number[]): void {
  storage.db.prepare(`
    INSERT OR REPLACE INTO research_finding_embeddings (finding_id, embedding)
    VALUES (?, ?)
  `).run(findingId, JSON.stringify(embedding));
}

export function getFindingEmbedding(storage: Storage, findingId: string): number[] | undefined {
  const row = storage.db.prepare("SELECT embedding FROM research_finding_embeddings WHERE finding_id = ?").get(findingId) as { embedding: string } | undefined;
  return row ? JSON.parse(row.embedding) : undefined;
}

export async function embedFinding(storage: Storage, llm: LLMClient, findingId: string, text: string): Promise<void> {
  const result = await llm.embed(text);
  storeFindingEmbedding(storage, findingId, result.embedding);
}
```

- [ ] **Step 3: Export from index**

Add to `packages/library/src/index.ts`:

```typescript
export { storeFindingEmbedding, getFindingEmbedding, embedFinding } from "./findings-embed.js";
```

- [ ] **Step 4: Build and verify**

Run: `cd packages/library && pnpm build`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add packages/library/
git commit -m "feat(library): add embedding support for research findings"
```

---

## Chunk 2: API Routes & Language Rename

### Task 5: Add Library API routes to server

**Files:**
- Create: `packages/server/src/routes/library.ts`
- Modify: `packages/server/src/index.ts` — register new routes
- Modify: `packages/server/package.json` — add `@personal-ai/library` dependency

- [ ] **Step 1: Add library dependency to server**

Add `"@personal-ai/library": "workspace:*"` to `packages/server/package.json` dependencies, then run `pnpm install`.

- [ ] **Step 2: Create library routes**

Create `packages/server/src/routes/library.ts` with routes that delegate to the library package. Key routes:

```typescript
// packages/server/src/routes/library.ts
import type { FastifyInstance } from "fastify";
import type { ServerContext } from "../index.js";
import { unifiedSearch } from "@personal-ai/library";
import { listFindings, getFinding, createFinding, deleteFinding, listFindingsForWatch } from "@personal-ai/library";
import { listBeliefs, forgetBelief, remember, memoryStats, getBeliefHistory, listBeliefProvenance, searchBeliefs, semanticSearch } from "@personal-ai/core";
import { listSources, learnFromContent, forgetSource, knowledgeSearch, getSourceChunks } from "@personal-ai/core";
import { validate } from "../validate.js";
import { z } from "zod";

export function registerLibraryRoutes(app: FastifyInstance, { ctx }: ServerContext): void {
  // --- Unified search ---
  app.get<{ Querystring: { q: string } }>("/api/library/search", async (request) => {
    const q = request.query.q;
    if (!q) return { results: [] };
    return { results: unifiedSearch(ctx.storage, q) };
  });

  // --- Memories (wraps existing beliefs) ---
  app.get<{ Querystring: { status?: string; type?: string } }>("/api/library/memories", async (request) => {
    const status = request.query.status ?? "active";
    const beliefs = listBeliefs(ctx.storage, status);
    return { memories: beliefs };
  });

  app.get<{ Params: { id: string } }>("/api/library/memories/:id", async (request) => {
    const history = getBeliefHistory(ctx.storage, request.params.id);
    return history;
  });

  app.post("/api/library/memories", async (request) => {
    const { text } = validate(z.object({ text: z.string().min(1).max(10_000) }), request.body);
    const result = await remember(ctx.storage, ctx.llm, text);
    return result;
  });

  app.delete<{ Params: { id: string } }>("/api/library/memories/:id", async (request) => {
    forgetBelief(ctx.storage, request.params.id);
    return { ok: true };
  });

  // --- Documents (wraps existing knowledge) ---
  app.get("/api/library/documents", async () => {
    return { documents: listSources(ctx.storage) };
  });

  app.post("/api/library/documents/url", async (request) => {
    const { url, maxAgeDays } = validate(z.object({
      url: z.string().url(),
      maxAgeDays: z.number().optional(),
    }), request.body);
    // Fetch page content first, then ingest — mirrors existing knowledge route pattern
    const { fetchPageAsMarkdown } = await import("@personal-ai/plugin-assistant/page-fetch");
    const markdown = await fetchPageAsMarkdown(url);
    const result = await learnFromContent(ctx.storage, ctx.llm, markdown, url, maxAgeDays);
    return result;
  });

  app.delete<{ Params: { id: string } }>("/api/library/documents/:id", async (request) => {
    forgetSource(ctx.storage, request.params.id);
    return { ok: true };
  });

  // --- Findings ---
  app.get<{ Querystring: { watchId?: string } }>("/api/library/findings", async (request) => {
    if (request.query.watchId) {
      return { findings: listFindingsForWatch(ctx.storage, request.query.watchId) };
    }
    return { findings: listFindings(ctx.storage) };
  });

  app.get<{ Params: { id: string } }>("/api/library/findings/:id", async (request, reply) => {
    const finding = getFinding(ctx.storage, request.params.id);
    if (!finding) {
      reply.status(404).send({ error: "Finding not found" });
      return;
    }
    return finding;
  });

  app.delete<{ Params: { id: string } }>("/api/library/findings/:id", async (request) => {
    deleteFinding(ctx.storage, request.params.id);
    return { ok: true };
  });

  // --- Stats ---
  app.get("/api/library/stats", async () => {
    const stats = memoryStats(ctx.storage);
    const findingsCount = (listFindings(ctx.storage, 9999)).length;
    const sourcesCount = listSources(ctx.storage).length;
    return { ...stats, findingsCount, documentsCount: sourcesCount };
  });

  // --- 301 redirects from old routes ---
  const redirects: Array<[string, string]> = [
    ["/api/beliefs", "/api/library/memories"],
    ["/api/remember", "/api/library/memories"],
    ["/api/stats", "/api/library/stats"],
    ["/api/knowledge/sources", "/api/library/documents"],
    ["/api/knowledge/learn", "/api/library/documents/url"],
    ["/api/knowledge/search", "/api/library/search"],
  ];
  for (const [from, to] of redirects) {
    app.all(from, async (_request, reply) => {
      reply.redirect(301, to);
    });
  }
}
```

- [ ] **Step 3: Register library routes in server index**

In `packages/server/src/index.ts`, import and call `registerLibraryRoutes(app, serverContext)` alongside the existing route registrations.

- [ ] **Step 4: Register findings migrations in storage setup**

Find the file where `createStorage` is called with migration arrays (likely `packages/server/src/index.ts` or a dedicated `migrations.ts`). Search for where `memoryMigrations` and `knowledgeMigrations` are spread into the migration array, and add `findingsMigrations`:

```typescript
import { findingsMigrations } from "@personal-ai/library";
// ... in the createStorage call:
createStorage(dbPath, [...memoryMigrations, ...knowledgeMigrations, ...findingsMigrations, /* other migrations */]);
```

- [ ] **Step 5: Build and verify server**

Run: `pnpm build`
Expected: No errors across all packages

- [ ] **Step 6: Commit**

```bash
git add packages/server/ packages/library/
git commit -m "feat(server): add /api/library/* routes with unified search and 301 redirects"
```

---

### Task 6: Rename UI navigation and page labels

**Files:**
- Modify: `packages/ui/src/components/Layout.tsx` — rename nav items
- Modify: `packages/ui/src/components/MobileTabBar.tsx` — rename labels
- Modify: `packages/ui/src/App.tsx` — add route aliases

- [ ] **Step 1: Update Layout.tsx navItems**

Change the `navItems` array in `packages/ui/src/components/Layout.tsx`:

```typescript
const navItems = [
  { to: "/", label: "Digests", icon: IconInbox },
  { to: "/watches", label: "Watches", icon: IconPrograms },
  { to: "/ask", label: "Chat", icon: IconChat },
  { to: "/library", label: "Library", icon: IconMemory },
  { to: "/settings", label: "Settings", icon: IconSettings },
];
```

- [ ] **Step 2: Update App.tsx routes**

Add aliases so old URLs still work:

```typescript
{/* New routes */}
<Route path="/library" element={<ErrorBoundary><Library /></ErrorBoundary>} />
<Route path="/watches" element={<ErrorBoundary><Programs /></ErrorBoundary>} />
<Route path="/digests" element={<ErrorBoundary><Inbox /></ErrorBoundary>} />
<Route path="/digests/:id" element={<ErrorBoundary><Inbox /></ErrorBoundary>} />

{/* Old routes redirect */}
<Route path="/memory" element={<Navigate to="/library" replace />} />
<Route path="/knowledge" element={<Navigate to="/library" replace />} />
<Route path="/programs" element={<Navigate to="/watches" replace />} />
{/* For parameterized redirects, create a small component: */}
{/* <Route path="/inbox/:id" element={<InboxRedirect />} /> */}
{/* where InboxRedirect uses useParams() to get id and Navigate to={`/digests/${id}`} */}
```

Note: The actual Library page (merging Memory + Knowledge) will be built in Task 8. For now, `/library` can point to the existing Memory page.

- [ ] **Step 3: Update MobileTabBar if it exists**

Follow the same label renames in `packages/ui/src/components/MobileTabBar.tsx`.

- [ ] **Step 4: Update Layout.tsx INBOX_SEEN_KEY variable name**

Rename `INBOX_SEEN_KEY` to `DIGEST_SEEN_KEY` and `pai-last-seen-briefing-id` to `pai-last-seen-digest-id`. Update all references in the file.

- [ ] **Step 5: Verify dev server loads**

Run: `pnpm dev:ui`
Expected: Navigate to `/library`, `/watches`, `/digests` — all render. Old URLs redirect.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/
git commit -m "feat(ui): rename navigation — Library, Watches, Digests, Chat"
```

---

### Task 7: Rename page titles and headings in existing pages

**Files:**
- Modify: `packages/ui/src/pages/Memory.tsx` — page title to "Memories"
- Modify: `packages/ui/src/pages/Knowledge.tsx` — page title to "Documents"
- Modify: `packages/ui/src/pages/Inbox.tsx` — page title to "Digests"
- Modify: `packages/ui/src/pages/Programs.tsx` — page title to "Watches"
- Modify: `packages/ui/src/pages/Jobs.tsx` — page title to "Activities"
- Modify: `packages/ui/src/pages/Tasks.tsx` — "Saved Move"/"Action" → "To-Do"

- [ ] **Step 1: Rename headings in each page**

For each page file, search for the page title heading (usually an `<h1>` or heading text) and rename:
- "Memory" → "Memories" (in Memory.tsx)
- "Knowledge" → "Documents" (in Knowledge.tsx)
- "Inbox" → "Digests" (in Inbox.tsx)
- "Programs" → "Watches" (in Programs.tsx)
- "Jobs" → "Activities" (in Jobs.tsx)
- All instances of "Program" → "Watch" in Programs.tsx
- All instances of "Brief"/"Briefing" → "Digest" in Inbox.tsx
- All instances of "Belief" → "Memory" in Memory.tsx (user-facing labels only)
- All instances of "Saved Move"/"Action" → "To-Do" in Tasks.tsx

**Important:** Only rename user-facing strings (labels, headings, tooltips, button text). Do NOT rename variable names, function names, prop names, or API calls — those stay as-is for now.

- [ ] **Step 2: Verify no console errors**

Run: `pnpm dev:ui` and navigate to each page.
Expected: All pages render with new labels, no console errors.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/pages/
git commit -m "feat(ui): rename all page headings to new product language"
```

---

### Task 8: Create merged Library page

**Files:**
- Create: `packages/ui/src/pages/Library.tsx`
- Create: `packages/ui/src/hooks/use-library.ts`
- Modify: `packages/ui/src/App.tsx` — wire Library page

- [ ] **Step 1: Create use-library hook**

```typescript
// packages/ui/src/hooks/use-library.ts
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useLibrarySearch(query: string) {
  return useQuery({
    queryKey: ["library", "search", query],
    queryFn: () => api.get(`/api/library/search?q=${encodeURIComponent(query)}`).then(r => r.json()),
    enabled: query.length > 0,
  });
}

export function useLibraryStats() {
  return useQuery({
    queryKey: ["library", "stats"],
    queryFn: () => api.get("/api/library/stats").then(r => r.json()),
  });
}

export function useFindings(watchId?: string) {
  return useQuery({
    queryKey: ["library", "findings", watchId],
    queryFn: () => api.get(`/api/library/findings${watchId ? `?watchId=${watchId}` : ""}`).then(r => r.json()),
  });
}
```

- [ ] **Step 2: Create Library page with three tabs**

Create `packages/ui/src/pages/Library.tsx` with tabs for Memories, Documents, Findings. The Memories and Documents tabs embed the existing content from Memory.tsx and Knowledge.tsx (extract the list/search components, or initially just render the existing pages inline). The Findings tab renders findings from the new API.

The page should have:
- A unified search bar at the top that queries `/api/library/search`
- Three tab buttons: Memories | Documents | Findings
- Stats summary below the tabs
- Each tab shows the appropriate list

Keep it simple for Phase 1 — the full polish comes later.

- [ ] **Step 3: Wire Library page in App.tsx**

Update the route in App.tsx to use the new Library component instead of Memory:

```typescript
import Library from "./pages/Library";
// ...
<Route path="/library" element={<ErrorBoundary><Library /></ErrorBoundary>} />
```

- [ ] **Step 4: Verify**

Run: `pnpm dev:ui`, navigate to `/library`.
Expected: Three tabs render, unified search works, stats display.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/
git commit -m "feat(ui): merged Library page with Memories, Documents, Findings tabs"
```

---

## Chunk 3: CLI/MCP Rename & Agent Harness

### Task 9: Rename CLI commands

**Files:**
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/core/src/memory/index.ts` — update command names

- [ ] **Step 1: Update CLI command names**

In `packages/cli/src/index.ts` and `packages/core/src/memory/index.ts`, rename the CLI commands:

| Old | New | Deprecation |
|-----|-----|-------------|
| `pai memory remember` | `pai library remember` | Old works with warning |
| `pai memory recall` | `pai library search` | Old works with warning |
| `pai memory beliefs` | `pai library memories` | Old works with warning |
| `pai memory forget` | `pai library forget` | Old works with warning |
| `pai memory stats` | `pai library stats` | Old works with warning |
| `pai knowledge learn` | `pai library learn` | Old works with warning |
| `pai knowledge search` | `pai library search` | Old works with warning |
| `pai knowledge list` | `pai library documents` | Old works with warning |
| `pai knowledge forget` | `pai library forget-document` | Old works with warning |

Keep old commands working but print a deprecation notice: `"[deprecated] Use 'pai library ...' instead"`.

- [ ] **Step 2: Test CLI**

Run: `pnpm pai library --help`
Expected: Shows library subcommands

Run: `pnpm pai memory recall "test"`
Expected: Works but prints deprecation warning

- [ ] **Step 3: Commit**

```bash
git add packages/cli/ packages/core/
git commit -m "feat(cli): rename commands to pai library with deprecation shims"
```

---

### Task 10: Rename MCP tools

**Files:**
- Modify: `packages/cli/src/index.ts` (MCP tool definitions section)

- [ ] **Step 1: Rename MCP tools with backward compat**

In the MCP server section of `packages/cli/src/index.ts`, for each tool:
1. Register the new name (e.g., `library-remember`)
2. Keep the old name registered but add a `deprecated: true` note in the description
3. Both names call the same handler

Follow the mapping from the spec:
- `remember` → `library-remember`
- `recall` → `library-search`
- `memory-context` → `library-context`
- `beliefs` → `library-memories`
- `forget` → `library-forget`
- `memory-stats` → `library-stats`
- `memory-synthesize` → `library-synthesize`
- `knowledge-learn` → `library-learn-url`
- `knowledge-search` → `library-search` (merged)
- `knowledge-sources` → `library-documents`
- `knowledge-forget` → `library-forget-document`

- [ ] **Step 2: Verify MCP tools list**

Run: `pnpm pai --mcp-list` (or equivalent to list MCP tools)
Expected: Both old and new tool names appear

- [ ] **Step 3: Commit**

```bash
git add packages/cli/
git commit -m "feat(cli): rename MCP tools to library-* with deprecated shims"
```

---

### Task 11: Scaffold agent harness in core

**Files:**
- Create: `packages/core/src/agent-harness/types.ts`
- Create: `packages/core/src/agent-harness/harness.ts`
- Create: `packages/core/src/agent-harness/index.ts`
- Create: `packages/core/test/agent-harness.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/test/agent-harness.test.ts
import { describe, it, expect } from "vitest";
import type { AgentHarnessOptions, AgentResult } from "../src/agent-harness/types.js";
import { runAgentHarness } from "../src/agent-harness/harness.js";

describe("agent harness", () => {
  it("exports types and runner", () => {
    expect(runAgentHarness).toBeTypeOf("function");
  });

  it("enforces budget limits", async () => {
    // Mock a simple agent that tries to exceed budget
    const result = await runAgentHarness({
      goal: "test goal",
      context: [],
      budget: { maxTokens: 100, maxToolCalls: 1, maxDurationMs: 5000 },
      depth: "quick",
      execute: async (ctx) => {
        return {
          findings: [],
          rawOutput: "test output",
        };
      },
    });

    expect(result.reflection).toBeDefined();
    expect(result.plan).toBeDefined();
    expect(result.usage).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm test -- agent-harness`
Expected: FAIL — module not found

- [ ] **Step 3: Create types**

```typescript
// packages/core/src/agent-harness/types.ts
export interface AgentBudget {
  maxTokens: number;
  maxToolCalls: number;
  maxDurationMs: number;
}

export interface AgentContext {
  budget: AgentBudget;
  depth: "quick" | "standard" | "deep";
  startTime: number;
  toolCallsUsed: number;
}

export interface AgentExecutionResult {
  findings: Array<{
    goal: string;
    summary: string;
    confidence: number;
    sources: Array<{ url: string; title: string }>;
  }>;
  rawOutput: string;
}

export interface AgentResult {
  plan: string[];
  findings: AgentExecutionResult["findings"];
  reflection: {
    confidence: number;
    completeness: string;
    suggestSecondPass: boolean;
  };
  usage: {
    tokensUsed: number;
    toolCallsUsed: number;
    durationMs: number;
  };
}

export interface AgentHarnessOptions {
  goal: string;
  context: Array<{ id: string; snippet: string; sourceType: string }>;
  previousFindings?: Array<{ summary: string; createdAt: string }>;
  budget: AgentBudget;
  depth: "quick" | "standard" | "deep";
  execute: (ctx: AgentContext) => Promise<AgentExecutionResult>;
}
```

- [ ] **Step 4: Create harness runner**

```typescript
// packages/core/src/agent-harness/harness.ts
import type { AgentHarnessOptions, AgentResult, AgentContext } from "./types.js";

/**
 * Lightweight agent harness: plan → execute → reflect.
 * Wraps any agent execution function with budget tracking and reflection.
 */
export async function runAgentHarness(options: AgentHarnessOptions): Promise<AgentResult> {
  const startTime = Date.now();

  // Plan phase — simple for now, will be LLM-driven in Phase 2
  const plan = [
    `Research: ${options.goal}`,
    `Depth: ${options.depth}`,
    `Budget: ${options.budget.maxTokens} tokens, ${options.budget.maxToolCalls} tool calls`,
  ];
  if (options.previousFindings?.length) {
    plan.push(`Delta: compare against ${options.previousFindings.length} previous findings`);
  }

  // Execute phase
  const ctx: AgentContext = {
    budget: options.budget,
    depth: options.depth,
    startTime,
    toolCallsUsed: 0,
  };

  const execResult = await options.execute(ctx);
  const durationMs = Date.now() - startTime;

  // Reflect phase — simple heuristic for now
  const avgConfidence = execResult.findings.length > 0
    ? execResult.findings.reduce((sum, f) => sum + f.confidence, 0) / execResult.findings.length
    : 0;

  const reflection = {
    confidence: avgConfidence,
    completeness: execResult.findings.length > 0 ? "Findings produced" : "No findings — may need deeper research",
    suggestSecondPass: avgConfidence < 0.5 && options.depth !== "deep",
  };

  return {
    plan,
    findings: execResult.findings,
    reflection,
    usage: {
      tokensUsed: 0, // tracked externally via telemetry
      toolCallsUsed: ctx.toolCallsUsed,
      durationMs,
    },
  };
}
```

- [ ] **Step 5: Create index**

```typescript
// packages/core/src/agent-harness/index.ts
export { runAgentHarness } from "./harness.js";
export type { AgentHarnessOptions, AgentResult, AgentBudget, AgentContext, AgentExecutionResult } from "./types.js";
```

- [ ] **Step 6: Export from core index**

Add to `packages/core/src/index.ts`:

```typescript
// Agent harness
export { runAgentHarness } from "./agent-harness/index.js";
export type { AgentHarnessOptions, AgentResult, AgentBudget, AgentContext, AgentExecutionResult } from "./agent-harness/index.js";
```

- [ ] **Step 7: Run tests**

Run: `cd packages/core && pnpm test -- agent-harness`
Expected: All tests PASS

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/agent-harness/ packages/core/test/agent-harness.test.ts packages/core/src/index.ts
git commit -m "feat(core): scaffold agent harness — plan/execute/reflect pattern"
```

---

## Chunk 4: Ingestion Pipelines, Telegram, Feature Flags, Docs & Integration

### Task 12: Ingestion pipelines — research → Library, correction → Library

**Files:**
- Create: `packages/library/src/ingestion.ts`
- Create: `packages/library/test/ingestion.test.ts`

This is a key spec deliverable: when research completes or a user corrects a digest, the outputs flow into Library automatically.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/library/test/ingestion.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { createStorage, memoryMigrations, knowledgeMigrations } from "@personal-ai/core";
import { findingsMigrations } from "../src/findings.js";
import { ingestResearchResult, ingestCorrection } from "../src/ingestion.js";
import type { Storage } from "@personal-ai/core";

describe("ingestion pipelines", () => {
  let storage: Storage;

  beforeEach(() => {
    storage = createStorage(":memory:", [...memoryMigrations, ...knowledgeMigrations, ...findingsMigrations]);
  });

  describe("ingestResearchResult", () => {
    it("creates a finding from research output", () => {
      const result = ingestResearchResult(storage, {
        goal: "GPU prices",
        domain: "general",
        summary: "RTX 4090 is $1599",
        confidence: 0.85,
        agentName: "Researcher",
        depthLevel: "standard",
        sources: [{ url: "https://newegg.com", title: "Newegg", fetchedAt: new Date().toISOString(), relevance: 0.9 }],
        watchId: "w1",
      });
      expect(result.finding.id).toBeTruthy();
      expect(result.finding.watchId).toBe("w1");
    });
  });

  describe("ingestCorrection", () => {
    it("stores a correction as a new memory", () => {
      // Insert a belief to correct
      storage.db.prepare(
        "INSERT INTO beliefs (id, statement, confidence, status, created_at, updated_at) VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))"
      ).run("b1", "User prefers aisle seats", 0.8, "active");

      const result = ingestCorrection(storage, {
        beliefId: "b1",
        correctedStatement: "User prefers window seats, not aisle",
        digestId: "d1",
        note: "User corrected in digest",
      });
      expect(result.corrected).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/library && pnpm test`
Expected: FAIL — module `../src/ingestion.js` not found

- [ ] **Step 3: Implement ingestion module**

```typescript
// packages/library/src/ingestion.ts
import type { Storage } from "@personal-ai/core";
import { correctBelief } from "@personal-ai/core";
import { createFinding } from "./findings.js";
import type { CreateFindingInput, ResearchFinding } from "./findings.js";

/**
 * Ingest a research result into Library as a ResearchFinding.
 * Called by the Digest domain after research agents complete.
 */
export function ingestResearchResult(
  storage: Storage,
  input: CreateFindingInput,
): { finding: ResearchFinding } {
  const finding = createFinding(storage, input);
  return { finding };
}

export interface CorrectionInput {
  beliefId: string;
  correctedStatement: string;
  digestId?: string;
  note?: string;
}

/**
 * Ingest a user correction from a Digest back into Library.
 * Delegates to core's correctBelief which handles supersession chains.
 */
export function ingestCorrection(
  storage: Storage,
  input: CorrectionInput,
): { corrected: boolean } {
  try {
    correctBelief(storage, input.beliefId, input.correctedStatement, {
      note: input.note,
      briefId: input.digestId,
    });
    return { corrected: true };
  } catch {
    return { corrected: false };
  }
}
```

- [ ] **Step 4: Export from index**

Add to `packages/library/src/index.ts`:

```typescript
// Ingestion pipelines
export { ingestResearchResult, ingestCorrection } from "./ingestion.js";
export type { CorrectionInput } from "./ingestion.js";
```

- [ ] **Step 5: Run tests**

Run: `cd packages/library && pnpm test`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/library/
git commit -m "feat(library): ingestion pipelines — research and correction → Library"
```

---

### Task 13: Telegram language rename

**Files:**
- Modify: `packages/plugin-telegram/src/index.ts` — rename commands and labels

- [ ] **Step 1: Update Telegram commands**

In `packages/plugin-telegram/src/`, find all command registrations and rename:
- `/briefs` → `/digests`
- `/programs` → `/watches`
- `/memories` → `/library`
- `/jobs` → `/activities`
- `/action` → `/todo`

Keep old commands working as aliases that print a deprecation notice.

- [ ] **Step 2: Update message templates**

Search for user-facing strings in the Telegram plugin and rename:
- "Program" → "Watch"
- "Brief"/"Briefing" → "Digest"
- "Belief" → "Memory"
- "Saved Move"/"Action" → "To-Do"
- "Job" → "Activity"

Only rename user-facing message text, not variable names or function names.

- [ ] **Step 3: Build and verify**

Run: `pnpm build`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/plugin-telegram/
git commit -m "feat(telegram): rename commands to /digests, /watches, /library, /todo"
```

---

### Task 14: Add feature flags to config (was Task 12)

**Files:**
- Modify: `packages/core/src/config.ts` — add features field
- Modify: `packages/core/src/types.ts` — add Features type

- [ ] **Step 1: Add Features type**

In `packages/core/src/types.ts`, find the `Config` interface and add:

```typescript
export interface FeatureFlags {
  libraryDomain?: boolean;
  watchesDomain?: boolean;
  digestsDomain?: boolean;
  homeDashboard?: boolean;
}
```

Add `features?: FeatureFlags` to the `Config` interface.

- [ ] **Step 2: Default feature flags**

In `packages/core/src/config.ts`, in the `loadConfig` function, add defaults:

```typescript
features: {
  libraryDomain: true,  // Phase 1 — enabled by default
  watchesDomain: false,
  digestsDomain: false,
  homeDashboard: false,
},
```

- [ ] **Step 3: Build and verify**

Run: `pnpm build`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/core/
git commit -m "feat(core): add feature flags for phased domain rollout"
```

---

### Task 15: Update documentation

**Files:**
- Modify: `docs/PRODUCT-CHARTER.md` — rename primary nouns, amend anti-goals
- Modify: `docs/PRIMITIVES.md` — rename primitives
- Modify: `docs/ARCHITECTURE-BOUNDARIES.md` — update noun rules
- Modify: `CHANGELOG.md` — add Phase 1 entry

- [ ] **Step 1: Update PRODUCT-CHARTER.md**

- Rename "Program" → "Watch" throughout
- Rename "Brief" → "Digest" throughout
- Rename "Belief" → "Memory" in user-facing contexts
- Rename "Action/Saved Move" → "To-Do"
- Amend the anti-goals section: clarify that To-Dos are follow-through for Watches/Digests, not a standalone task system
- Update the core loop description: Ask → Watch creation → Digest → Correction/To-Do → Next digest improves

- [ ] **Step 2: Update PRIMITIVES.md**

Rename each primitive section to use new names. Keep the detailed descriptions, just update the noun labels.

- [ ] **Step 3: Update ARCHITECTURE-BOUNDARIES.md**

- Add "Activity" as approved user-facing noun for background work
- Update section on noun leakage rules
- Update primary surfaces list

- [ ] **Step 4: Add CHANGELOG entry**

Add under `## [Unreleased]`:

```markdown
### Changed
- **Product language rename:** Program → Watch, Brief → Digest, Belief → Memory, Action → To-Do, Job → Activity
- **Library domain:** Unified `/api/library/*` API combining memories, documents, and research findings
- **Merged Library page:** Single page with Memories, Documents, Findings tabs and unified search
- **CLI renamed:** `pai library` commands replace `pai memory` and `pai knowledge` (old commands deprecated)
- **MCP tools renamed:** `library-*` tools replace `remember`, `recall`, `knowledge-*` (old names deprecated)
- **Agent harness:** Plan → Execute → Reflect pattern scaffolded in core
- **Feature flags:** Config-driven phased rollout for domain restructure
```

- [ ] **Step 5: Commit**

```bash
git add docs/ CHANGELOG.md
git commit -m "docs: update product language to Watch/Digest/Memory/To-Do per Four Pillars spec"
```

---

### Task 16: Integration test — full Library flow

**Files:**
- Create: `packages/library/test/integration.test.ts`

- [ ] **Step 1: Write integration test**

```typescript
// packages/library/test/integration.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { createStorage, memoryMigrations, knowledgeMigrations } from "@personal-ai/core";
import { findingsMigrations, createFinding, listFindings } from "../src/findings.js";
import { unifiedSearch } from "../src/search.js";
import type { Storage } from "@personal-ai/core";

describe("Library integration", () => {
  let storage: Storage;

  beforeEach(() => {
    storage = createStorage(":memory:", [...memoryMigrations, ...knowledgeMigrations, ...findingsMigrations]);
  });

  it("finding creation → unified search → retrieval", () => {
    // Create a finding
    const finding = createFinding(storage, {
      goal: "Best GPU for AI training",
      domain: "general",
      summary: "NVIDIA H100 remains the top choice for large-scale AI training at $25k-$30k",
      confidence: 0.9,
      agentName: "Researcher",
      depthLevel: "standard",
      sources: [
        { url: "https://nvidia.com", title: "NVIDIA", fetchedAt: new Date().toISOString(), relevance: 0.95 },
      ],
    });

    // Verify it appears in unified search
    const results = unifiedSearch(storage, "GPU AI training");
    expect(results.some(r => r.sourceType === "finding")).toBe(true);
    expect(results.some(r => r.snippet.includes("H100"))).toBe(true);

    // Verify it appears in findings list
    const findings = listFindings(storage);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe(finding.id);
  });

  it("memory + finding appear together in search", () => {
    // Insert a memory (belief)
    storage.db.prepare(
      "INSERT INTO beliefs (id, statement, confidence, status, created_at, updated_at) VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))"
    ).run("b1", "User is interested in GPU prices for deep learning", 0.85, "active");

    // Insert a finding
    createFinding(storage, {
      goal: "GPU pricing",
      domain: "general",
      summary: "RTX 4090 dropped to $1499, RTX 5090 announced at $1999",
      confidence: 0.8,
      agentName: "Researcher",
      depthLevel: "quick",
      sources: [],
    });

    const results = unifiedSearch(storage, "GPU");
    const types = new Set(results.map(r => r.sourceType));
    // Should have results from at least one source
    expect(results.length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run integration test**

Run: `cd packages/library && pnpm test`
Expected: All tests PASS

- [ ] **Step 3: Run full test suite**

Run: `pnpm test`
Expected: All existing tests still pass, plus new library tests

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: No type errors

- [ ] **Step 5: Run lint**

Run: `pnpm lint`
Expected: No lint errors (fix any that appear)

- [ ] **Step 6: Commit**

```bash
git add packages/library/test/
git commit -m "test(library): add integration tests for unified Library flow"
```

---

### Task 17: Final verification

- [ ] **Step 1: Run full verify suite**

Run: `pnpm verify`
Expected: All checks pass (build, lint, typecheck, test)

- [ ] **Step 2: Manual smoke test**

Start the dev server (`pnpm dev:ui`) and verify:
1. Navigate to `/library` — three tabs render
2. Navigate to `/watches` — redirects or renders Programs page
3. Navigate to `/digests` — redirects or renders Inbox page
4. Old URLs (`/memory`, `/knowledge`, `/programs`, `/inbox`) redirect properly
5. Sidebar shows new labels: Library, Watches, Digests, Chat
6. No console errors

- [ ] **Step 3: Run harness if applicable**

Run: `pnpm harness:regressions`
Expected: No regressions

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: Phase 1 smoke test fixes"
```

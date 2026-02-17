# Semantic Memory with Embeddings — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add local embeddings via Ollama to the memory plugin for semantic search, smart dedup/merge, and dual belief types (fact + insight).

**Architecture:** Extend `LLMClient` with `embed()` using the Vercel AI SDK's `embed` function + Ollama's `nomic-embed-text`. Store vectors as JSON in a new `belief_embeddings` table. Cosine similarity computed in JS. New migration adds `type` column to beliefs and `belief_embeddings` table.

**Tech Stack:** Vercel AI SDK (`embed` from `ai`), `ai-sdk-ollama` `.embeddingModel()`, SQLite (JSON blob storage), existing core/plugin-memory packages.

---

### Task 1: Add `embed()` to LLMClient interface

**Files:**
- Modify: `packages/core/src/types.ts:55-58`
- Modify: `packages/core/src/index.ts:1-4`

**Step 1: Add `embed` method and `EmbedResult` to types**

In `packages/core/src/types.ts`, add after the `ChatResult` interface (line 53):

```typescript
export interface EmbedResult {
  embedding: number[];
}
```

Add `embed` to `LLMClient` interface (line 55-58):

```typescript
export interface LLMClient {
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult>;
  embed(text: string): Promise<EmbedResult>;
  health(): Promise<{ ok: boolean; provider: string }>;
}
```

**Step 2: Add `embedModel` to Config**

In `packages/core/src/types.ts`, inside `Config.llm` (line 21-28):

```typescript
  llm: {
    provider: "ollama" | "openai";
    model: string;
    embedModel?: string;  // add this line
    baseUrl: string;
    apiKey?: string;
    fallbackMode: "local-first" | "strict";
  };
```

**Step 3: Export `EmbedResult` from core index**

In `packages/core/src/index.ts` line 1-4, add `EmbedResult` to the type exports.

**Step 4: Verify typecheck fails**

Run: `pnpm typecheck`
Expected: FAIL — `createLLMClient` doesn't implement `embed` yet.

---

### Task 2: Implement `embed()` in LLM client

**Files:**
- Modify: `packages/core/src/llm.ts:1-54`
- Modify: `packages/core/src/config.ts:5-19`

**Step 1: Add `embedModel` to `loadConfig`**

In `packages/core/src/config.ts`, inside the `llm` object (after line 10):

```typescript
      embedModel: env["PAI_LLM_EMBED_MODEL"] ?? "nomic-embed-text",
```

**Step 2: Implement embed in llm.ts**

In `packages/core/src/llm.ts`, add import at top:

```typescript
import { generateText, embed as aiEmbed } from "ai";
```

After the `llmModel` creation (line 14), add embedding model:

```typescript
  const embeddingModel =
    provider === "ollama"
      ? createOllama({ baseURL: baseUrl, headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined }).embeddingModel(llmConfig.embedModel ?? "nomic-embed-text")
      : createOpenAI({ baseURL: baseUrl, apiKey: apiKey ?? "" }).textEmbeddingModel(llmConfig.embedModel ?? "text-embedding-3-small");
```

Add `embed` function before the `return` statement:

```typescript
  async function embed(text: string): Promise<{ embedding: number[] }> {
    log.debug("Embedding request", { model: llmConfig.embedModel ?? "nomic-embed-text", textLength: text.length });
    const { embedding } = await aiEmbed({
      model: embeddingModel,
      value: text,
    });
    log.debug("Embedding response", { dimensions: embedding.length });
    return { embedding };
  }
```

Update the return statement to include `embed`:

```typescript
  return { chat, embed, health };
```

**Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

---

### Task 3: Add embed tests to LLM test suite

**Files:**
- Modify: `packages/core/test/llm.test.ts`

**Step 1: Mock the `embed` import**

Update the mock at top of file to also mock `embed`:

```typescript
vi.mock("ai", () => ({
  generateText: vi.fn(),
  embed: vi.fn(),
}));

import { generateText, embed as aiEmbed } from "ai";
const mockGenerateText = vi.mocked(generateText);
const mockEmbed = vi.mocked(aiEmbed);
```

**Step 2: Write the embed test**

```typescript
  it("embed should return embedding vector via ollama provider", async () => {
    mockEmbed.mockResolvedValue({
      embedding: [0.1, 0.2, 0.3],
      value: "test",
      usage: { tokens: 5 },
    } as any);

    const client = createLLMClient({
      provider: "ollama",
      model: "llama3.2",
      baseUrl: "http://127.0.0.1:11434",
      fallbackMode: "local-first",
    });

    const result = await client.embed("test text");
    expect(result.embedding).toEqual([0.1, 0.2, 0.3]);
    expect(mockEmbed).toHaveBeenCalledOnce();
  });
```

**Step 3: Run tests**

Run: `pnpm --filter @personal-ai/core test`
Expected: PASS — all 9 tests (8 existing + 1 new)

**Step 4: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/llm.ts packages/core/src/config.ts packages/core/src/index.ts packages/core/test/llm.test.ts
git commit -m "feat: add embed() to LLMClient with Ollama/OpenAI support"
```

---

### Task 4: Add migration 3 — belief type + embeddings table

**Files:**
- Modify: `packages/plugin-memory/src/memory.ts:4-55` (migrations array)
- Modify: `packages/plugin-memory/src/memory.ts:66-73` (Belief interface)

**Step 1: Add migration 3**

In `packages/plugin-memory/src/memory.ts`, add to the `memoryMigrations` array after version 2:

```typescript
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
```

**Step 2: Update Belief interface**

Add `type` to the `Belief` interface:

```typescript
export interface Belief {
  id: string;
  statement: string;
  confidence: number;
  status: string;
  type: string;
  created_at: string;
  updated_at: string;
}
```

**Step 3: Run tests**

Run: `pnpm --filter @personal-ai/plugin-memory test`
Expected: PASS — existing tests still work (new column has DEFAULT)

**Step 4: Commit**

```bash
git add packages/plugin-memory/src/memory.ts
git commit -m "feat: add migration 3 — belief type column and embeddings table"
```

---

### Task 5: Add embedding storage and cosine similarity functions

**Files:**
- Modify: `packages/plugin-memory/src/memory.ts`

**Step 1: Write test for cosine similarity**

Add to `packages/plugin-memory/test/memory.test.ts`:

```typescript
import { cosineSimilarity, storeEmbedding, findSimilarBeliefs } from "../src/memory.js";

describe("Embeddings", () => {
  // reuse existing storage setup from Memory describe block

  it("should compute cosine similarity correctly", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1.0);
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0.0);
    expect(cosineSimilarity([1, 0, 0], [-1, 0, 0])).toBeCloseTo(-1.0);
  });

  it("should store and retrieve embeddings", () => {
    const belief = createBelief(storage, { statement: "test belief", confidence: 0.6 });
    storeEmbedding(storage, belief.id, [0.1, 0.2, 0.3]);
    const results = findSimilarBeliefs(storage, [0.1, 0.2, 0.3], 5);
    expect(results).toHaveLength(1);
    expect(results[0]!.beliefId).toBe(belief.id);
    expect(results[0]!.similarity).toBeCloseTo(1.0);
  });

  it("should rank by cosine similarity", () => {
    const b1 = createBelief(storage, { statement: "close match", confidence: 0.6 });
    const b2 = createBelief(storage, { statement: "distant match", confidence: 0.6 });
    storeEmbedding(storage, b1.id, [1.0, 0.0, 0.0]);
    storeEmbedding(storage, b2.id, [0.0, 1.0, 0.0]);
    const results = findSimilarBeliefs(storage, [0.9, 0.1, 0.0], 5);
    expect(results[0]!.beliefId).toBe(b1.id);
  });

  it("should only return active beliefs", () => {
    const b1 = createBelief(storage, { statement: "active belief", confidence: 0.6 });
    const b2 = createBelief(storage, { statement: "dead belief", confidence: 0.6 });
    storeEmbedding(storage, b1.id, [1.0, 0.0, 0.0]);
    storeEmbedding(storage, b2.id, [1.0, 0.0, 0.0]);
    storage.run("UPDATE beliefs SET status = 'invalidated' WHERE id = ?", [b2.id]);
    const results = findSimilarBeliefs(storage, [1.0, 0.0, 0.0], 5);
    expect(results).toHaveLength(1);
    expect(results[0]!.beliefId).toBe(b1.id);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @personal-ai/plugin-memory test`
Expected: FAIL — functions not yet exported

**Step 3: Implement the functions**

In `packages/plugin-memory/src/memory.ts`, add:

```typescript
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
  const rows = storage.query<{ belief_id: string; embedding: string; statement: string; confidence: number; updated_at: string }>(
    `SELECT be.belief_id, be.embedding, b.statement, b.confidence, b.updated_at
     FROM belief_embeddings be
     JOIN beliefs b ON b.id = be.belief_id
     WHERE b.status = 'active'`,
  );

  return rows
    .map((row) => {
      const emb = JSON.parse(row.embedding) as number[];
      const belief = { confidence: row.confidence, updated_at: row.updated_at } as Belief;
      return {
        beliefId: row.belief_id,
        statement: row.statement,
        confidence: effectiveConfidence(belief),
        similarity: cosineSimilarity(queryEmbedding, emb),
      };
    })
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}
```

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter @personal-ai/plugin-memory test`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/plugin-memory/src/memory.ts packages/plugin-memory/test/memory.test.ts
git commit -m "feat: add cosine similarity, embedding storage, and semantic search"
```

---

### Task 6: Update `createBelief` to accept type parameter

**Files:**
- Modify: `packages/plugin-memory/src/memory.ts:100-111` (createBelief function)

**Step 1: Write test**

Add to `packages/plugin-memory/test/memory.test.ts`:

```typescript
  it("should create belief with type", () => {
    const fact = createBelief(storage, { statement: "User likes coffee", confidence: 0.6, type: "fact" });
    const insight = createBelief(storage, { statement: "Morning routines help", confidence: 0.6, type: "insight" });
    const [f] = storage.query<Belief>("SELECT * FROM beliefs WHERE id = ?", [fact.id]);
    const [i] = storage.query<Belief>("SELECT * FROM beliefs WHERE id = ?", [insight.id]);
    expect(f!.type).toBe("fact");
    expect(i!.type).toBe("insight");
  });

  it("should default belief type to insight", () => {
    const b = createBelief(storage, { statement: "test", confidence: 0.5 });
    const [row] = storage.query<Belief>("SELECT * FROM beliefs WHERE id = ?", [b.id]);
    expect(row!.type).toBe("insight");
  });
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @personal-ai/plugin-memory test`
Expected: FAIL — `type` not in createBelief input

**Step 3: Update createBelief**

```typescript
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
```

**Step 4: Run tests**

Run: `pnpm --filter @personal-ai/plugin-memory test`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/plugin-memory/src/memory.ts packages/plugin-memory/test/memory.test.ts
git commit -m "feat: add belief type parameter (fact/insight) to createBelief"
```

---

### Task 7: Rewrite `remember()` — dual extraction + semantic dedup

**Files:**
- Modify: `packages/plugin-memory/src/remember.ts` (full rewrite)

**Step 1: Write tests for new extraction prompt**

In `packages/plugin-memory/test/remember.test.ts`, update `extractBelief` test and add new ones:

```typescript
describe("extractBeliefs (dual)", () => {
  it("should extract fact and insight from text using LLM", async () => {
    const mockLLM: LLMClient = {
      chat: vi.fn().mockResolvedValue({
        text: '{"fact":"User likes coffee in the morning","insight":"Morning routines provide consistency and energy"}',
        usage: { inputTokens: 10, outputTokens: 15 },
      }),
      embed: vi.fn().mockResolvedValue({ embedding: [0.1, 0.2, 0.3] }),
      health: vi.fn().mockResolvedValue({ ok: true, provider: "mock" }),
    };
    const result = await extractBeliefs(mockLLM, "I like coffee in the morning");
    expect(result.fact).toBe("User likes coffee in the morning");
    expect(result.insight).toBe("Morning routines provide consistency and energy");
  });

  it("should handle LLM returning plain text by using it as fact", async () => {
    const mockLLM: LLMClient = {
      chat: vi.fn().mockResolvedValue({
        text: "User enjoys morning coffee",
        usage: { inputTokens: 10, outputTokens: 5 },
      }),
      embed: vi.fn().mockResolvedValue({ embedding: [0.1, 0.2, 0.3] }),
      health: vi.fn().mockResolvedValue({ ok: true, provider: "mock" }),
    };
    const result = await extractBeliefs(mockLLM, "I like coffee");
    expect(result.fact).toBe("User enjoys morning coffee");
    expect(result.insight).toBeNull();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @personal-ai/plugin-memory test`
Expected: FAIL

**Step 3: Implement new extraction**

Replace `extractBelief` in `remember.ts` with `extractBeliefs`:

```typescript
export async function extractBeliefs(
  llm: LLMClient,
  text: string,
): Promise<{ fact: string; insight: string | null }> {
  const result = await llm.chat([
    {
      role: "system",
      content:
        'Extract a personal fact and an optional generalized insight from the observation. ' +
        'The fact should preserve what the user said/experienced. The insight (if any) should be a broader lesson. ' +
        'Reply with JSON only: {"fact":"...","insight":"..."} or {"fact":"...","insight":null} if no broader lesson applies. ' +
        'Keep each under 20 words.',
    },
    { role: "user", content: text },
  ], { temperature: 0.3 });

  try {
    const parsed = JSON.parse(result.text);
    return { fact: parsed.fact, insight: parsed.insight ?? null };
  } catch {
    // Fallback: treat raw text as fact
    return { fact: result.text.trim(), insight: null };
  }
}
```

**Step 4: Rewrite `remember()` to use embeddings and dual beliefs**

```typescript
export async function remember(
  storage: Storage,
  llm: LLMClient,
  text: string,
  logger?: Logger,
): Promise<{ episodeId: string; beliefIds: string[]; isReinforcement: boolean }> {
  // 1. Create episode
  const episode = createEpisode(storage, { action: text });

  // 2. Extract fact + insight
  const extracted = await extractBeliefs(llm, text);
  logger?.debug("Extracted beliefs", { input: text, fact: extracted.fact, insight: extracted.insight });

  const beliefIds: string[] = [];
  let isReinforcement = false;

  // 3. Process fact belief
  const factResult = await processNewBelief(storage, llm, extracted.fact, "fact", episode.id, logger);
  beliefIds.push(factResult.beliefId);
  if (factResult.isReinforcement) isReinforcement = true;

  // 4. Process insight belief (if any)
  if (extracted.insight) {
    const insightResult = await processNewBelief(storage, llm, extracted.insight, "insight", episode.id, logger);
    beliefIds.push(insightResult.beliefId);
    if (insightResult.isReinforcement) isReinforcement = true;
  }

  return { episodeId: episode.id, beliefIds, isReinforcement };
}

async function processNewBelief(
  storage: Storage,
  llm: LLMClient,
  statement: string,
  type: string,
  episodeId: string,
  logger?: Logger,
): Promise<{ beliefId: string; isReinforcement: boolean }> {
  // Embed the new statement
  const { embedding } = await llm.embed(statement);

  // Find semantically similar beliefs
  const similar = findSimilarBeliefs(storage, embedding, 5);
  logger?.debug("Semantic search results", { statement, matchCount: similar.length, topSimilarity: similar[0]?.similarity });

  if (similar.length > 0 && similar[0]!.similarity > 0.85) {
    // High similarity — merge (reinforce)
    const match = similar[0]!;
    reinforceBelief(storage, match.beliefId);
    linkBeliefToEpisode(storage, match.beliefId, episodeId);
    logBeliefChange(storage, {
      beliefId: match.beliefId,
      changeType: "reinforced",
      detail: `Merged similar (${match.similarity.toFixed(2)}): "${statement}"`,
      episodeId,
    });
    logger?.info("Belief merged/reinforced", { beliefId: match.beliefId, similarity: match.similarity });
    return { beliefId: match.beliefId, isReinforcement: true };
  }

  if (similar.length > 0 && similar[0]!.similarity > 0.5) {
    // Medium similarity — check contradiction
    const beliefs = similar.map((s) => ({
      id: s.beliefId,
      statement: s.statement,
      confidence: s.confidence,
      status: "active",
      type: "",
      created_at: "",
      updated_at: "",
    }));
    const contradictedId = await checkContradiction(llm, statement, beliefs, logger);

    if (contradictedId) {
      storage.run("UPDATE beliefs SET status = 'invalidated', updated_at = datetime('now') WHERE id = ?", [contradictedId]);
      logBeliefChange(storage, {
        beliefId: contradictedId,
        changeType: "contradicted",
        detail: `Contradicted by: "${statement}"`,
        episodeId,
      });

      const belief = createBelief(storage, { statement, confidence: 0.6, type });
      storeEmbedding(storage, belief.id, embedding);
      linkBeliefToEpisode(storage, belief.id, episodeId);
      logBeliefChange(storage, {
        beliefId: belief.id,
        changeType: "created",
        detail: `Replaced contradicted belief ${contradictedId}`,
        episodeId,
      });
      logger?.info("Belief contradicted and replaced", { oldBeliefId: contradictedId, newBeliefId: belief.id });
      return { beliefId: belief.id, isReinforcement: false };
    }
  }

  // No match or low similarity — create new
  const belief = createBelief(storage, { statement, confidence: 0.6, type });
  storeEmbedding(storage, belief.id, embedding);
  linkBeliefToEpisode(storage, belief.id, episodeId);
  logBeliefChange(storage, {
    beliefId: belief.id,
    changeType: "created",
    detail: `Extracted from: "${statement}"`,
    episodeId,
  });
  logger?.info("New belief created", { beliefId: belief.id, type, statement });
  return { beliefId: belief.id, isReinforcement: false };
}
```

**Step 5: Update tests for new remember() return shape**

The return type changes from `{ beliefId: string }` to `{ beliefIds: string[] }`. Update all existing remember tests:

- Mock LLM must include `embed: vi.fn().mockResolvedValue({ embedding: [0.1, 0.2, 0.3] })`
- Change `result.beliefId` to `result.beliefIds[0]` in assertions
- Update reinforcement test to account for dual belief creation

**Step 6: Run tests**

Run: `pnpm --filter @personal-ai/plugin-memory test`
Expected: PASS

**Step 7: Commit**

```bash
git add packages/plugin-memory/src/remember.ts packages/plugin-memory/test/remember.test.ts
git commit -m "feat: rewrite remember() with dual extraction and semantic dedup"
```

---

### Task 8: Update CLI commands for new return shape

**Files:**
- Modify: `packages/plugin-memory/src/index.ts:16-20` (remember command)
- Modify: `packages/plugin-memory/src/index.ts:22-35` (recall command)

**Step 1: Update remember command output**

```typescript
        async action(args) {
          const result = await remember(ctx.storage, ctx.llm, args["text"]!, ctx.logger);
          const label = result.isReinforcement ? "Reinforced existing" : "New";
          console.log(`${label} belief(s): ${result.beliefIds.join(", ")}`);
        },
```

**Step 2: Update recall to also search by embeddings**

Add a `semanticSearch` function to `memory.ts` that combines FTS5 + embedding results, or update the `recall` command to use `findSimilarBeliefs` when embeddings exist.

In `packages/plugin-memory/src/index.ts`, update recall:

```typescript
      {
        name: "memory recall",
        description: "Search beliefs by text",
        args: [{ name: "query", description: "Search query", required: true }],
        async action(args) {
          const query = args["query"]!;
          // Try semantic search first
          let beliefs: Array<{ statement: string; confidence: number }> = [];
          try {
            const { embedding } = await ctx.llm.embed(query);
            const similar = findSimilarBeliefs(ctx.storage, embedding, 10);
            beliefs = similar.filter((s) => s.similarity > 0.3).map((s) => ({
              statement: s.statement,
              confidence: s.confidence,
            }));
          } catch {
            // Fallback to FTS5 if embedding fails
          }
          if (beliefs.length === 0) {
            beliefs = searchBeliefs(ctx.storage, query);
          }
          if (beliefs.length === 0) {
            console.log("No matching beliefs found.");
            return;
          }
          for (const b of beliefs) {
            console.log(`[${b.confidence.toFixed(1)}] ${b.statement}`);
          }
        },
      },
```

**Step 3: Update imports in index.ts**

Add `findSimilarBeliefs` to the import from `./memory.js`.

**Step 4: Run full verify**

Run: `pnpm run verify`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/plugin-memory/src/index.ts
git commit -m "feat: update CLI commands for dual beliefs and semantic recall"
```

---

### Task 9: Update .env.example and AGENTS.md

**Files:**
- Modify: `.env.example`
- Modify: `AGENTS.md`

**Step 1: Add embed model to .env.example**

Add after `PAI_LLM_MODEL` line:

```
PAI_LLM_EMBED_MODEL=nomic-embed-text
```

**Step 2: Update AGENTS.md memory section**

Update the `plugin-memory` description to mention belief types and embeddings. Update Configuration section to mention `PAI_LLM_EMBED_MODEL`.

**Step 3: Commit**

```bash
git add .env.example AGENTS.md
git commit -m "docs: update config and docs for semantic memory"
```

---

### Task 10: End-to-end integration test

**Step 1: Build**

Run: `pnpm build`

**Step 2: Test remember with dual output**

```bash
PAI_LOG_LEVEL=debug node packages/cli/dist/index.js memory remember "I prefer dark mode for coding at night"
```

Expected: Creates 2 beliefs (fact + insight), log shows embedding calls.

**Step 3: Test semantic recall**

```bash
node packages/cli/dist/index.js memory recall "dark mode"
node packages/cli/dist/index.js memory recall "nighttime coding preferences"
```

Expected: Both queries return the relevant belief(s).

**Step 4: Test dedup**

```bash
node packages/cli/dist/index.js memory remember "I always use dark mode when coding"
```

Expected: Merges/reinforces the existing fact instead of creating duplicate.

**Step 5: Verify full test suite**

Run: `pnpm run verify`
Expected: PASS

**Step 6: Final commit**

```bash
git commit --allow-empty -m "feat: semantic memory with embeddings — complete"
```

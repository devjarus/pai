# Background Learning Worker Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A passive background worker that runs every 2 hours, gathers unprocessed signals from chat threads, research reports, knowledge sources, and task completions, then makes one focused LLM call to extract learnings into the belief system.

**Architecture:** Single `runBackgroundLearning(ctx)` function in the server package. Uses a watermark table to track what's been processed. Gathers signals via SQL, extracts facts via one LLM call, stores via existing `remember()`. Timer registered alongside briefing timer.

**Tech Stack:** TypeScript, better-sqlite3, Vercel AI SDK `generateText`, existing core `remember()` pipeline.

---

### Task 1: Watermark Migration

**Files:**
- Create: `packages/server/src/learning.ts`
- Modify: `packages/server/src/index.ts`

**What:** Create the `learning_watermarks` table migration and register it. This table tracks the last-processed timestamp per signal source.

**Migration SQL:**
```sql
CREATE TABLE IF NOT EXISTS learning_watermarks (
  source TEXT PRIMARY KEY,
  last_processed_at TEXT NOT NULL
);
```

**Implementation:**

In `packages/server/src/learning.ts`:
```typescript
import type { Migration, PluginContext } from "@personal-ai/core";

export const learningMigrations: Migration[] = [
  {
    version: 1,
    up: `CREATE TABLE IF NOT EXISTS learning_watermarks (
      source TEXT PRIMARY KEY,
      last_processed_at TEXT NOT NULL
    );`,
  },
];
```

In `packages/server/src/index.ts`, add alongside existing migration calls (around line 97):
```typescript
import { learningMigrations } from "./learning.js";
// ...
storage.migrate("learning", learningMigrations);
```

Also add the same line in the `reinitialize()` function (around line 200) where migrations are re-run.

**Verify:** `pnpm build && pnpm test` — all 463+ tests pass, no regressions.

**Commit:** `feat: add learning_watermarks migration`

---

### Task 2: Watermark Helper Functions

**Files:**
- Modify: `packages/server/src/learning.ts`
- Create: `packages/server/test/learning.test.ts`

**What:** Add functions to read and update watermarks. On first read, initialize to 24 hours ago.

**Test first** in `packages/server/test/learning.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { createTestStorage } from "./helpers.js";
import { learningMigrations, getWatermark, updateWatermark } from "../src/learning.js";

describe("learning watermarks", () => {
  let storage: ReturnType<typeof createTestStorage>;

  beforeEach(() => {
    storage = createTestStorage();
    storage.migrate("learning", learningMigrations);
  });

  it("returns a default watermark 24h ago on first read", () => {
    const wm = getWatermark(storage, "threads");
    const age = Date.now() - new Date(wm).getTime();
    // Should be roughly 24 hours ago (within 5 seconds)
    expect(age).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(age).toBeLessThan(25 * 60 * 60 * 1000);
  });

  it("updates and reads back a watermark", () => {
    const now = new Date().toISOString();
    updateWatermark(storage, "threads", now);
    const wm = getWatermark(storage, "threads");
    expect(wm).toBe(now);
  });

  it("handles multiple sources independently", () => {
    const t1 = "2026-01-01T00:00:00.000Z";
    const t2 = "2026-02-01T00:00:00.000Z";
    updateWatermark(storage, "threads", t1);
    updateWatermark(storage, "research", t2);
    expect(getWatermark(storage, "threads")).toBe(t1);
    expect(getWatermark(storage, "research")).toBe(t2);
  });
});
```

**Note:** Check how `createTestStorage` works in existing tests. Look at `packages/server/test/helpers.ts` (or the first few lines of `packages/server/test/routes.test.ts`) for the pattern. The test storage needs `storage.migrate()` support. If no helper exists, create an in-memory SQLite storage inline.

**Implementation** in `packages/server/src/learning.ts`:
```typescript
import type { Storage } from "@personal-ai/core";

export function getWatermark(storage: Storage, source: string): string {
  const rows = storage.query<{ last_processed_at: string }>(
    "SELECT last_processed_at FROM learning_watermarks WHERE source = ?",
    [source],
  );
  if (rows[0]) return rows[0].last_processed_at;
  // First run: default to 24 hours ago
  const defaultTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  storage.run(
    "INSERT INTO learning_watermarks (source, last_processed_at) VALUES (?, ?)",
    [source, defaultTime],
  );
  return defaultTime;
}

export function updateWatermark(storage: Storage, source: string, timestamp: string): void {
  storage.run(
    "INSERT OR REPLACE INTO learning_watermarks (source, last_processed_at) VALUES (?, ?)",
    [source, timestamp],
  );
}
```

**Verify:** `pnpm --filter @personal-ai/server test` — new tests pass.

**Commit:** `feat: add watermark read/write helpers with tests`

---

### Task 3: Signal Gathering Functions

**Files:**
- Modify: `packages/server/src/learning.ts`
- Modify: `packages/server/test/learning.test.ts`

**What:** Four functions that query each signal source for items newer than the watermark. Return lightweight summaries (no full message content in function signatures — content is gathered but only passed to the LLM prompt internally).

**Interfaces:**
```typescript
interface ThreadSignal {
  threadId: string;
  messages: Array<{ role: string; content: string; createdAt: string }>;
}

interface ResearchSignal {
  id: string;
  goal: string;
  reportSnippet: string;
}

interface TaskSignal {
  title: string;
  priority: string;
  completedAt: string;
}

interface KnowledgeSignal {
  title: string;
  url: string;
  firstChunk: string;
}

export interface GatheredSignals {
  threads: ThreadSignal[];
  research: ResearchSignal[];
  tasks: TaskSignal[];
  knowledge: KnowledgeSignal[];
  isEmpty: boolean;
}
```

**Implementation — `gatherSignals(storage, watermarks)`:**
```typescript
export function gatherSignals(storage: Storage): GatheredSignals {
  const threadsWm = getWatermark(storage, "threads");
  const researchWm = getWatermark(storage, "research");
  const tasksWm = getWatermark(storage, "tasks");
  const knowledgeWm = getWatermark(storage, "knowledge");

  // 1. Chat threads — recent user messages, grouped by thread, max 3 threads
  const recentMessages = storage.query<{
    thread_id: string; role: string; content: string; created_at: string;
  }>(
    `SELECT thread_id, role, content, created_at FROM thread_messages
     WHERE created_at > ? AND role = 'user'
     ORDER BY created_at DESC LIMIT 60`,
    [threadsWm],
  );
  // Group by thread, take max 3 threads with max 20 messages each
  const threadMap = new Map<string, ThreadSignal>();
  for (const msg of recentMessages) {
    if (threadMap.size >= 3 && !threadMap.has(msg.thread_id)) continue;
    let thread = threadMap.get(msg.thread_id);
    if (!thread) {
      thread = { threadId: msg.thread_id, messages: [] };
      threadMap.set(msg.thread_id, thread);
    }
    if (thread.messages.length < 20) {
      thread.messages.push({ role: msg.role, content: msg.content, createdAt: msg.created_at });
    }
  }
  const threads = [...threadMap.values()];

  // 2. Research reports — completed since last watermark
  let research: ResearchSignal[] = [];
  try {
    research = storage.query<{ id: string; goal: string; report: string | null; completed_at: string }>(
      `SELECT id, goal, report, completed_at FROM research_jobs
       WHERE status = 'done' AND completed_at > ?
       ORDER BY completed_at DESC LIMIT 5`,
      [researchWm],
    ).map((r) => ({
      id: r.id,
      goal: r.goal,
      reportSnippet: (r.report ?? "").slice(0, 500),
    }));
  } catch { /* research_jobs table may not exist */ }

  // 3. Completed tasks
  let tasks: TaskSignal[] = [];
  try {
    tasks = storage.query<{ title: string; priority: string; completed_at: string }>(
      `SELECT title, priority, completed_at FROM tasks
       WHERE status = 'done' AND completed_at > ?
       ORDER BY completed_at DESC LIMIT 10`,
      [tasksWm],
    ).map((t) => ({
      title: t.title,
      priority: t.priority,
      completedAt: t.completed_at,
    }));
  } catch { /* tasks table may not exist */ }

  // 4. New knowledge sources
  let knowledge: KnowledgeSignal[] = [];
  try {
    const sources = storage.query<{ id: string; title: string | null; url: string; fetched_at: string }>(
      `SELECT id, title, url, fetched_at FROM knowledge_sources
       WHERE fetched_at > ?
       ORDER BY fetched_at DESC LIMIT 10`,
      [knowledgeWm],
    );
    knowledge = sources.map((s) => {
      const chunk = storage.query<{ content: string }>(
        `SELECT content FROM knowledge_chunks WHERE source_id = ? ORDER BY chunk_index ASC LIMIT 1`,
        [s.id],
      );
      return {
        title: s.title ?? s.url,
        url: s.url,
        firstChunk: (chunk[0]?.content ?? "").slice(0, 200),
      };
    });
  } catch { /* knowledge tables may not exist */ }

  const isEmpty = threads.length === 0 && research.length === 0 && tasks.length === 0 && knowledge.length === 0;

  return { threads, research, tasks, knowledge, isEmpty };
}
```

**Tests:** Add to `packages/server/test/learning.test.ts`:
```typescript
describe("gatherSignals", () => {
  it("returns isEmpty: true when no data exists", () => {
    const signals = gatherSignals(storage);
    expect(signals.isEmpty).toBe(true);
    expect(signals.threads).toHaveLength(0);
  });

  it("gathers thread messages newer than watermark", () => {
    // Insert thread + messages via raw SQL
    storage.run("INSERT INTO threads (id, title, created_at, updated_at, message_count) VALUES ('t1', 'Test', datetime('now'), datetime('now'), 1)");
    storage.run("INSERT INTO thread_messages (id, thread_id, role, content, created_at, sequence) VALUES ('m1', 't1', 'user', 'I love TypeScript', datetime('now'), 1)");
    const signals = gatherSignals(storage);
    expect(signals.threads.length).toBe(1);
    expect(signals.threads[0].messages.length).toBe(1);
  });

  it("limits to 3 threads and 20 messages per thread", () => {
    // Insert 5 threads with 25 messages each, verify limits
    for (let t = 0; t < 5; t++) {
      storage.run(`INSERT INTO threads (id, title, created_at, updated_at, message_count) VALUES ('t${t}', 'Thread ${t}', datetime('now'), datetime('now'), 25)`);
      for (let m = 0; m < 25; m++) {
        storage.run(`INSERT INTO thread_messages (id, thread_id, role, content, created_at, sequence) VALUES ('m${t}_${m}', 't${t}', 'user', 'msg ${m}', datetime('now'), ${m})`);
      }
    }
    const signals = gatherSignals(storage);
    expect(signals.threads.length).toBeLessThanOrEqual(3);
    for (const t of signals.threads) {
      expect(t.messages.length).toBeLessThanOrEqual(20);
    }
  });
});
```

**Note:** The test storage needs threads + thread_messages tables. Import `threadMigrations` from `@personal-ai/core` and run `storage.migrate("threads", threadMigrations)` in beforeEach. Also run task and knowledge migrations if testing those signals.

**Verify:** `pnpm --filter @personal-ai/server test`

**Commit:** `feat: add signal gathering functions for background learning`

---

### Task 4: LLM Extraction Prompt + Parsing

**Files:**
- Modify: `packages/server/src/learning.ts`
- Modify: `packages/server/test/learning.test.ts`

**What:** Build the prompt from gathered signals and parse the LLM response into an array of facts.

**Interface:**
```typescript
export interface ExtractedFact {
  fact: string;
  factType: "factual" | "preference" | "procedural" | "architectural";
  importance: number;
  subject: string;
}
```

**Implementation — `buildLearningPrompt(signals)`:**
```typescript
export function buildLearningPrompt(signals: GatheredSignals): string {
  const parts: string[] = [];

  if (signals.threads.length > 0) {
    const msgCount = signals.threads.reduce((acc, t) => acc + t.messages.length, 0);
    parts.push(`RECENT CONVERSATIONS (${msgCount} messages across ${signals.threads.length} threads):`);
    for (const t of signals.threads) {
      parts.push(t.messages.map((m) => `- ${m.content}`).join("\n"));
    }
  }

  if (signals.research.length > 0) {
    parts.push(`\nCOMPLETED RESEARCH (${signals.research.length} reports):`);
    for (const r of signals.research) {
      parts.push(`- Goal: ${r.goal}\n  Findings: ${r.reportSnippet}`);
    }
  }

  if (signals.tasks.length > 0) {
    parts.push(`\nCOMPLETED TASKS (${signals.tasks.length}):`);
    for (const t of signals.tasks) {
      parts.push(`- [${t.priority}] ${t.title}`);
    }
  }

  if (signals.knowledge.length > 0) {
    parts.push(`\nNEW KNOWLEDGE SOURCES (${signals.knowledge.length}):`);
    for (const k of signals.knowledge) {
      parts.push(`- ${k.title} (${k.url}): ${k.firstChunk}`);
    }
  }

  return `You are a background learning agent analyzing recent user activity to extract useful knowledge.

Review the following activity and extract personal facts, topic interests, procedural patterns, and recurring themes.

${parts.join("\n")}

Guidelines:
- Extract facts ABOUT the user or people they mention — preferences, interests, decisions, work patterns
- Extract topic interests — subjects the user engages with repeatedly or deeply
- Extract procedural patterns — how the user works, tools they prefer, recurring workflows
- Do NOT extract generic knowledge or common facts (e.g., "Bitcoin is a cryptocurrency")
- Do NOT extract greetings, pleasantries, or meta-conversation about the AI
- Each fact must be specific and attributable to a person (use "owner" for the user)
- Rate importance 1-10: 1-3 trivial, 4-6 useful, 7-9 core preference/decision
- Maximum 15 facts total
- Keep each fact under 20 words

Respond with ONLY a JSON array (no markdown, no explanation):
[{"fact":"...","factType":"factual|preference|procedural|architectural","importance":N,"subject":"owner|name"},...]

If nothing worth extracting, respond with: []`;
}
```

**Implementation — `parseLearningResponse(text)`:**
```typescript
export function parseLearningResponse(text: string): ExtractedFact[] {
  let jsonText = text.trim();
  // Strip markdown code fences if present
  const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch?.[1]) jsonText = fenceMatch[1].trim();

  try {
    const parsed = JSON.parse(jsonText);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item: Record<string, unknown>) =>
        typeof item.fact === "string" &&
        typeof item.factType === "string" &&
        typeof item.importance === "number" &&
        typeof item.subject === "string" &&
        item.fact.length > 0
      )
      .slice(0, 15)
      .map((item: Record<string, unknown>) => ({
        fact: String(item.fact),
        factType: String(item.factType) as ExtractedFact["factType"],
        importance: Number(item.importance),
        subject: String(item.subject),
      }));
  } catch {
    return [];
  }
}
```

**Tests:**
```typescript
describe("buildLearningPrompt", () => {
  it("builds prompt with all signal types", () => {
    const signals: GatheredSignals = {
      threads: [{ threadId: "t1", messages: [{ role: "user", content: "I prefer React", createdAt: "2026-01-01" }] }],
      research: [{ id: "r1", goal: "Bitcoin analysis", reportSnippet: "BTC is..." }],
      tasks: [{ title: "Setup CI", priority: "high", completedAt: "2026-01-01" }],
      knowledge: [{ title: "React docs", url: "https://react.dev", firstChunk: "React is..." }],
      isEmpty: false,
    };
    const prompt = buildLearningPrompt(signals);
    expect(prompt).toContain("RECENT CONVERSATIONS");
    expect(prompt).toContain("COMPLETED RESEARCH");
    expect(prompt).toContain("COMPLETED TASKS");
    expect(prompt).toContain("NEW KNOWLEDGE SOURCES");
    expect(prompt).toContain("Maximum 15 facts");
  });

  it("omits empty sections", () => {
    const signals: GatheredSignals = {
      threads: [], research: [], tasks: [],
      knowledge: [{ title: "React docs", url: "https://react.dev", firstChunk: "React is..." }],
      isEmpty: false,
    };
    const prompt = buildLearningPrompt(signals);
    expect(prompt).not.toContain("RECENT CONVERSATIONS");
    expect(prompt).toContain("NEW KNOWLEDGE SOURCES");
  });
});

describe("parseLearningResponse", () => {
  it("parses valid JSON array", () => {
    const input = '[{"fact":"User prefers TypeScript","factType":"preference","importance":7,"subject":"owner"}]';
    const facts = parseLearningResponse(input);
    expect(facts).toHaveLength(1);
    expect(facts[0].fact).toBe("User prefers TypeScript");
    expect(facts[0].factType).toBe("preference");
  });

  it("handles markdown-wrapped JSON", () => {
    const input = '```json\n[{"fact":"test","factType":"factual","importance":5,"subject":"owner"}]\n```';
    const facts = parseLearningResponse(input);
    expect(facts).toHaveLength(1);
  });

  it("returns empty array for invalid JSON", () => {
    expect(parseLearningResponse("not json")).toEqual([]);
    expect(parseLearningResponse("{}")).toEqual([]);
  });

  it("caps at 15 facts", () => {
    const items = Array.from({ length: 20 }, (_, i) => ({
      fact: `Fact ${i}`, factType: "factual", importance: 5, subject: "owner",
    }));
    const facts = parseLearningResponse(JSON.stringify(items));
    expect(facts).toHaveLength(15);
  });

  it("filters out items with missing fields", () => {
    const input = '[{"fact":"good","factType":"factual","importance":5,"subject":"owner"},{"bad":true}]';
    const facts = parseLearningResponse(input);
    expect(facts).toHaveLength(1);
  });
});
```

**Verify:** `pnpm --filter @personal-ai/server test`

**Commit:** `feat: add LLM prompt builder and response parser for background learning`

---

### Task 5: Main `runBackgroundLearning` Function

**Files:**
- Modify: `packages/server/src/learning.ts`
- Modify: `packages/server/test/learning.test.ts`

**What:** The orchestrator function that ties everything together: health check, gather signals, call LLM, store facts via `remember()`, update watermarks, log results. All logging is PII-safe (counts and durations only).

**Implementation:**
```typescript
import { generateText } from "ai";
import type { LanguageModel } from "ai";
import { remember } from "@personal-ai/core";

export async function runBackgroundLearning(ctx: PluginContext): Promise<void> {
  const start = Date.now();
  ctx.logger.info("Background learning: starting");

  // Health check
  try {
    const health = await ctx.llm.health();
    if (!health.ok) {
      ctx.logger.info("Background learning: skipped (LLM unavailable)");
      return;
    }
  } catch {
    ctx.logger.info("Background learning: skipped (LLM health check failed)");
    return;
  }

  // Phase 1: Gather signals
  const signals = gatherSignals(ctx.storage);

  ctx.logger.info("Background learning: signals gathered", {
    threadCount: signals.threads.length,
    messageCount: signals.threads.reduce((acc, t) => acc + t.messages.length, 0),
    researchCount: signals.research.length,
    taskCount: signals.tasks.length,
    knowledgeCount: signals.knowledge.length,
  });

  if (signals.isEmpty) {
    // Update watermarks even when empty so we don't re-scan
    const now = new Date().toISOString();
    updateWatermark(ctx.storage, "threads", now);
    updateWatermark(ctx.storage, "research", now);
    updateWatermark(ctx.storage, "tasks", now);
    updateWatermark(ctx.storage, "knowledge", now);
    ctx.logger.info("Background learning: nothing new, skipped LLM call", {
      durationMs: Date.now() - start,
    });
    return;
  }

  // Phase 2: LLM extraction
  const prompt = buildLearningPrompt(signals);
  let facts: ExtractedFact[] = [];

  try {
    const llmStart = Date.now();
    const result = await generateText({
      model: ctx.llm.getModel() as LanguageModel,
      prompt,
      temperature: 0.3,
      maxRetries: 1,
    });
    ctx.logger.debug("Background learning: LLM call complete", {
      durationMs: Date.now() - llmStart,
    });
    facts = parseLearningResponse(result.text);
  } catch (err) {
    ctx.logger.error("Background learning: LLM extraction failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return; // Don't update watermarks on LLM failure
  }

  // Phase 3: Store facts via remember()
  let created = 0;
  let reinforced = 0;

  for (const fact of facts) {
    try {
      const result = await remember(ctx.storage, ctx.llm, fact.fact, ctx.logger);
      if (result.isReinforcement) {
        reinforced++;
      } else {
        created++;
      }
    } catch (err) {
      ctx.logger.debug("Background learning: failed to store a fact", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Phase 4: Update watermarks
  const now = new Date().toISOString();
  updateWatermark(ctx.storage, "threads", now);
  updateWatermark(ctx.storage, "research", now);
  updateWatermark(ctx.storage, "tasks", now);
  updateWatermark(ctx.storage, "knowledge", now);

  const duration = Date.now() - start;
  ctx.logger.info("Background learning: complete", {
    factsExtracted: facts.length,
    beliefsCreated: created,
    beliefsReinforced: reinforced,
    durationMs: duration,
  });
}
```

**Test:** Test the orchestration with a mock LLM. The key behavior to verify:
```typescript
describe("runBackgroundLearning", () => {
  it("skips LLM call when no signals exist", async () => {
    // Create ctx with healthy mock LLM that would fail if called
    // Run the function
    // Verify watermarks were updated
    // Verify no LLM call was made
  });

  it("extracts facts and stores via remember when signals exist", async () => {
    // Insert some thread messages
    // Create ctx with mock LLM that returns a JSON array of facts
    // Run the function
    // Verify beliefs were created (query beliefs table)
    // Verify watermarks were updated
  });

  it("does not update watermarks on LLM failure", async () => {
    // Insert some thread messages
    // Create ctx with mock LLM that throws
    // Run the function
    // Verify watermarks were NOT updated (still at initial value)
  });
});
```

**Note:** For the mock LLM, look at how `packages/server/test/routes.test.ts` or `packages/plugin-research/test/research.test.ts` create mock LLM clients. The mock needs `health()` returning `{ ok: true }`, `getModel()` returning a model, and `embed()` for the `remember()` call. Since `remember()` calls `extractBeliefs()` which calls `llm.generate()`, and also embeds, the mock must handle both.

If mocking is complex, write a simpler integration-style test: verify `gatherSignals` returns correct data, `buildLearningPrompt` builds correctly, and `parseLearningResponse` parses correctly — those three unit tests give confidence the orchestrator works.

**Verify:** `pnpm --filter @personal-ai/server test`

**Commit:** `feat: add runBackgroundLearning orchestrator`

---

### Task 6: Timer Registration + Shutdown

**Files:**
- Modify: `packages/server/src/index.ts`

**What:** Register the background learning worker on a 2-hour timer with a 5-minute initial delay. Clean up on shutdown.

**Implementation:** In `packages/server/src/index.ts`, add import at the top:
```typescript
import { runBackgroundLearning } from "./learning.js";
```

After the briefing timer setup (around line 470), add:
```typescript
const LEARNING_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 hours
const LEARNING_INITIAL_DELAY_MS = 5 * 60 * 1000; // 5 minutes

// Background learning: first run after 5 min, then every 2 hours
const learningInitTimer = setTimeout(() => {
  runBackgroundLearning(ctx).catch((err) => {
    ctx.logger.warn(`Background learning failed: ${err instanceof Error ? err.message : String(err)}`);
  });
}, LEARNING_INITIAL_DELAY_MS);

const learningTimer = setInterval(() => {
  runBackgroundLearning(ctx).catch((err) => {
    ctx.logger.warn(`Background learning failed: ${err instanceof Error ? err.message : String(err)}`);
  });
}, LEARNING_INTERVAL_MS);
```

In the shutdown handler (around line 483), add:
```typescript
clearTimeout(learningInitTimer);
clearInterval(learningTimer);
```

**Verify:** `pnpm build && pnpm test` — all tests pass. Start server, check logs after 5 minutes for "Background learning: starting" message.

**Commit:** `feat: register background learning worker on 2-hour timer`

---

### Task 7: Full Integration Verification

**Files:** None (verification only)

**What:** End-to-end verification that everything works together.

**Steps:**

1. `pnpm build` — clean build
2. `pnpm test` — all tests pass
3. `pnpm typecheck` — no type errors
4. Start server: `PAI_LOG_LEVEL=debug pnpm start`
5. Wait 5 minutes (or temporarily reduce `LEARNING_INITIAL_DELAY_MS` to 5000 for testing)
6. Check logs for:
   - `"Background learning: starting"`
   - `"Background learning: signals gathered"` with counts
   - Either `"Background learning: nothing new"` or `"Background learning: complete"` with fact counts
   - No PII in any log line (no message content, no belief text, no names)
7. If facts were extracted, verify in the Memory page that new beliefs exist
8. Revert any temporary delay change

**Commit:** No code changes — verification only. If issues found, fix and commit.

---

## Execution

Plan complete and saved to `docs/plans/2026-02-27-background-learning-plan.md`. Two execution options:

**1. Subagent-Driven (this session)** — I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** — Open new session with executing-plans, batch execution with checkpoints

Which approach?

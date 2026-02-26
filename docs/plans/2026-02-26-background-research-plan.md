# Background Agent + Research — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable the Personal Assistant to delegate deep research tasks to a background sub-agent that runs autonomously, produces a structured report, and delivers it to the Inbox and originating chat thread.

**Architecture:** Chat-triggered research via `research_start` tool → background `generateText` loop with budget-limited tools (web_search, read_page, knowledge_search) → report stored in `research_jobs` table → Inbox briefing (type: research) + chat thread summary. Shared `BackgroundJob` tracker in core replaces crawl-specific `activeCrawls`.

**Tech Stack:** TypeScript, Vercel AI SDK (`generateText`, `tool`, `stepCountIs`), Zod, better-sqlite3, React + Tailwind + shadcn/ui

---

### Task 1: Shared BackgroundJob type + activeJobs Map in core

**Files:**
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/jobs.test.ts`

**Step 1: Write the failing test**

Create `packages/core/test/jobs.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { activeJobs } from "@personal-ai/core";
import type { BackgroundJob } from "@personal-ai/core";

describe("activeJobs", () => {
  it("is a Map that tracks background jobs", () => {
    expect(activeJobs).toBeInstanceOf(Map);
  });

  it("stores and retrieves a job", () => {
    const job: BackgroundJob = {
      id: "test-1",
      type: "crawl",
      label: "https://example.com",
      status: "running",
      progress: "0/5",
      startedAt: new Date().toISOString(),
    };
    activeJobs.set(job.id, job);
    expect(activeJobs.get("test-1")).toEqual(job);
    activeJobs.delete("test-1"); // cleanup
  });

  it("supports research type", () => {
    const job: BackgroundJob = {
      id: "res-1",
      type: "research",
      label: "Best TypeScript frameworks",
      status: "done",
      progress: "3/5 searches",
      startedAt: new Date().toISOString(),
      result: "# Report\n\nFindings here.",
    };
    activeJobs.set(job.id, job);
    expect(activeJobs.get("res-1")!.type).toBe("research");
    expect(activeJobs.get("res-1")!.result).toContain("Findings");
    activeJobs.delete("res-1");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @personal-ai/core test -- --run test/jobs.test.ts`
Expected: FAIL — `activeJobs` and `BackgroundJob` not exported from core

**Step 3: Write minimal implementation**

Add to `packages/core/src/types.ts` (at the end, after `AgentContext`):

```typescript
// ---- Shared background-job tracker ----

export interface BackgroundJob {
  id: string;
  type: "crawl" | "research";
  label: string;
  status: "running" | "done" | "error";
  progress: string;
  startedAt: string;
  error?: string;
  result?: string;
}

export const activeJobs = new Map<string, BackgroundJob>();
```

Add to `packages/core/src/index.ts` (after the AgentContext export line):

```typescript
export type { BackgroundJob } from "./types.js";
export { activeJobs } from "./types.js";
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @personal-ai/core test -- --run test/jobs.test.ts`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/index.ts packages/core/test/jobs.test.ts
git commit -m "feat: add shared BackgroundJob type and activeJobs tracker to core"
```

---

### Task 2: Migrate crawl jobs to shared tracker

**Files:**
- Modify: `packages/plugin-assistant/src/tools.ts`
- Test: `packages/plugin-assistant/test/crawl-migration.test.ts` (optional — verify via existing tests)

This task replaces the crawl-specific `activeCrawls` Map and `CrawlJob` interface in `packages/plugin-assistant/src/tools.ts` with the shared `activeJobs` from core. The `knowledge_status` tool is renamed to `job_status`.

**Step 1: Write the failing test**

Create `packages/plugin-assistant/test/crawl-migration.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { activeJobs } from "@personal-ai/core";
import type { BackgroundJob } from "@personal-ai/core";

describe("crawl migration to shared jobs", () => {
  it("crawl jobs use shared activeJobs Map", () => {
    // Simulate what runCrawlInBackground now does
    const job: BackgroundJob = {
      id: "crawl-https://example.com",
      type: "crawl",
      label: "https://example.com",
      status: "running",
      progress: "0/5",
      startedAt: new Date().toISOString(),
    };
    activeJobs.set(job.id, job);
    expect(activeJobs.get("crawl-https://example.com")).toBeDefined();
    expect(activeJobs.get("crawl-https://example.com")!.type).toBe("crawl");
    activeJobs.delete(job.id);
  });
});
```

**Step 2: Run test to verify it passes** (this is a type-level migration — test checks the new pattern works)

Run: `pnpm --filter @personal-ai/plugin-assistant test -- --run test/crawl-migration.test.ts`
Expected: PASS

**Step 3: Migrate `packages/plugin-assistant/src/tools.ts`**

Remove lines 10-26 (the `CrawlJob` interface, `activeCrawls` Map, and `export { type CrawlJob }`).

Add import at top:

```typescript
import { activeJobs } from "@personal-ai/core";
import type { BackgroundJob } from "@personal-ai/core";
```

Rewrite `runCrawlInBackground` (lines 28-65) to use `activeJobs`:

```typescript
export async function runCrawlInBackground(storage: Storage, llm: LLMClient, rootUrl: string, subPages: string[]): Promise<void> {
  const maxPages = Math.min(subPages.length, 30);
  const jobId = `crawl-${rootUrl}`;
  const job: BackgroundJob = {
    id: jobId,
    type: "crawl",
    label: rootUrl,
    status: "running",
    progress: `0/${maxPages}`,
    startedAt: new Date().toISOString(),
  };
  activeJobs.set(jobId, job);

  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let learned = 0;
  let skipped = 0;
  let failed = 0;

  try {
    for (let i = 0; i < maxPages; i++) {
      if (i > 0) await delay(1000);
      try {
        const pageUrl = subPages[i]!;
        const subPage = await fetchPageAsMarkdown(pageUrl);
        if (!subPage) { failed++; continue; }
        const result = await learnFromContent(storage, llm, pageUrl, subPage.title, subPage.markdown);
        if (result.skipped) skipped++;
        else learned++;
      } catch {
        failed++;
      }
      job.progress = `${learned + skipped + failed}/${maxPages}`;
    }
    job.status = "done";
    job.result = `Learned: ${learned}, Skipped: ${skipped}, Failed: ${failed}`;
  } catch (err) {
    job.status = "error";
    job.error = err instanceof Error ? err.message : String(err);
  }
}
```

Rename `knowledge_status` tool to `job_status` and update it to use `activeJobs`:

```typescript
    job_status: tool({
      description: "Check the status of background jobs (crawl, research). Use when the user asks about crawl progress, research status, or background tasks.",
      inputSchema: z.object({}),
      execute: async () => {
        if (activeJobs.size === 0) return "No background jobs running or recently completed.";

        const jobs = [...activeJobs.entries()].map(([id, job]) => ({
          id,
          type: job.type,
          label: job.label,
          status: job.status,
          progress: job.progress,
          startedAt: job.startedAt,
          ...(job.error ? { error: job.error } : {}),
          ...(job.result ? { result: job.result } : {}),
        }));

        // Clean up completed jobs older than 10 minutes
        const cutoff = Date.now() - 10 * 60 * 1000;
        for (const [id, job] of activeJobs) {
          if (job.status !== "running" && new Date(job.startedAt).getTime() < cutoff) {
            activeJobs.delete(id);
          }
        }

        return jobs;
      },
    }),
```

Also update `learn_from_url` tool's reference from `knowledge_status` to `job_status`:

```
return `${mainMsg}\n\nStarted crawling ${maxPages} sub-pages in the background. Use job_status to check progress.`;
```

**Step 4: Update the system prompt in `packages/plugin-assistant/src/index.ts`**

Change `knowledge_status` to `job_status` in the tool reference section:

```
- **job_status**: Check progress of background jobs (crawl, research)
```

**Step 5: Update the UI tool card dispatcher**

In `packages/ui/src/components/tools/index.tsx`, update line 87:

Change:
```typescript
    case "knowledge_status":
```
To:
```typescript
    case "knowledge_status":
    case "job_status":
```

And in `packages/ui/src/components/tools/ToolKnowledgeAction.tsx`, update the type union and messages:

Change interface:
```typescript
  toolName: "learn_from_url" | "knowledge_forget" | "knowledge_status" | "job_status";
```

Add to the `messages` object in the `input-available` block:
```typescript
      job_status: "Checking background job status...",
```

Add to the `errorMessages`:
```typescript
      job_status: "Failed to check job status.",
```

**Step 6: Run full test suite**

Run: `pnpm test`
Expected: All tests pass

**Step 7: Commit**

```bash
git add packages/plugin-assistant/src/tools.ts packages/plugin-assistant/src/index.ts packages/plugin-assistant/test/crawl-migration.test.ts packages/ui/src/components/tools/index.tsx packages/ui/src/components/tools/ToolKnowledgeAction.tsx
git commit -m "refactor: migrate crawl jobs to shared activeJobs tracker, rename knowledge_status to job_status"
```

---

### Task 3: Add `type` column to briefings table

**Files:**
- Modify: `packages/server/src/briefing.ts`
- Modify: `packages/server/test/briefing.test.ts`

**Step 1: Write the failing test**

Add to `packages/server/test/briefing.test.ts`, inside the "Briefing CRUD" describe block:

```typescript
  describe("briefing type column", () => {
    it("defaults to 'daily' for existing briefings", () => {
      insertBriefing("daily-1", { greeting: "hi" });
      const row = storage.query<{ type: string }>("SELECT type FROM briefings WHERE id = 'daily-1'");
      expect(row[0]!.type).toBe("daily");
    });

    it("stores research type briefings", () => {
      storage.run(
        "INSERT INTO briefings (id, generated_at, sections, raw_context, status, type) VALUES (?, datetime('now'), ?, null, 'ready', 'research')",
        ["res-1", JSON.stringify({ report: "findings" })],
      );
      const row = storage.query<{ type: string }>("SELECT type FROM briefings WHERE id = 'res-1'");
      expect(row[0]!.type).toBe("research");
    });

    it("getLatestBriefing only returns daily type by default", () => {
      insertBriefing("daily-old", { greeting: "old" }, "ready", "2025-01-01 00:00:00");
      storage.run(
        "INSERT INTO briefings (id, generated_at, sections, raw_context, status, type) VALUES (?, '2025-12-01 00:00:00', ?, null, 'ready', 'research')",
        ["res-latest", JSON.stringify({ report: "findings" })],
      );
      const result = getLatestBriefing(storage);
      expect(result).not.toBeNull();
      expect(result!.id).toBe("daily-old");
    });
  });
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @personal-ai/server test -- --run test/briefing.test.ts`
Expected: FAIL — `type` column doesn't exist

**Step 3: Add migration v2**

In `packages/server/src/briefing.ts`, add to the `briefingMigrations` array:

```typescript
  {
    version: 2,
    up: `ALTER TABLE briefings ADD COLUMN type TEXT NOT NULL DEFAULT 'daily';`,
  },
```

Update `getLatestBriefing` query to filter by `type = 'daily'`:

```typescript
export function getLatestBriefing(storage: Storage): Briefing | null {
  const rows = storage.query<BriefingRow>(
    "SELECT * FROM briefings WHERE status = 'ready' AND type = 'daily' ORDER BY generated_at DESC LIMIT 1",
  );
  // ... rest unchanged
}
```

Update `listBriefings` to also filter daily only:

```typescript
export function listBriefings(storage: Storage): Array<{ id: string; generatedAt: string }> {
  return storage.query<{ id: string; generated_at: string }>(
    "SELECT id, generated_at FROM briefings WHERE status = 'ready' AND type = 'daily' ORDER BY generated_at DESC LIMIT 30",
  ).map((row) => ({ id: row.id, generatedAt: row.generated_at }));
}
```

Add new function `getResearchBriefings`:

```typescript
export function getResearchBriefings(storage: Storage): Briefing[] {
  const rows = storage.query<BriefingRow>(
    "SELECT * FROM briefings WHERE status = 'ready' AND type = 'research' ORDER BY generated_at DESC LIMIT 20",
  );
  return rows.map(parseBriefingRow);
}
```

Also add a `createResearchBriefing` function:

```typescript
export function createResearchBriefing(
  storage: Storage,
  id: string,
  report: string,
  goal: string,
): void {
  storage.run(
    "INSERT INTO briefings (id, generated_at, sections, raw_context, status, type) VALUES (?, datetime('now'), ?, ?, 'ready', 'research')",
    [id, JSON.stringify({ report, goal }), null],
  );
}
```

Export `getResearchBriefings` and `createResearchBriefing` from the module.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @personal-ai/server test -- --run test/briefing.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/server/src/briefing.ts packages/server/test/briefing.test.ts
git commit -m "feat: add type column to briefings table, support research briefings"
```

---

### Task 4: Create plugin-research package — scaffolding

**Files:**
- Create: `packages/plugin-research/package.json`
- Create: `packages/plugin-research/tsconfig.json`
- Create: `packages/plugin-research/src/index.ts`
- Create: `packages/plugin-research/src/research.ts`

**Step 1: Create package.json**

```json
{
  "name": "@personal-ai/plugin-research",
  "version": "0.1.0",
  "description": "Background research agent — deep web research with budget-limited multi-step execution",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/devjarus/pai.git",
    "directory": "packages/plugin-research"
  },
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
    "test": "vitest run --passWithNoTests",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@personal-ai/core": "workspace:*",
    "ai": "^6.0.0",
    "nanoid": "^5.0.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.0.0",
    "@types/node": "^22.0.0"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*.ts"],
  "references": [
    { "path": "../core" }
  ]
}
```

**Step 3: Create `src/index.ts`** — plugin definition with system prompt

```typescript
import type { Plugin, PluginContext, Command, Migration } from "@personal-ai/core";

export { runResearchInBackground } from "./research.js";
export type { ResearchJob } from "./research.js";

export const researchMigrations: Migration[] = [
  {
    version: 1,
    up: `
      CREATE TABLE IF NOT EXISTS research_jobs (
        id TEXT PRIMARY KEY,
        thread_id TEXT,
        goal TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        budget_max_searches INTEGER DEFAULT 5,
        budget_max_pages INTEGER DEFAULT 3,
        searches_used INTEGER DEFAULT 0,
        pages_learned INTEGER DEFAULT 0,
        steps_log TEXT DEFAULT '[]',
        report TEXT,
        briefing_id TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_research_jobs_status ON research_jobs(status);
    `,
  },
];

export const researchPlugin: Plugin = {
  name: "research",
  version: "0.1.0",
  migrations: researchMigrations,
  commands(_ctx: PluginContext): Command[] {
    return [];
  },
};
```

**Step 4: Create `src/research.ts`** — stub (filled in Task 5)

```typescript
import type { Storage, LLMClient, Logger } from "@personal-ai/core";

export interface ResearchJob {
  id: string;
  threadId: string | null;
  goal: string;
  status: "pending" | "running" | "done" | "failed";
  budgetMaxSearches: number;
  budgetMaxPages: number;
  searchesUsed: number;
  pagesLearned: number;
  stepsLog: string[];
  report: string | null;
  briefingId: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface ResearchContext {
  storage: Storage;
  llm: LLMClient;
  logger: Logger;
}

export async function runResearchInBackground(
  _ctx: ResearchContext,
  _jobId: string,
): Promise<void> {
  // Implemented in Task 5
  throw new Error("Not implemented");
}
```

**Step 5: Install dependencies**

Run: `pnpm install`

**Step 6: Build to verify**

Run: `pnpm --filter @personal-ai/plugin-research build`
Expected: Compiles successfully

**Step 7: Commit**

```bash
git add packages/plugin-research/
git commit -m "feat: scaffold plugin-research package with migrations and types"
```

---

### Task 5: Implement research agent execution logic

**Files:**
- Modify: `packages/plugin-research/src/research.ts`
- Test: `packages/plugin-research/test/research.test.ts`

**Step 1: Write the failing tests**

Create `packages/plugin-research/test/research.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStorage } from "@personal-ai/core";
import type { Storage } from "@personal-ai/core";
import { researchMigrations } from "../src/index.js";
import { runResearchInBackground, getResearchJob, createResearchJob } from "../src/research.js";
import type { ResearchContext } from "../src/research.js";

// Mock the AI SDK
vi.mock("ai", () => ({
  generateText: vi.fn(),
  tool: vi.fn((def: unknown) => def),
}));

describe("Research jobs", () => {
  let dir: string;
  let storage: Storage;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pai-research-test-"));
    storage = createStorage(dir);
    storage.migrate("research", researchMigrations);
    vi.clearAllMocks();
  });

  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function makeCtx(): ResearchContext {
    return {
      storage,
      llm: {
        chat: vi.fn(),
        streamChat: vi.fn(),
        embed: vi.fn(),
        health: vi.fn().mockResolvedValue({ ok: true }),
        getModel: vi.fn().mockReturnValue("mock-model"),
      } as never,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
    };
  }

  describe("createResearchJob", () => {
    it("creates a job with pending status", () => {
      const id = createResearchJob(storage, {
        goal: "Best TypeScript frameworks 2026",
        threadId: "thread-1",
      });
      const job = getResearchJob(storage, id);
      expect(job).not.toBeNull();
      expect(job!.status).toBe("pending");
      expect(job!.goal).toBe("Best TypeScript frameworks 2026");
      expect(job!.threadId).toBe("thread-1");
      expect(job!.budgetMaxSearches).toBe(5);
      expect(job!.budgetMaxPages).toBe(3);
    });
  });

  describe("getResearchJob", () => {
    it("returns null for non-existent job", () => {
      expect(getResearchJob(storage, "nope")).toBeNull();
    });
  });

  describe("runResearchInBackground", () => {
    it("sets job to running then done on success", async () => {
      const { generateText } = await import("ai");
      (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
        text: "# Research Report\n\n## Summary\nFindings here.\n\n## Key Findings\n- Finding 1\n\n## Sources\n- https://example.com",
        steps: [],
      });

      const ctx = makeCtx();
      const id = createResearchJob(storage, {
        goal: "Test research",
        threadId: "thread-1",
      });

      await runResearchInBackground(ctx, id);

      const job = getResearchJob(storage, id);
      expect(job!.status).toBe("done");
      expect(job!.report).toContain("Research Report");
      expect(job!.completedAt).not.toBeNull();
    });

    it("sets job to failed when generateText throws", async () => {
      const { generateText } = await import("ai");
      (generateText as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("LLM unavailable"),
      );

      const ctx = makeCtx();
      const id = createResearchJob(storage, {
        goal: "Failing research",
        threadId: null,
      });

      await runResearchInBackground(ctx, id);

      const job = getResearchJob(storage, id);
      expect(job!.status).toBe("failed");
    });

    it("registers and cleans up job in activeJobs", async () => {
      const { activeJobs } = await import("@personal-ai/core");
      const { generateText } = await import("ai");
      (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
        text: "# Report\nDone.",
        steps: [],
      });

      const ctx = makeCtx();
      const id = createResearchJob(storage, {
        goal: "Tracked research",
        threadId: null,
      });

      await runResearchInBackground(ctx, id);

      // Job should be in activeJobs with status done
      const tracked = activeJobs.get(id);
      expect(tracked).toBeDefined();
      expect(tracked!.status).toBe("done");
      expect(tracked!.type).toBe("research");

      // Cleanup
      activeJobs.delete(id);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @personal-ai/plugin-research test -- --run test/research.test.ts`
Expected: FAIL — `createResearchJob`, `getResearchJob` not exported, `runResearchInBackground` throws "Not implemented"

**Step 3: Implement `packages/plugin-research/src/research.ts`**

```typescript
import { generateText, tool } from "ai";
import type { LanguageModel } from "ai";
import { z } from "zod";
import { nanoid } from "nanoid";
import type { Storage, LLMClient, Logger } from "@personal-ai/core";
import { activeJobs, knowledgeSearch } from "@personal-ai/core";
import type { BackgroundJob } from "@personal-ai/core";

// ---- Types ----

export interface ResearchJob {
  id: string;
  threadId: string | null;
  goal: string;
  status: "pending" | "running" | "done" | "failed";
  budgetMaxSearches: number;
  budgetMaxPages: number;
  searchesUsed: number;
  pagesLearned: number;
  stepsLog: string[];
  report: string | null;
  briefingId: string | null;
  createdAt: string;
  completedAt: string | null;
}

interface ResearchJobRow {
  id: string;
  thread_id: string | null;
  goal: string;
  status: string;
  budget_max_searches: number;
  budget_max_pages: number;
  searches_used: number;
  pages_learned: number;
  steps_log: string;
  report: string | null;
  briefing_id: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface ResearchContext {
  storage: Storage;
  llm: LLMClient;
  logger: Logger;
}

// ---- Data Access ----

export function createResearchJob(
  storage: Storage,
  opts: { goal: string; threadId: string | null; maxSearches?: number; maxPages?: number },
): string {
  const id = nanoid();
  storage.run(
    `INSERT INTO research_jobs (id, thread_id, goal, status, budget_max_searches, budget_max_pages, created_at)
     VALUES (?, ?, ?, 'pending', ?, ?, datetime('now'))`,
    [id, opts.threadId, opts.goal, opts.maxSearches ?? 5, opts.maxPages ?? 3],
  );
  return id;
}

export function getResearchJob(storage: Storage, id: string): ResearchJob | null {
  const rows = storage.query<ResearchJobRow>(
    "SELECT * FROM research_jobs WHERE id = ?",
    [id],
  );
  if (rows.length === 0) return null;
  const row = rows[0]!;
  return {
    id: row.id,
    threadId: row.thread_id,
    goal: row.goal,
    status: row.status as ResearchJob["status"],
    budgetMaxSearches: row.budget_max_searches,
    budgetMaxPages: row.budget_max_pages,
    searchesUsed: row.searches_used,
    pagesLearned: row.pages_learned,
    stepsLog: JSON.parse(row.steps_log) as string[],
    report: row.report,
    briefingId: row.briefing_id,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

function updateJob(storage: Storage, id: string, fields: Record<string, unknown>): void {
  const sets = Object.keys(fields).map((k) => `${k} = ?`).join(", ");
  const values = Object.values(fields);
  storage.run(`UPDATE research_jobs SET ${sets} WHERE id = ?`, [...values, id]);
}

// ---- Research Agent System Prompt ----

const RESEARCH_SYSTEM_PROMPT = `You are a Research Agent. Your job is to thoroughly research a topic and produce a structured report.

## Process
1. Plan your research approach (which searches to run, what to look for)
2. Execute searches using web_search
3. Read important pages using read_page to get detailed content
4. Check existing knowledge using knowledge_search
5. Synthesize findings into a structured report

## Report Format
Your final response MUST be a structured markdown report:

# Research Report: [Topic]

## Summary
[2-3 sentence overview of findings]

## Key Findings
- [Finding 1 with detail]
- [Finding 2 with detail]
- [Finding 3 with detail]

## Sources
- [URL 1] — [what it contributed]
- [URL 2] — [what it contributed]

## Budget
You have a limited budget for searches and page reads. When a tool tells you the budget is exhausted, stop searching and synthesize what you have into the report.

Be thorough but efficient. Focus on the most relevant and authoritative sources.`;

// ---- Budget-Limited Tool Factories ----

function createResearchTools(
  ctx: ResearchContext,
  jobId: string,
  job: { budgetMaxSearches: number; budgetMaxPages: number },
) {
  let searchesUsed = 0;
  let pagesRead = 0;

  return {
    web_search: tool({
      description: "Search the web for information. Budget-limited.",
      parameters: z.object({
        query: z.string().describe("Search query"),
      }),
      execute: async ({ query }: { query: string }) => {
        if (searchesUsed >= job.budgetMaxSearches) {
          return "Budget exhausted — you've used all your web searches. Synthesize your findings into the report now.";
        }
        searchesUsed++;
        updateJob(ctx.storage, jobId, { searches_used: searchesUsed });

        try {
          // Dynamic import to avoid hard dependency on plugin-assistant
          const { webSearch, formatSearchResults } = await import("@personal-ai/plugin-assistant/web-search");
          const results = await webSearch(query, 5);
          if (results.length === 0) return "No results found for this query.";
          return formatSearchResults(results);
        } catch (err) {
          return `Search failed: ${err instanceof Error ? err.message : "unknown error"}`;
        }
      },
    }),

    read_page: tool({
      description: "Fetch and read a web page to get detailed content. Budget-limited.",
      parameters: z.object({
        url: z.string().url().describe("URL to read"),
      }),
      execute: async ({ url }: { url: string }) => {
        if (pagesRead >= job.budgetMaxPages) {
          return "Budget exhausted — you've used all your page reads. Synthesize your findings into the report now.";
        }
        pagesRead++;
        updateJob(ctx.storage, jobId, { pages_learned: pagesRead });

        try {
          const { fetchPageAsMarkdown } = await import("@personal-ai/plugin-assistant/page-fetch");
          const page = await fetchPageAsMarkdown(url);
          if (!page) return "Could not extract content from this page.";
          // Return truncated content to stay within context limits
          return `# ${page.title}\n\n${page.markdown.slice(0, 3000)}`;
        } catch (err) {
          return `Failed to read page: ${err instanceof Error ? err.message : "unknown error"}`;
        }
      },
    }),

    knowledge_search: tool({
      description: "Search existing knowledge base for relevant information already learned.",
      parameters: z.object({
        query: z.string().describe("What to search for"),
      }),
      execute: async ({ query }: { query: string }) => {
        try {
          const results = await knowledgeSearch(ctx.storage, ctx.llm, query, 3);
          if (results.length === 0) return "No existing knowledge on this topic.";
          return results.slice(0, 3).map((r) => ({
            content: r.chunk.content.slice(0, 500),
            source: r.source.title,
          }));
        } catch {
          return "Knowledge search unavailable.";
        }
      },
    }),
  };
}

// ---- Background Execution ----

export async function runResearchInBackground(
  ctx: ResearchContext,
  jobId: string,
): Promise<void> {
  const job = getResearchJob(ctx.storage, jobId);
  if (!job) {
    ctx.logger.error(`Research job ${jobId} not found`);
    return;
  }

  // Register in shared tracker
  const tracked: BackgroundJob = {
    id: jobId,
    type: "research",
    label: job.goal.slice(0, 100),
    status: "running",
    progress: "starting",
    startedAt: new Date().toISOString(),
  };
  activeJobs.set(jobId, tracked);

  // Set status to running
  updateJob(ctx.storage, jobId, { status: "running" });

  try {
    const tools = createResearchTools(ctx, jobId, job);

    const result = await generateText({
      model: ctx.llm.getModel() as LanguageModel,
      system: RESEARCH_SYSTEM_PROMPT,
      messages: [
        { role: "user", content: `Research this topic thoroughly: ${job.goal}` },
      ],
      tools,
      toolChoice: "auto",
      maxSteps: 8,
      maxRetries: 1,
    });

    const report = result.text || "Research completed but no report was generated.";

    // Store report and mark done
    updateJob(ctx.storage, jobId, {
      status: "done",
      report,
      completed_at: new Date().toISOString(),
    });

    tracked.status = "done";
    tracked.progress = "complete";
    tracked.result = report.slice(0, 200);

    ctx.logger.info(`Research job ${jobId} completed`, { goal: job.goal });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    updateJob(ctx.storage, jobId, {
      status: "failed",
      completed_at: new Date().toISOString(),
    });

    tracked.status = "error";
    tracked.error = errorMsg;

    ctx.logger.error(`Research job ${jobId} failed: ${errorMsg}`);
  }
}
```

**Step 4: Update `packages/plugin-research/src/index.ts`** to export the new functions

Update the exports:

```typescript
export { runResearchInBackground, createResearchJob, getResearchJob } from "./research.js";
export type { ResearchJob, ResearchContext } from "./research.js";
```

**Step 5: Add subpath exports to `packages/plugin-assistant/package.json`**

The research plugin needs to import `webSearch` and `fetchPageAsMarkdown` from plugin-assistant. Add subpath exports:

```json
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./web-search": {
      "types": "./dist/web-search.d.ts",
      "import": "./dist/web-search.js"
    },
    "./page-fetch": {
      "types": "./dist/page-fetch.d.ts",
      "import": "./dist/page-fetch.js"
    }
  },
```

Add `@personal-ai/plugin-assistant` as a dependency of plugin-research in `packages/plugin-research/package.json`:

```json
  "dependencies": {
    "@personal-ai/core": "workspace:*",
    "@personal-ai/plugin-assistant": "workspace:*",
    "ai": "^6.0.0",
    "nanoid": "^5.0.0",
    "zod": "^3.24.0"
  },
```

Also add `../plugin-assistant` to the tsconfig references:

```json
  "references": [
    { "path": "../core" },
    { "path": "../plugin-assistant" }
  ]
```

**Step 6: Run tests**

Run: `pnpm install && pnpm --filter @personal-ai/plugin-research build && pnpm --filter @personal-ai/plugin-research test -- --run test/research.test.ts`
Expected: PASS (4+ tests)

**Step 7: Commit**

```bash
git add packages/plugin-research/ packages/plugin-assistant/package.json
git commit -m "feat: implement research agent with budget-limited tools and background execution"
```

---

### Task 6: Add `research_start` tool to plugin-assistant

**Files:**
- Modify: `packages/plugin-assistant/src/tools.ts`
- Modify: `packages/plugin-assistant/src/index.ts`

**Step 1: Add import and tool**

In `packages/plugin-assistant/src/tools.ts`, add import:

```typescript
import { createResearchJob, runResearchInBackground } from "@personal-ai/plugin-research";
```

Add the `research_start` tool to the returned object in `createAgentTools`, before `job_status`:

```typescript
    research_start: tool({
      description: "Start a deep research task that runs in the background. Use when the user asks you to research a topic thoroughly, investigate something in depth, or compile a report. The research runs autonomously and delivers results to the Inbox.",
      inputSchema: z.object({
        goal: z.string().describe("What to research — be specific about the topic and what kind of information to find"),
      }),
      execute: async ({ goal }) => {
        try {
          const jobId = createResearchJob(ctx.storage, {
            goal,
            threadId: null, // Will be set by the server route that knows the thread ID
          });

          // Fire and forget
          runResearchInBackground(
            { storage: ctx.storage, llm: ctx.llm, logger: ctx.logger },
            jobId,
          ).catch((err) => {
            ctx.logger.error(`Research background execution failed: ${err instanceof Error ? err.message : String(err)}`);
          });

          return `Research started! I'm investigating "${goal}" in the background. The report will appear in your Inbox when it's done. Use job_status to check progress.`;
        } catch (err) {
          return `Failed to start research: ${err instanceof Error ? err.message : "unknown error"}`;
        }
      },
    }),
```

**Step 2: Update system prompt tool reference**

In `packages/plugin-assistant/src/index.ts`, add to the tool reference section:

```
- **research_start**: Start a deep background research task — use when the user asks to research something thoroughly
```

**Step 3: Add plugin-research dependency to plugin-assistant**

In `packages/plugin-assistant/package.json`, add:

```json
    "@personal-ai/plugin-research": "workspace:*",
```

Also update tsconfig references:

```json
  "references": [
    { "path": "../core" },
    { "path": "../plugin-research" }
  ]
```

**Step 4: Build and verify**

Run: `pnpm install && pnpm build`
Expected: Compiles without errors

**Step 5: Commit**

```bash
git add packages/plugin-assistant/src/tools.ts packages/plugin-assistant/src/index.ts packages/plugin-assistant/package.json packages/plugin-assistant/tsconfig.json
git commit -m "feat: add research_start tool to assistant agent"
```

---

### Task 7: Register plugin-research in server + deliver reports to Inbox and thread

**Files:**
- Modify: `packages/server/src/index.ts`
- Modify: `packages/plugin-research/src/research.ts`
- Modify: `packages/server/package.json`

**Step 1: Register in server**

In `packages/server/src/index.ts`, add imports:

```typescript
import { researchMigrations } from "@personal-ai/plugin-research";
```

Add migration call after the existing ones (around line 94):

```typescript
storage.migrate("research", researchMigrations);
```

Add `@personal-ai/plugin-research` to `packages/server/package.json` dependencies:

```json
    "@personal-ai/plugin-research": "workspace:*",
```

**Step 2: Add report delivery to Inbox and thread**

In `packages/plugin-research/src/research.ts`, after storing the report (in the success path of `runResearchInBackground`), add Inbox briefing creation and thread reply:

Import at top:

```typescript
import { appendMessages } from "@personal-ai/core";
```

After `updateJob(ctx.storage, jobId, { status: "done", report, ... })`:

```typescript
    // Create Inbox briefing for the report
    try {
      const briefingId = `research-${jobId}`;
      ctx.storage.run(
        "INSERT INTO briefings (id, generated_at, sections, raw_context, status, type) VALUES (?, datetime('now'), ?, null, 'ready', 'research')",
        [briefingId, JSON.stringify({ report, goal: job.goal })],
      );
      updateJob(ctx.storage, jobId, { briefing_id: briefingId });
    } catch (err) {
      ctx.logger.warn(`Failed to create research briefing: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Append summary to originating chat thread
    if (job.threadId) {
      try {
        const summary = report.length > 500
          ? report.slice(0, 500) + "\n\n*Full report available in your Inbox.*"
          : report;
        appendMessages(ctx.storage, job.threadId, [
          { role: "assistant", content: `Research complete: "${job.goal}"\n\n${summary}` },
        ]);
      } catch (err) {
        ctx.logger.warn(`Failed to append research results to thread: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
```

Note: The `research_start` tool in plugin-assistant currently passes `threadId: null`. To get the actual thread ID, we need to modify it. Update in `packages/plugin-assistant/src/tools.ts`:

The tool's execute function doesn't have access to the thread ID directly. Instead, we'll pass it through the `AgentContext`. The `ctx` object available in `createAgentTools` doesn't contain the thread ID, but we can add a simple mechanism.

Actually, the simplest approach: store the thread ID as a custom property on the context. In `packages/server/src/routes/agents.ts`, when creating the `agentCtx`, the `sid` (session ID = thread ID) is available. We can attach it:

In `packages/server/src/routes/agents.ts`, add to agentCtx creation (where `const agentCtx: AgentContext = ...` is):

```typescript
// Extend with thread ID for background jobs
(agentCtx as Record<string, unknown>).threadId = sid;
```

Then in the `research_start` tool:

```typescript
threadId: (ctx as Record<string, unknown>).threadId as string ?? null,
```

**Step 3: Build and test**

Run: `pnpm install && pnpm build && pnpm test`
Expected: All tests pass

**Step 4: Commit**

```bash
git add packages/server/src/index.ts packages/server/package.json packages/plugin-research/src/research.ts packages/plugin-assistant/src/tools.ts packages/server/src/routes/agents.ts
git commit -m "feat: register plugin-research in server, deliver reports to Inbox and chat thread"
```

---

### Task 8: UI tool card for `research_start`

**Files:**
- Create: `packages/ui/src/components/tools/ToolResearchStart.tsx`
- Modify: `packages/ui/src/components/tools/index.tsx`

**Step 1: Create tool card component**

Create `packages/ui/src/components/tools/ToolResearchStart.tsx`:

```tsx
import { SearchIcon, CheckIcon, AlertCircleIcon, LoaderIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface ToolResearchStartProps {
  state: string;
  input?: { goal?: string };
  output?: string;
}

export function ToolResearchStart({ state, input, output }: ToolResearchStartProps) {
  const goal = input?.goal;

  if (state === "input-available") {
    return (
      <Card className="gap-0 rounded-lg border-border/50 py-0 shadow-none">
        <CardContent className="flex items-center gap-2 px-3 py-2.5">
          <LoaderIcon className="size-3.5 shrink-0 animate-spin text-primary" />
          <span className="text-xs text-muted-foreground">
            Starting research{goal ? `: "${goal.slice(0, 80)}"` : "..."}
          </span>
        </CardContent>
      </Card>
    );
  }

  if (state === "output-error") {
    return (
      <Card className="gap-0 rounded-lg border-destructive/50 py-0 shadow-none">
        <CardContent className="flex items-center gap-2 px-3 py-2.5">
          <AlertCircleIcon className="size-3.5 shrink-0 text-destructive" />
          <span className="text-xs text-destructive">Failed to start research.</span>
        </CardContent>
      </Card>
    );
  }

  if (state === "output-available") {
    return (
      <Card className="gap-0 rounded-lg border-green-500/10 py-0 shadow-none">
        <CardContent className="flex items-center gap-2 px-3 py-2.5">
          <SearchIcon className="size-3.5 shrink-0 text-green-500" />
          <span className="text-xs text-foreground">
            {typeof output === "string" ? output.slice(0, 120) : `Research started${goal ? `: "${goal.slice(0, 60)}"` : ""}`}
          </span>
        </CardContent>
      </Card>
    );
  }

  return null;
}
```

**Step 2: Register in dispatcher**

In `packages/ui/src/components/tools/index.tsx`:

Add import:
```typescript
import { ToolResearchStart } from "./ToolResearchStart";
```

Add export:
```typescript
export { ToolResearchStart } from "./ToolResearchStart";
```

Add case in `renderToolPart` switch, before the `default`:

```typescript
    case "research_start":
      return <ToolResearchStart key={key} state={state} input={input} output={output} />;
```

**Step 3: Build UI to verify**

Run: `pnpm --filter @personal-ai/ui build`
Expected: Compiles without errors

**Step 4: Commit**

```bash
git add packages/ui/src/components/tools/ToolResearchStart.tsx packages/ui/src/components/tools/index.tsx
git commit -m "feat: add research_start tool card to chat UI"
```

---

### Task 9: UI Inbox — render research briefings

**Files:**
- Modify: `packages/ui/src/types.ts`
- Modify: `packages/ui/src/api.ts`
- Modify: `packages/ui/src/pages/Inbox.tsx`
- Modify: `packages/server/src/routes/inbox.ts`

**Step 1: Update types**

In `packages/ui/src/types.ts`, update the `Briefing` interface:

```typescript
export interface Briefing {
  id: string;
  generatedAt: string;
  sections: BriefingSection;
  status: string;
  type?: "daily" | "research";
}
```

Add a research briefing type:

```typescript
export interface ResearchBriefing {
  id: string;
  generatedAt: string;
  sections: { report: string; goal: string };
  status: string;
  type: "research";
}
```

**Step 2: Add API endpoint for research briefings**

In `packages/server/src/routes/inbox.ts`, add a new route:

```typescript
app.get("/api/inbox/research", async (_req, reply) => {
  const briefings = getResearchBriefings(serverCtx.ctx.storage);
  return reply.send({ briefings });
});
```

Import `getResearchBriefings` from `../briefing.js`.

In `packages/ui/src/api.ts`, add:

```typescript
export async function getResearchBriefings(): Promise<{ briefings: ResearchBriefing[] }> {
  const res = await fetch("/api/inbox/research");
  if (!res.ok) throw new Error("Failed to fetch research briefings");
  return res.json();
}
```

**Step 3: Render research briefings in Inbox**

In `packages/ui/src/pages/Inbox.tsx`, after the suggestions section and before `<div className="h-8" />`, add:

```tsx
        {/* Research Reports */}
        <ResearchReports />
```

Create the `ResearchReports` component in the same file:

```tsx
import { SearchIcon } from "lucide-react";
import type { ResearchBriefing } from "../types";
import { getResearchBriefings } from "../api";
import ReactMarkdown from "react-markdown";

function ResearchReports() {
  const [reports, setReports] = useState<ResearchBriefing[]>([]);

  useEffect(() => {
    getResearchBriefings()
      .then((data) => setReports(data.briefings))
      .catch(() => {}); // silent fail
  }, []);

  if (reports.length === 0) return null;

  return (
    <div className="inbox-fade-in space-y-3" style={{ animationDelay: "400ms" }}>
      <div className="flex items-center gap-2">
        <SearchIcon className="h-4 w-4 text-blue-400" />
        <h3 className="font-mono text-sm font-semibold text-foreground">Research Reports</h3>
        <Badge variant="outline" className="text-[10px] border-blue-500/20 bg-blue-500/10 text-blue-400">
          {reports.length}
        </Badge>
      </div>
      <div className="space-y-2">
        {reports.slice(0, 5).map((r) => (
          <Card
            key={r.id}
            className="inbox-card border-border/30 bg-card/40 transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-500/30 hover:shadow-lg hover:shadow-blue-500/5"
          >
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium text-foreground">
                    {r.sections.goal}
                  </span>
                  <p className="mt-1 text-xs text-muted-foreground line-clamp-3">
                    {r.sections.report.slice(0, 200)}
                  </p>
                  <p className="mt-1 text-[10px] text-muted-foreground/60">
                    {timeAgo(r.generatedAt)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
```

**Step 4: Update `getResearchBriefings` in briefing.ts to parse rows properly**

In `packages/server/src/briefing.ts`, ensure `getResearchBriefings` parses sections:

```typescript
export function getResearchBriefings(storage: Storage): Array<{
  id: string;
  generatedAt: string;
  sections: { report: string; goal: string };
  status: string;
  type: "research";
}> {
  const rows = storage.query<BriefingRow>(
    "SELECT * FROM briefings WHERE status = 'ready' AND type = 'research' ORDER BY generated_at DESC LIMIT 20",
  );
  return rows.map((row) => ({
    id: row.id,
    generatedAt: row.generated_at,
    sections: JSON.parse(row.sections) as { report: string; goal: string },
    status: row.status,
    type: "research" as const,
  }));
}
```

**Step 5: Build to verify**

Run: `pnpm build`
Expected: Compiles successfully

**Step 6: Commit**

```bash
git add packages/ui/src/types.ts packages/ui/src/api.ts packages/ui/src/pages/Inbox.tsx packages/server/src/routes/inbox.ts packages/server/src/briefing.ts
git commit -m "feat: render research reports in Inbox UI"
```

---

### Task 10: Integration test — full research lifecycle

**Files:**
- Modify: `packages/plugin-research/test/research.test.ts`

**Step 1: Add integration test for Inbox delivery**

Add to `packages/plugin-research/test/research.test.ts`:

```typescript
import { briefingMigrations } from "@personal-ai/server/briefing";

// In beforeEach, also run briefing migration:
// storage.migrate("inbox", briefingMigrations);

describe("research report delivery", () => {
  it("creates a research briefing in the briefings table on completion", async () => {
    const { generateText } = await import("ai");
    (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: "# Report\n\nResearch findings here.",
      steps: [],
    });

    // Also run briefing migrations
    storage.migrate("inbox", briefingMigrations);

    const ctx = makeCtx();
    const id = createResearchJob(storage, {
      goal: "Test Inbox delivery",
      threadId: null,
    });

    await runResearchInBackground(ctx, id);

    const job = getResearchJob(storage, id);
    expect(job!.status).toBe("done");
    expect(job!.briefingId).not.toBeNull();

    // Verify briefing exists in DB
    const briefing = storage.query<{ id: string; type: string; sections: string }>(
      "SELECT id, type, sections FROM briefings WHERE id = ?",
      [job!.briefingId],
    );
    expect(briefing).toHaveLength(1);
    expect(briefing[0]!.type).toBe("research");
    const sections = JSON.parse(briefing[0]!.sections);
    expect(sections.report).toContain("Research findings");
    expect(sections.goal).toBe("Test Inbox delivery");
  });

  it("appends summary to originating thread on completion", async () => {
    const { generateText } = await import("ai");
    (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: "# Report\n\nThread delivery test.",
      steps: [],
    });

    // Run thread migrations for this test
    const { threadMigrations } = await import("@personal-ai/core");
    storage.migrate("threads", threadMigrations);
    storage.migrate("inbox", briefingMigrations);

    // Create a thread
    const { createThread, listMessages } = await import("@personal-ai/core");
    const thread = createThread(storage, { title: "Test thread", agentName: "assistant" });

    const ctx = makeCtx();
    const id = createResearchJob(storage, {
      goal: "Thread test",
      threadId: thread.id,
    });

    await runResearchInBackground(ctx, id);

    // Check thread has the research result message
    const messages = listMessages(storage, thread.id);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0]!.content).toContain("Research complete");
  });
});
```

**Note:** The briefing migration import may need adjustment. If `briefingMigrations` is not directly importable from the server package, duplicate the migration array in the test or import from the server's briefing module. Alternatively, just verify the SQL table exists by running the migration SQL directly in the test.

**Step 2: Run tests**

Run: `pnpm --filter @personal-ai/plugin-research test`
Expected: All tests pass

**Step 3: Commit**

```bash
git add packages/plugin-research/test/research.test.ts
git commit -m "test: add integration tests for research report delivery to Inbox and thread"
```

---

### Task 11: Full build, typecheck, and test verification

**Step 1: Install all dependencies**

Run: `pnpm install`

**Step 2: Type check**

Run: `pnpm typecheck`
Expected: No errors

**Step 3: Run all tests**

Run: `pnpm test`
Expected: All tests pass

**Step 4: Build everything**

Run: `pnpm build`
Expected: Successful build

**Step 5: Manual smoke test**

Run: `pnpm start`
- Open http://localhost:3141
- Go to Chat, type "research the best TypeScript frameworks in 2026"
- Verify: Tool card for `research_start` appears
- Verify: Assistant responds with "Research started" message
- Wait for background completion (check logs)
- Go to Inbox → Research Reports section should show the report
- Check `job_status` in chat → should list the research job

**Step 6: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "chore: fix integration issues from full build verification"
```

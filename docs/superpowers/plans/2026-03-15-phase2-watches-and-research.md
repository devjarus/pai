# Phase 2: Watches & Deeper Research — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the Watches domain package by wrapping plugin-schedules, add signal-change detection, research depth levels, delta-focused research, and Watch templates. Rename Programs → Watches across all surfaces.

**Architecture:** The `watches` package wraps `plugin-schedules` (which owns the `scheduled_jobs` table). No table renames — internal schema stays as `scheduled_jobs`. The Watch concept is a presentation-layer rename of Program. New capabilities (signal types, depth levels, templates) are added as extensions.

**Tech Stack:** TypeScript 5.7+, better-sqlite3, Vitest, Fastify 5, React 19

**Spec:** `docs/superpowers/specs/2026-03-15-four-pillars-roadmap-design.md` (Phase 2 section)

---

## Chunk 1: Watches Package & Enhanced Scheduling

### Task 1: Scaffold watches package with re-exports

**Files:**
- Create: `packages/watches/package.json`
- Create: `packages/watches/tsconfig.json`
- Create: `packages/watches/vitest.config.ts`
- Create: `packages/watches/src/index.ts`

- [ ] **Step 1: Create package.json**

Follow the pattern from `packages/library/package.json`. Dependencies: `@personal-ai/core`, `@personal-ai/library`, `@personal-ai/plugin-schedules`.

- [ ] **Step 2: Create tsconfig.json**

Follow `packages/library/tsconfig.json` pattern.

- [ ] **Step 3: Create vitest.config.ts**

```typescript
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { globals: false } });
```

- [ ] **Step 4: Create src/index.ts**

Re-export the core Watch operations from plugin-schedules with user-facing names:

```typescript
// Re-export from plugin-schedules with Watch naming
export {
  ensureProgram as createWatch,
  listPrograms as listWatches,
  getProgramById as getWatch,
  updateProgram as updateWatch,
  pauseProgram as pauseWatch,
  resumeProgram as resumeWatch,
  deleteProgram as deleteWatch,
  recordProgramEvaluation as recordWatchEvaluation,
  getDueSchedules as getDueWatches,
  markScheduleRun as markWatchRun,
} from "@personal-ai/plugin-schedules";

// Re-export types with Watch naming
export type {
  Program as Watch,
  ProgramCreateInput as WatchCreateInput,
  ProgramUpdateInput as WatchUpdateInput,
} from "@personal-ai/plugin-schedules";
```

IMPORTANT: Read `packages/plugin-schedules/src/schedules.ts` first to verify all export names match.

- [ ] **Step 5: Run pnpm install && pnpm build**
- [ ] **Step 6: Commit**

```bash
git commit -m "feat(watches): scaffold watches package with re-exports from plugin-schedules"
```

---

### Task 2: Add Watch templates

**Files:**
- Create: `packages/watches/src/templates.ts`
- Create: `packages/watches/test/templates.test.ts`

Watch templates are preset configurations for common monitoring patterns.

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect } from "vitest";
import { listTemplates, getTemplate, applyTemplate } from "../src/templates.js";

describe("watch templates", () => {
  it("lists available templates", () => {
    const templates = listTemplates();
    expect(templates.length).toBeGreaterThan(0);
    expect(templates[0].id).toBeTruthy();
    expect(templates[0].name).toBeTruthy();
  });

  it("gets a template by id", () => {
    const template = getTemplate("price-watch");
    expect(template).toBeDefined();
    expect(template!.name).toBe("Price Watch");
  });

  it("applies template to create watch input", () => {
    const input = applyTemplate("price-watch", { subject: "RTX 4090 GPU" });
    expect(input.goal).toContain("RTX 4090 GPU");
    expect(input.intervalHours).toBeDefined();
    expect(input.deliveryMode).toBe("change-gated");
  });

  it("returns undefined for unknown template", () => {
    expect(getTemplate("nonexistent")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Implement templates**

```typescript
// packages/watches/src/templates.ts

export interface WatchTemplate {
  id: string;
  name: string;
  description: string;
  category: "price" | "news" | "competitor" | "availability" | "general";
  defaultGoal: (subject: string) => string;
  defaultIntervalHours: number;
  defaultDeliveryMode: "always" | "change-gated";
  defaultDepthLevel: "quick" | "standard" | "deep";
}

const templates: WatchTemplate[] = [
  {
    id: "price-watch",
    name: "Price Watch",
    description: "Track price changes for a product or service",
    category: "price",
    defaultGoal: (subject) => `Monitor and report current prices for ${subject}. Include price trends, best deals, and any notable price changes.`,
    defaultIntervalHours: 24,
    defaultDeliveryMode: "change-gated",
    defaultDepthLevel: "standard",
  },
  {
    id: "news-watch",
    name: "News Watch",
    description: "Track news and developments about a topic",
    category: "news",
    defaultGoal: (subject) => `Find and summarize the latest news and developments about ${subject}. Focus on significant updates, not routine coverage.`,
    defaultIntervalHours: 12,
    defaultDeliveryMode: "change-gated",
    defaultDepthLevel: "standard",
  },
  {
    id: "competitor-watch",
    name: "Competitor Watch",
    description: "Monitor a competitor's public activity",
    category: "competitor",
    defaultGoal: (subject) => `Track public activity for ${subject}: product launches, pricing changes, partnerships, hiring, and press mentions.`,
    defaultIntervalHours: 48,
    defaultDeliveryMode: "change-gated",
    defaultDepthLevel: "deep",
  },
  {
    id: "availability-watch",
    name: "Availability Watch",
    description: "Check if something becomes available",
    category: "availability",
    defaultGoal: (subject) => `Check availability status for ${subject}. Report any changes in stock, booking availability, or waitlist status.`,
    defaultIntervalHours: 6,
    defaultDeliveryMode: "change-gated",
    defaultDepthLevel: "quick",
  },
  {
    id: "general-watch",
    name: "General Watch",
    description: "Keep track of anything",
    category: "general",
    defaultGoal: (subject) => `Research and report on ${subject}. Summarize key findings and notable changes.`,
    defaultIntervalHours: 24,
    defaultDeliveryMode: "always",
    defaultDepthLevel: "standard",
  },
];

export function listTemplates(): WatchTemplate[] {
  return templates;
}

export function getTemplate(id: string): WatchTemplate | undefined {
  return templates.find((t) => t.id === id);
}

export interface ApplyTemplateResult {
  goal: string;
  intervalHours: number;
  deliveryMode: string;
  depthLevel: string;
  label: string;
}

export function applyTemplate(templateId: string, opts: { subject: string }): ApplyTemplateResult {
  const template = getTemplate(templateId);
  if (!template) {
    // Fall back to general-watch
    return applyTemplate("general-watch", opts);
  }
  return {
    goal: template.defaultGoal(opts.subject),
    intervalHours: template.defaultIntervalHours,
    deliveryMode: template.defaultDeliveryMode,
    depthLevel: template.defaultDepthLevel,
    label: `${template.name}: ${opts.subject}`,
  };
}
```

- [ ] **Step 3: Export from index, run tests, commit**

```bash
git commit -m "feat(watches): add watch templates for common monitoring patterns"
```

---

### Task 3: Add research depth levels to watches

**Files:**
- Create: `packages/watches/src/depth.ts`
- Create: `packages/watches/test/depth.test.ts`
- Modify: `packages/watches/src/index.ts` — export depth functions

Depth levels control how much effort research agents put in.

- [ ] **Step 1: Write failing test**

Test that `getDepthConfig` returns correct budgets for each level and that `resolveDepthForWatch` picks the right level based on watch configuration.

- [ ] **Step 2: Implement depth module**

```typescript
// packages/watches/src/depth.ts

export interface DepthConfig {
  level: "quick" | "standard" | "deep";
  maxAgents: number;
  maxSources: number;
  budgetMaxSearches: number;
  budgetMaxPages: number;
  description: string;
}

const depthConfigs: Record<string, DepthConfig> = {
  quick: {
    level: "quick",
    maxAgents: 1,
    maxSources: 3,
    budgetMaxSearches: 2,
    budgetMaxPages: 3,
    description: "Fast scan — 1 agent, 2-3 sources",
  },
  standard: {
    level: "standard",
    maxAgents: 3,
    maxSources: 8,
    budgetMaxSearches: 5,
    budgetMaxPages: 8,
    description: "Standard research — 2-3 agents, 5-8 sources",
  },
  deep: {
    level: "deep",
    maxAgents: 5,
    maxSources: 15,
    budgetMaxSearches: 10,
    budgetMaxPages: 15,
    description: "Deep dive — 3-5 agents, 10+ sources, cross-reference",
  },
};

export function getDepthConfig(level: string): DepthConfig {
  return depthConfigs[level] ?? depthConfigs.standard!;
}

export function resolveDepthForWatch(watch: { deliveryMode?: string; type?: string }, isManualTrigger: boolean): DepthConfig {
  if (isManualTrigger) return depthConfigs.standard!;
  if (watch.type === "analysis") return depthConfigs.deep!;
  if (watch.deliveryMode === "change-gated") return depthConfigs.standard!;
  return depthConfigs.quick!;
}
```

- [ ] **Step 3: Export, test, commit**

```bash
git commit -m "feat(watches): add research depth levels — quick, standard, deep"
```

---

### Task 4: Wire depth levels into research dispatch

**Files:**
- Modify: `packages/server/src/workers.ts` — pass depth config when enqueuing research
- Modify: `packages/plugin-research/src/research.ts` — respect depth budget limits

- [ ] **Step 1: Read workers.ts `runDueSchedules` and research.ts to understand the dispatch flow**

- [ ] **Step 2: In workers.ts, import `resolveDepthForWatch` and `getDepthConfig` from `@personal-ai/watches`**

When enqueuing research for a due schedule, resolve the depth level and pass the budget limits to `enqueueResearch`:

```typescript
const depth = resolveDepthForWatch(schedule, false);
// Pass depth.budgetMaxSearches and depth.budgetMaxPages to the job
```

The existing research_jobs table has `budget_max_searches` and `budget_max_pages` columns. Set these from the depth config when creating the job.

- [ ] **Step 3: In research.ts, ensure the budget limits from the job are respected**

Read the existing research code — it likely already has budget fields on the job. Verify they're used to limit web searches and page reads. If not, add guards.

- [ ] **Step 4: Add `@personal-ai/watches` dependency to server package.json**

- [ ] **Step 5: Build and verify**

```bash
pnpm build
```

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(server): wire research depth levels from watches into job dispatch"
```

---

### Task 5: Delta-focused research — build on previous findings

**Files:**
- Modify: `packages/server/src/workers.ts` — include previous findings in enriched goal
- Modify: `packages/watches/src/index.ts` — add helper to get previous findings

- [ ] **Step 1: Create a helper in watches package**

```typescript
// In packages/watches/src/delta.ts
import type { Storage } from "@personal-ai/core";
import { listFindingsForWatch } from "@personal-ai/library";

export function getPreviousFindingsContext(storage: Storage, watchId: string, limit = 3): string {
  const findings = listFindingsForWatch(storage, watchId);
  if (findings.length === 0) return "";

  const recent = findings.slice(0, limit);
  const summaries = recent.map((f, i) => `${i + 1}. [${f.createdAt}] ${f.summary}`).join("\n");

  return `\n\nPREVIOUS RESEARCH FINDINGS (build on these, don't repeat):\n${summaries}\n\nFocus on what is NEW or CHANGED since the last research.`;
}
```

- [ ] **Step 2: In workers.ts, append previous findings context to the enriched goal**

After `buildEnrichedResearchGoal`, append `getPreviousFindingsContext(storage, schedule.id)` to the goal.

- [ ] **Step 3: After research completes, ingest findings into Library**

In `packages/plugin-research/src/research.ts`, after a job completes successfully, call `ingestResearchResult` from `@personal-ai/library` to persist the research output as a ResearchFinding. This is the critical "research → Library" pipeline.

Read the research completion handler to find where `recordProgramEvaluation` is called — the ingestion should happen right before that.

- [ ] **Step 4: Add `@personal-ai/library` dependency to plugin-research package.json**

- [ ] **Step 5: Test that findings accumulate**

Run the app, create a watch, trigger research manually. Check that:
- A ResearchFinding appears in `/api/library/findings`
- The next research run includes previous findings context in the goal

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: delta-focused research — findings compound in Library across runs"
```

---

## Chunk 2: API & UI Rename

### Task 6: Add /api/watches/* routes

**Files:**
- Create: `packages/server/src/routes/watches.ts`
- Modify: `packages/server/src/index.ts` — register routes

- [ ] **Step 1: Read existing programs.ts routes**

Read `packages/server/src/routes/programs.ts` thoroughly. The new watches routes will mirror these with renamed paths.

- [ ] **Step 2: Create watches routes**

Create `packages/server/src/routes/watches.ts` that provides:

```
GET    /api/watches                    — list watches (wraps listPrograms)
GET    /api/watches/:id                — get watch detail (wraps getProgramById)
GET    /api/watches/:id/history        — watch history (briefs, jobs, actions)
POST   /api/watches                    — create watch (wraps ensureProgram)
PATCH  /api/watches/:id                — update watch
PATCH  /api/watches/:id/status         — pause/resume
DELETE /api/watches/:id                — soft delete
POST   /api/watches/:id/run            — trigger immediate research
GET    /api/watches/templates          — list available templates
POST   /api/watches/from-template      — create watch from template
```

Follow the same patterns as programs.ts. Use `validate(schema, data)` — schema first. Use `reply.status(404).send()` for errors.

The `/api/watches/:id/run` endpoint should use `resolveDepthForWatch` to determine depth and pass budget to the research job.

- [ ] **Step 3: Register routes in server index**

- [ ] **Step 4: Build and verify**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(server): add /api/watches/* routes with templates and depth-aware dispatch"
```

---

### Task 7: Rename Programs UI page to Watches

**Files:**
- Modify: `packages/ui/src/pages/Programs.tsx` — already has "Watch" labels from Phase 1 Task 7, now wire to new API
- Create: `packages/ui/src/hooks/use-watches.ts` — hooks pointing to /api/watches/*
- Modify: `packages/ui/src/hooks/index.ts` — export new hooks

- [ ] **Step 1: Create use-watches.ts**

Mirror `use-programs.ts` but point to `/api/watches/*` endpoints. Add hooks for:
- `useWatches()` — list all watches
- `useWatch(id)` — single watch detail
- `useWatchHistory(id)` — watch history (briefs, jobs, actions)
- `useWatchTemplates()` — list templates
- `useCreateWatch()` — mutation
- `useCreateWatchFromTemplate()` — mutation
- `useTriggerWatchRun(id)` — mutation for manual run

- [ ] **Step 2: Update Programs.tsx to use new hooks**

Replace `usePrograms` calls with `useWatches`. Add a "Create from Template" flow in the create dialog.

- [ ] **Step 3: Export hooks, build, commit**

```bash
git commit -m "feat(ui): wire Watches page to /api/watches/* with template creation"
```

---

### Task 8: Watch detail page with linked digests and findings

**Files:**
- Modify: `packages/ui/src/pages/Programs.tsx` — enhance detail view

- [ ] **Step 1: Read the existing Programs.tsx detail view**

- [ ] **Step 2: Add tabs to the Watch detail view**

When viewing a single Watch, show tabs:
- **Overview** — current status, next run, last digest summary
- **Digests** — linked digests from `/api/watches/:id/history`
- **Findings** — findings from `/api/library/findings?watchId=:id`
- **To-Dos** — linked tasks

Use `useWatchHistory` and `useFindings(watchId)` from the library hooks.

- [ ] **Step 3: Build, verify, commit**

```bash
git commit -m "feat(ui): watch detail with linked digests, findings, and to-dos tabs"
```

---

## Chunk 3: Harness Integration & Tests

### Task 9: Research agents use agent harness

**Files:**
- Modify: `packages/plugin-research/src/research.ts` — wrap research execution with harness

- [ ] **Step 1: Read the agent harness API**

Read `packages/core/src/agent-harness/` to understand `runAgentHarness` signature.

- [ ] **Step 2: Wrap research execution**

In `research.ts`, find the main research execution function. Wrap it with `runAgentHarness`:

```typescript
import { runAgentHarness } from "@personal-ai/core";

// Before the LLM research call:
const harnessResult = await runAgentHarness({
  goal: job.goal,
  context: [], // loaded from Library search
  previousFindings: getPreviousFindingsForWatch(storage, job.sourceScheduleId),
  budget: {
    maxTokens: 50000,
    maxToolCalls: depth.budgetMaxSearches + depth.budgetMaxPages,
    maxDurationMs: 120000,
  },
  depth: depth.level,
  execute: async (ctx) => {
    // existing research logic here
    return { findings: [...], rawOutput: report };
  },
});
```

This is a light integration — the harness tracks plan, usage, and reflection without changing the research logic itself.

- [ ] **Step 3: Log harness reflection in the job result**

After research completes, include `harnessResult.reflection` in the job's result metadata so it's visible in the Activities UI.

- [ ] **Step 4: Build, test, commit**

```bash
git commit -m "feat(research): wrap research execution with agent harness for plan/reflect tracking"
```

---

### Task 10: Update migration test count

**Files:**
- Modify: `packages/server/test/migrations.test.ts` — if any new migrations were added

- [ ] **Step 1: Check current migration count**

- [ ] **Step 2: Update if needed**

- [ ] **Step 3: Commit if changed**

---

### Task 11: Integration tests for Watches

**Files:**
- Create: `packages/watches/test/integration.test.ts`

- [ ] **Step 1: Write integration tests**

Test:
1. Template → createWatch flow
2. Depth resolution for different watch types
3. Previous findings context generation (mock findings in Library)

- [ ] **Step 2: Run all tests**

```bash
pnpm test
```

- [ ] **Step 3: Commit**

```bash
git commit -m "test(watches): integration tests for templates, depth, and delta research"
```

---

### Task 12: Documentation and CHANGELOG

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `docs/ARCHITECTURE.md` — add watches package reference
- Modify: `AGENTS.md` — add Phase 2 learnings

- [ ] **Step 1: Update CHANGELOG**

Add under `## [Unreleased]`:
```markdown
- **Watches domain:** New `@personal-ai/watches` package wrapping Programs with templates, depth levels, and delta research
- **Research depth:** Quick/Standard/Deep levels control agent effort per Watch
- **Delta research:** Research agents build on previous findings stored in Library
- **Watch templates:** Preset configurations for Price, News, Competitor, Availability watches
- **Watch API:** `/api/watches/*` routes with template creation and manual trigger
```

- [ ] **Step 2: Commit**

```bash
git commit -m "docs: Phase 2 — Watches, depth levels, delta research, templates"
```

---

### Task 13: Final verification

- [ ] **Step 1: Run pnpm verify**
- [ ] **Step 2: Run pnpm test — all tests pass**
- [ ] **Step 3: Manual smoke test — create a watch from template, verify it appears in UI**

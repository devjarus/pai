# Research Builds on Previous Findings

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make recurring Program research build on previous findings instead of repeating the same search, and auto-expire research knowledge so stale reports don't accumulate.

**Architecture:** When a scheduled Program enqueues research, inject the previous brief's summary and a date anchor into the goal so the LLM knows what's already known. Set a short TTL on research report knowledge sources so old reports expire automatically. The research user message becomes temporal and context-aware instead of static.

**Tech Stack:** TypeScript, SQLite, existing learnFromContent/knowledge TTL infrastructure.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/server/src/workers.ts:185-202` | Modify | Inject previous brief summary + date into research goal |
| `packages/plugin-research/src/research.ts:1510-1516` | Modify | Set `max_age_days` on research knowledge sources |
| `packages/core/src/knowledge.ts:156-163` | Modify | Accept `maxAgeDays` option in `learnFromContent()` |
| `packages/server/test/workers.test.ts` | Modify | Test that enriched goal includes previous summary |
| `packages/core/test/knowledge.test.ts` | Modify | Test that maxAgeDays is persisted |

---

### Task 1: Add maxAgeDays option to learnFromContent

**Files:**
- Modify: `packages/core/src/knowledge.ts:156-163`
- Test: `packages/core/test/knowledge.test.ts`

- [ ] **Step 1: Write failing test for maxAgeDays**

In `packages/core/test/knowledge.test.ts`, add:

```typescript
it("should persist maxAgeDays on knowledge source when provided", async () => {
  const result = await learnFromContent(storage, mockLLM, "https://example.com/report", "Test Report", "Some content here", {
    maxAgeDays: 7,
  });
  expect(result.skipped).toBe(false);

  const row = storage.query<{ max_age_days: number | null }>(
    "SELECT max_age_days FROM knowledge_sources WHERE id = ?",
    [result.source.id],
  );
  expect(row[0]?.max_age_days).toBe(7);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/test/knowledge.test.ts -t "maxAgeDays"`
Expected: FAIL — `learnFromContent` doesn't accept or persist `maxAgeDays`

- [ ] **Step 3: Add maxAgeDays to learnFromContent options and persist it**

In `packages/core/src/knowledge.ts`, modify the `learnFromContent` function:

```typescript
export async function learnFromContent(
  storage: Storage,
  llm: LLMClient,
  url: string,
  title: string,
  markdown: string,
  options?: { force?: boolean; tags?: string; maxAgeDays?: number },
): Promise<{ source: KnowledgeSource; chunksStored: number; skipped: boolean }> {
```

After the source INSERT statement (where it creates the knowledge_sources row), add a follow-up UPDATE if `maxAgeDays` is provided:

```typescript
if (options?.maxAgeDays != null) {
  storage.run("UPDATE knowledge_sources SET max_age_days = ? WHERE id = ?", [options.maxAgeDays, sourceId]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/core/test/knowledge.test.ts -t "maxAgeDays"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/knowledge.ts packages/core/test/knowledge.test.ts
git commit -m "feat: accept maxAgeDays in learnFromContent for TTL-aware knowledge storage"
```

---

### Task 2: Set TTL on research report knowledge sources

**Files:**
- Modify: `packages/plugin-research/src/research.ts:1510-1516`

- [ ] **Step 1: Set maxAgeDays when storing research reports**

In `packages/plugin-research/src/research.ts`, around line 1515, change:

```typescript
// Before:
await learnFromContent(ctx.storage, ctx.llm, reportUrl, reportTitle, presentation.report);

// After:
await learnFromContent(ctx.storage, ctx.llm, reportUrl, reportTitle, presentation.report, {
  force: true,
  maxAgeDays: 7,
});
```

Two changes:
1. `force: true` — overwrites the previous report for the same goal URL instead of skipping (the URL is `/inbox/{briefingId}` which is unique, but if the URL pattern ever reuses, we want replacement not skip).
2. `maxAgeDays: 7` — research reports auto-expire after 7 days. The cleanup worker already runs daily and respects `max_age_days`.

- [ ] **Step 2: Run full test suite to verify nothing breaks**

Run: `pnpm test`
Expected: All tests pass (this is a parameter-only change to an existing call)

- [ ] **Step 3: Commit**

```bash
git add packages/plugin-research/src/research.ts
git commit -m "feat: auto-expire research knowledge after 7 days to prevent stale accumulation"
```

---

### Task 3: Enrich scheduled research goal with previous brief context

This is the core change. When a Program's scheduled research fires, we look up the previous brief and inject its summary + date into the goal.

**Files:**
- Modify: `packages/server/src/workers.ts:185-202`
- Test: `packages/server/test/workers.test.ts`

- [ ] **Step 1: Write helper function to build enriched goal**

In `packages/server/src/workers.ts`, add a function (before `runDueSchedules`):

```typescript
/**
 * Build a research goal that includes context from the previous brief
 * so the LLM focuses on what's NEW instead of repeating old findings.
 */
function buildEnrichedResearchGoal(
  storage: Storage,
  schedule: { goal: string; latestBriefId?: string | null; lastDeliveredAt?: string | null },
): string {
  if (!schedule.latestBriefId) return schedule.goal;

  // Fetch previous brief's recommendation summary
  let previousSummary = "";
  try {
    const rows = storage.query<{ sections: string }>(
      "SELECT sections FROM briefings WHERE id = ? LIMIT 1",
      [schedule.latestBriefId],
    );
    if (rows[0]) {
      const sections = JSON.parse(rows[0].sections);
      const rec = sections.recommendation;
      if (rec?.summary) {
        previousSummary = rec.summary;
      }
      // Also grab what_changed if available for richer context
      if (Array.isArray(sections.what_changed) && sections.what_changed.length > 0) {
        const changes = sections.what_changed.map((c: { title?: string }) => c.title ?? c).filter(Boolean).slice(0, 3);
        if (changes.length > 0) {
          previousSummary += ` Key changes noted: ${changes.join("; ")}.`;
        }
      }
    }
  } catch {
    // Failed to parse previous brief — fall back to plain goal
  }

  if (!previousSummary) return schedule.goal;

  const sinceDate = schedule.lastDeliveredAt
    ? new Date(schedule.lastDeliveredAt).toISOString().split("T")[0]
    : null;

  const sinceClause = sinceDate ? ` since ${sinceDate}` : "";

  return (
    `${schedule.goal}\n\n` +
    `IMPORTANT — PREVIOUS FINDINGS (do NOT repeat these):\n` +
    `${previousSummary}\n\n` +
    `Focus ONLY on what is NEW or CHANGED${sinceClause}. ` +
    `If nothing meaningful changed, say so in one sentence instead of restating old findings.`
  );
}
```

- [ ] **Step 2: Wire the enriched goal into runDueSchedules**

In `packages/server/src/workers.ts`, modify the `runDueSchedules` method (around line 195-202):

```typescript
// Before:
if (schedule.type === "research") {
  await this.ctx.backgroundJobs?.enqueueResearch?.({
    goal: schedule.goal,
    threadId: schedule.threadId,
    sourceKind: "schedule",
    sourceScheduleId: schedule.id,
  });
  continue;
}

// After:
if (schedule.type === "research") {
  const enrichedGoal = buildEnrichedResearchGoal(this.ctx.storage, schedule);
  await this.ctx.backgroundJobs?.enqueueResearch?.({
    goal: enrichedGoal,
    threadId: schedule.threadId,
    sourceKind: "schedule",
    sourceScheduleId: schedule.id,
  });
  continue;
}
```

Note: `schedule` from `getDueSchedules` already includes `latestBriefId` and `lastDeliveredAt` via the `rowToJob` mapper in schedules.ts (line 246-252), which maps `latest_brief_id` and `last_delivered_at` into `runtimeState`.

We need to check: does `getDueSchedules` return the runtime state fields? Let's check — it does `SELECT *` and uses `rowToJob` which maps all columns.

The schedule object has `schedule.runtimeState.latestBriefId` and `schedule.runtimeState.lastDeliveredAt`. So adjust the helper call:

```typescript
const enrichedGoal = buildEnrichedResearchGoal(this.ctx.storage, {
  goal: schedule.goal,
  latestBriefId: schedule.runtimeState?.latestBriefId,
  lastDeliveredAt: schedule.runtimeState?.lastDeliveredAt,
});
```

- [ ] **Step 3: Write test for enriched goal construction**

In `packages/server/test/workers.test.ts`, add a test (or create the file if needed):

```typescript
import { describe, it, expect } from "vitest";

// Since buildEnrichedResearchGoal is not exported, test it indirectly
// by checking the research goal passed to enqueueResearch.
// OR: export it for direct testing.

describe("buildEnrichedResearchGoal", () => {
  it("returns plain goal when no previous brief exists", () => {
    // Test with latestBriefId = null
  });

  it("appends previous summary and date when brief exists", () => {
    // Insert a briefing row, call the function, verify output contains "PREVIOUS FINDINGS"
    // and the since date
  });

  it("includes what_changed items from previous brief", () => {
    // Insert briefing with what_changed array, verify they appear
  });
});
```

The exact test implementation depends on whether we export the helper or test through the worker integration. Since the function is pure (takes storage + schedule data, returns string), export it for direct testing.

Add `export` to the function declaration.

- [ ] **Step 4: Run tests**

Run: `pnpm test`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/workers.ts packages/server/test/workers.test.ts
git commit -m "feat: enrich scheduled research goals with previous brief context to prevent repetition"
```

---

### Task 4: Verify end-to-end and update docs

- [ ] **Step 1: Run full verification**

```bash
pnpm verify
```

- [ ] **Step 2: Update CHANGELOG.md**

Add under `### Changed`:

```markdown
- **Research builds on previous findings** — Scheduled Program research now injects the previous brief's recommendation summary and date into the research goal, so the LLM focuses on what's NEW instead of repeating old findings. Research report knowledge sources auto-expire after 7 days to prevent stale data accumulation.
```

- [ ] **Step 3: Commit and push**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog for research-builds-on-previous"
```

---

## Summary of changes

| What | Why |
|------|-----|
| `learnFromContent` accepts `maxAgeDays` | Callers can set TTL on knowledge they create |
| Research reports stored with `maxAgeDays: 7` | Old reports auto-expire via existing cleanup worker |
| Scheduled research goal includes previous brief summary | LLM knows what's already been found, focuses on changes |
| Goal includes "since {date}" clause | Temporal anchor for what counts as "new" |
| Goal includes "PREVIOUS FINDINGS" block | Explicit instruction not to repeat |

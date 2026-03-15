# Phase 3: Digests & Feedback Loop — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the Digests domain by wrapping existing briefing/inbox infrastructure, add digest quality rating, correction → Library writeback, feedback loop, and auto-suggest to-dos from digest recommendations.

**Architecture:** Unlike Library and Watches which created new packages, the Digest domain stays in-place — briefing logic is deeply woven into the server. Instead, we: (1) add `/api/digests/*` routes as the new API surface, (2) add quality rating and correction writeback, (3) rename the Inbox UI to Digests, and (4) wire the feedback loop. No new package needed — the `digests` domain is the server's briefing subsystem with a clean API surface.

**Tech Stack:** TypeScript 5.7+, better-sqlite3, Vitest, Fastify 5, React 19

**Spec:** `docs/superpowers/specs/2026-03-15-four-pillars-roadmap-design.md` (Phase 3 section)

---

## Chunk 1: Digest API & Quality Rating

### Task 1: Add /api/digests/* routes

**Files:**
- Create: `packages/server/src/routes/digests.ts`
- Modify: `packages/server/src/index.ts` — register routes

- [ ] **Step 1: Read existing inbox routes**

Read `packages/server/src/routes/inbox.ts` thoroughly — the new digests routes mirror these.

- [ ] **Step 2: Create digests routes**

Create `packages/server/src/routes/digests.ts`:

```
GET    /api/digests                    — list all digests (wraps listAllBriefings)
GET    /api/digests/latest             — latest digest (wraps getLatestBriefing)
GET    /api/digests/:id                — get digest detail (wraps getBriefingById)
GET    /api/digests/:id/sources        — provenance chain (wraps getBriefProvenance)
POST   /api/digests/:id/correct        — NEW: correction → Library writeback
POST   /api/digests/:id/rate           — NEW: quality rating
POST   /api/digests/refresh            — trigger new digest (wraps enqueueBriefing)
POST   /api/digests/:id/rerun          — rerun research (wraps existing rerun logic)
```

Key: Read the inbox routes' actual function calls and reuse them. The digests routes are a cleaner API surface over the same underlying functions.

For the correction endpoint:
```typescript
POST /api/digests/:id/correct
Body: { beliefId: string, correctedStatement: string, note?: string }
// Calls ingestCorrection from @personal-ai/library
```

For the rating endpoint:
```typescript
POST /api/digests/:id/rate
Body: { rating: 1-5, feedback?: string }
// Stores in digest_ratings table
```

- [ ] **Step 3: Register routes**
- [ ] **Step 4: Build and verify**
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(server): add /api/digests/* routes with correction and rating endpoints"
```

---

### Task 2: Add digest_ratings table

**Files:**
- Create: `packages/server/src/digest-ratings.ts`
- Modify: `packages/server/src/migrations.ts` — register migration

- [ ] **Step 1: Create digest ratings module**

```typescript
// packages/server/src/digest-ratings.ts
import type { Storage, Migration } from "@personal-ai/core";
import { nanoid } from "nanoid";

export const digestRatingsMigrations: Migration[] = [
  {
    version: 1,
    up: `
      CREATE TABLE IF NOT EXISTS digest_ratings (
        id TEXT PRIMARY KEY,
        digest_id TEXT NOT NULL,
        rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
        feedback TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_digest_ratings_digest ON digest_ratings(digest_id);
    `,
  },
];

export interface DigestRating {
  id: string;
  digestId: string;
  rating: number;
  feedback?: string;
  createdAt: string;
}

export function rateDigest(storage: Storage, digestId: string, rating: number, feedback?: string): DigestRating {
  const id = nanoid();
  storage.db.prepare(
    "INSERT INTO digest_ratings (id, digest_id, rating, feedback) VALUES (?, ?, ?, ?)"
  ).run(id, digestId, rating, feedback ?? null);
  return { id, digestId, rating, feedback, createdAt: new Date().toISOString() };
}

export function getDigestRating(storage: Storage, digestId: string): DigestRating | undefined {
  const row = storage.db.prepare(
    "SELECT * FROM digest_ratings WHERE digest_id = ? ORDER BY created_at DESC LIMIT 1"
  ).get(digestId) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  return {
    id: row.id as string,
    digestId: row.digest_id as string,
    rating: row.rating as number,
    feedback: (row.feedback as string) || undefined,
    createdAt: row.created_at as string,
  };
}

export function getAverageRating(storage: Storage, limit = 30): number | null {
  const row = storage.db.prepare(
    "SELECT AVG(rating) as avg FROM digest_ratings ORDER BY created_at DESC LIMIT ?"
  ).get(limit) as { avg: number | null } | undefined;
  return row?.avg ?? null;
}
```

- [ ] **Step 2: Register migration in migrations.ts**

Read `packages/server/src/migrations.ts` and add `digestRatingsMigrations`.

- [ ] **Step 3: Update migration count test**

Update `packages/server/test/migrations.test.ts` — increment count, add `"digest_ratings"` to expected names.

- [ ] **Step 4: Build, test, commit**

```bash
git commit -m "feat(server): add digest_ratings table for quality feedback"
```

---

### Task 3: Wire correction endpoint to Library

**Files:**
- Modify: `packages/server/src/routes/digests.ts` — implement correction handler

- [ ] **Step 1: Read how correctBelief works**

Read `packages/core/src/memory/memory.ts` — find the `correctBelief` function signature. Also read `packages/library/src/ingestion.ts` for the `ingestCorrection` wrapper.

- [ ] **Step 2: Implement the correction handler in digests routes**

The `POST /api/digests/:id/correct` handler should:
1. Validate body: `{ beliefId, correctedStatement, note? }`
2. Call `ingestCorrection(storage, llm, { beliefId, correctedStatement, digestId: params.id, note })`
3. Return `{ corrected: true/false }`

Import `ingestCorrection` from `@personal-ai/library`.

- [ ] **Step 3: Build, commit**

```bash
git commit -m "feat(server): wire digest correction to Library writeback via ingestCorrection"
```

---

## Chunk 2: UI Rename & Feedback

### Task 4: Create use-digests.ts hooks

**Files:**
- Create: `packages/ui/src/hooks/use-digests.ts`
- Modify: `packages/ui/src/hooks/index.ts`

- [ ] **Step 1: Read use-inbox.ts for patterns**

- [ ] **Step 2: Create hooks pointing to /api/digests/**

```typescript
export function useDigests() {
  // GET /api/digests — list all
}

export function useDigest(id: string) {
  // GET /api/digests/:id — single detail
}

export function useDigestSources(id: string) {
  // GET /api/digests/:id/sources — provenance
}

export function useRefreshDigests() {
  // POST /api/digests/refresh — mutation
}

export function useCorrectDigest() {
  // POST /api/digests/:id/correct — mutation with { beliefId, correctedStatement, note? }
}

export function useRateDigest() {
  // POST /api/digests/:id/rate — mutation with { rating, feedback? }
}

export function useRerunDigestResearch() {
  // POST /api/digests/:id/rerun — mutation
}
```

- [ ] **Step 3: Export, commit**

```bash
git commit -m "feat(ui): add use-digests.ts hooks for /api/digests/* endpoints"
```

---

### Task 5: Wire Inbox page to digest hooks + add rating UI

**Files:**
- Modify: `packages/ui/src/pages/Inbox.tsx`

- [ ] **Step 1: Read Inbox.tsx to understand current structure**

- [ ] **Step 2: Wire digest hooks**

Replace the inbox API calls with digest hooks where appropriate. The page already shows "Digest" labels from Phase 1 Task 7.

Key additions:
1. Add a **rating component** on the digest detail view — 5 stars or thumbs up/down, with optional feedback text
2. Add a **correction button** on memory assumptions — when user clicks a memory assumption in the digest, show a dialog to correct it
3. Wire `useRateDigest()` and `useCorrectDigest()` mutations

Keep changes focused — don't rewrite the entire 2000-line page.

- [ ] **Step 3: Build, commit**

```bash
git commit -m "feat(ui): add digest rating and inline correction to Digests page"
```

---

### Task 6: Auto-suggest to-dos from digest recommendations

**Files:**
- Create: `packages/server/src/digest-suggestions.ts`
- Modify: `packages/server/src/routes/digests.ts` — add suggestions endpoint

- [ ] **Step 1: Create suggestion extraction**

```typescript
// packages/server/src/digest-suggestions.ts
import type { Storage } from "@personal-ai/core";

export interface DigestSuggestion {
  title: string;
  description: string;
  sourceDigestId: string;
  sourceSection: string;
}

/**
 * Extract suggested to-dos from a digest's next_actions.
 * Returns actionable items that could become tasks.
 */
export function extractSuggestions(storage: Storage, digestId: string): DigestSuggestion[] {
  const row = storage.db.prepare("SELECT sections FROM briefings WHERE id = ?").get(digestId) as { sections: string } | undefined;
  if (!row) return [];

  const sections = JSON.parse(row.sections);
  const suggestions: DigestSuggestion[] = [];

  // Handle both single-section and multi-section formats
  const sectionList = Array.isArray(sections) ? sections : [sections];

  for (const section of sectionList) {
    if (section.next_actions?.length) {
      for (const action of section.next_actions) {
        const title = typeof action === "string" ? action : action.label || action.text || String(action);
        suggestions.push({
          title: title.slice(0, 200),
          description: `Suggested from digest: ${section.title || "Digest"}`,
          sourceDigestId: digestId,
          sourceSection: section.title || "",
        });
      }
    }
  }

  return suggestions;
}
```

- [ ] **Step 2: Add endpoint**

```
GET /api/digests/:id/suggestions — returns suggested to-dos from the digest
```

- [ ] **Step 3: Add UI for suggestions**

In the digest detail view, show a "Suggested To-Dos" section below the main content. Each suggestion has a "Create To-Do" button that calls the tasks API.

- [ ] **Step 4: Build, commit**

```bash
git commit -m "feat: auto-suggest to-dos from digest recommendations"
```

---

## Chunk 3: Feedback Loop & Verification

### Task 7: Feedback loop — ratings influence next digest

**Files:**
- Modify: `packages/server/src/briefing.ts` — include rating data in context

- [ ] **Step 1: Read generateBriefing in briefing.ts**

Find where `BriefingContextInput` is assembled.

- [ ] **Step 2: Add recent ratings to briefing context**

Before generating a brief, query recent digest ratings. If average rating is low, add a context note:

```typescript
// In generateBriefing, before the LLM call:
const avgRating = getAverageRating(storage, 10);
const recentFeedback = getRecentFeedback(storage, 5); // last 5 feedbacks with text

// Add to the LLM prompt context:
if (avgRating !== null && avgRating < 3) {
  contextNotes.push(`Recent digest quality rating: ${avgRating.toFixed(1)}/5. User feedback: ${recentFeedback.join("; ")}. Prioritize actionable, specific recommendations.`);
}
```

This is a lightweight integration — it influences the LLM prompt, not the generation logic.

- [ ] **Step 3: Add getRecentFeedback to digest-ratings.ts**

```typescript
export function getRecentFeedback(storage: Storage, limit = 5): string[] {
  const rows = storage.db.prepare(
    "SELECT feedback FROM digest_ratings WHERE feedback IS NOT NULL ORDER BY created_at DESC LIMIT ?"
  ).all(limit) as Array<{ feedback: string }>;
  return rows.map(r => r.feedback);
}
```

- [ ] **Step 4: Build, test, commit**

```bash
git commit -m "feat: digest feedback loop — low ratings influence next generation"
```

---

### Task 8: Integration tests

**Files:**
- Create: `packages/server/test/digest-ratings.test.ts`

- [ ] **Step 1: Write tests**

Test:
1. `rateDigest` creates a rating record
2. `getDigestRating` retrieves the latest rating
3. `getAverageRating` computes average
4. `extractSuggestions` extracts next_actions from a briefing
5. `getRecentFeedback` returns feedback text

- [ ] **Step 2: Run full test suite**

```bash
pnpm test
```

- [ ] **Step 3: Commit**

```bash
git commit -m "test: digest ratings, suggestions, and feedback loop"
```

---

### Task 9: Documentation and CHANGELOG

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `AGENTS.md` — add Phase 3 learnings

- [ ] **Step 1: Update CHANGELOG**

Add under `## [Unreleased]`:
```markdown
- **Digests API:** `/api/digests/*` routes with correction writeback and quality rating
- **Digest rating:** 1-5 star rating with optional feedback on each digest
- **Inline correction:** Correct memory assumptions directly from digest detail → flows back to Library
- **Feedback loop:** Low digest ratings influence next generation prompt
- **Auto-suggest to-dos:** Digest recommendations surface as suggested to-dos
- **Digests UI:** Rating widget, correction dialog, suggested to-dos in digest detail
```

- [ ] **Step 2: Update AGENTS.md with learnings**

- [ ] **Step 3: Commit**

```bash
git commit -m "docs: Phase 3 — Digests, ratings, corrections, feedback loop"
```

---

### Task 10: Final verification

- [ ] **Step 1: Run pnpm build — no errors**
- [ ] **Step 2: Run pnpm test — all tests pass**
- [ ] **Step 3: Run pnpm typecheck — clean**
- [ ] **Step 4: Manual smoke test**

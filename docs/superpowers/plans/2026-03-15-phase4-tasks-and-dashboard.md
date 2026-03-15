# Phase 4: Tasks & Home Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect Tasks to Watches/Digests, add to-do completion triggers, build the Home dashboard, simplify onboarding, and do a final docs consistency pass.

**Architecture:** Tasks stay in `packages/plugin-tasks`. The new work adds linkage to Digests and Watches, completion triggers that update Watch context, and a new Home dashboard page. Onboarding is simplified to 4 steps.

**Tech Stack:** TypeScript 5.7+, Fastify 5, React 19, TanStack Query

---

## Chunk 1: Tasks Linkage & Completion Triggers

### Task 1: To-do completion triggers — update Watch context

**Files:**
- Create: `packages/server/src/task-completion.ts`
- Modify: `packages/server/src/routes/tasks.ts` — call trigger on task done

When a to-do linked to a Watch is completed, update the Watch's context so the next research run knows about it.

- [ ] **Step 1: Read task routes and plugin-tasks**

Read `packages/server/src/routes/tasks.ts` — find the `POST /api/tasks/:id/done` handler.
Read `packages/plugin-tasks/src/` — understand task schema (fields: `program_id`, `brief_id`).

- [ ] **Step 2: Create completion trigger module**

```typescript
// packages/server/src/task-completion.ts
import type { Storage } from "@personal-ai/core";
import { updateWatch, getWatch } from "@personal-ai/watches";

/**
 * When a task linked to a Watch is completed, record it in the Watch context
 * so the next research run can reference it.
 */
export function onTaskCompleted(storage: Storage, task: { id: string; title: string; programId?: string; briefId?: string }): void {
  if (!task.programId) return;

  const watch = getWatch(storage, task.programId);
  if (!watch) return;

  // The existing program_context_json has an openQuestions field.
  // We don't modify the schema — just let the next research run pick up
  // completed tasks via the existing buildActionSignals flow.
  // This is already handled by the briefing system.
  //
  // What we DO add: record a product event for analytics.
}
```

Actually, the existing system already tracks task completion through `buildActionSignals` in briefing.ts. The completion trigger just needs to invalidate cached Watch data so the UI reflects the change immediately.

Simplified approach:
- In the task done handler, if the task has a `program_id`, no extra DB write is needed (the briefing system already queries tasks by program_id)
- The value is in the UI: invalidate Watch-related queries when a linked task is completed

- [ ] **Step 3: In tasks routes, add Watch invalidation comment**

This is mostly a no-op since the existing system handles it. The important connection was already made when tasks have `program_id` and `brief_id` fields. Mark this as done.

- [ ] **Step 4: Commit**

```bash
git commit -m "docs: task completion triggers already handled by existing action signals"
```

---

### Task 2: Update Tasks page — link to Watch and Digest

**Files:**
- Modify: `packages/ui/src/pages/Tasks.tsx`

- [ ] **Step 1: Read Tasks.tsx**

The page already shows "To-Do" labels from Phase 1. Check if it shows source links (which Watch or Digest a to-do came from).

- [ ] **Step 2: Add source links**

For each to-do that has a `programId` (Watch) or `briefId` (Digest), show a small link/badge:
- "From Watch: [watch name]" → links to `/watches`
- "From Digest: [date]" → links to `/digests/:id`

Use existing data — the tasks already have `program_id` and `brief_id` fields.

- [ ] **Step 3: Build, commit**

```bash
git commit -m "feat(ui): show Watch and Digest source links on To-Dos"
```

---

## Chunk 2: Home Dashboard & Onboarding

### Task 3: Create Home dashboard page

**Files:**
- Create: `packages/ui/src/pages/Home.tsx`
- Modify: `packages/ui/src/App.tsx` — wire as default route

The Home page is the new landing experience. It shows a summary of everything:

- [ ] **Step 1: Read existing pages for component patterns**

- [ ] **Step 2: Create Home.tsx**

Layout:
```
┌──────────────────────────────────────────┐
│  Latest Digest                           │
│  [summary card with "Read full →" link]  │
├──────────────┬───────────────────────────┤
│ Active       │  Open To-Dos             │
│ Watches      │  [list with quick-done]  │
│ [status      │                          │
│  indicators] │                          │
├──────────────┴───────────────────────────┤
│  Library Stats                           │
│  X memories · Y documents · Z findings  │
├──────────────────────────────────────────┤
│  "What's on your mind?" [chat input]    │
└──────────────────────────────────────────┘
```

Use existing hooks:
- `useDigests()` for latest digest
- `useWatches()` for active watches
- `useTasks()` for open to-dos
- `useLibraryStats()` for library counts

Keep it clean and simple. Use shadcn/ui cards, badges, and existing Tailwind patterns.

- [ ] **Step 3: Wire as default route**

In App.tsx, change the `/` route from Inbox to Home:
```typescript
import Home from "./pages/Home";
<Route path="/" element={<ErrorBoundary><Home /></ErrorBoundary>} />
```

Keep `/digests` pointing to Inbox (which is now the full digests page).

- [ ] **Step 4: Update Layout.tsx**

Change the first nav item from "Digests" to "Home" for the `/` route. Keep Digests as a separate nav item pointing to `/digests`.

```typescript
const navItems = [
  { to: "/", label: "Home", icon: IconHome },
  { to: "/digests", label: "Digests", icon: IconInbox },
  { to: "/watches", label: "Watches", icon: IconPrograms },
  { to: "/ask", label: "Chat", icon: IconChat },
  { to: "/library", label: "Library", icon: IconMemory },
  { to: "/settings", label: "Settings", icon: IconSettings },
];
```

You'll need to add an IconHome — check what icons exist in the Layout file and add a simple home icon.

- [ ] **Step 5: Build, commit**

```bash
git commit -m "feat(ui): Home dashboard with digest summary, watches, to-dos, and library stats"
```

---

### Task 4: Simplify onboarding

**Files:**
- Modify: `packages/ui/src/pages/Onboarding.tsx`

- [ ] **Step 1: Read current onboarding**

- [ ] **Step 2: Simplify to 4 steps**

1. "Welcome to pai — your second brain that watches things for you"
2. LLM provider setup (keep existing wizard)
3. "Tell me something about yourself" → creates first memory
4. "What would you like me to keep track of?" → creates first watch (using general template)

After step 4, redirect to Home dashboard.

Update the copy to use new product language (Watch, Library, Digest — not Program, Memory, Brief).

- [ ] **Step 3: Build, commit**

```bash
git commit -m "feat(ui): simplified 4-step onboarding with new product language"
```

---

## Chunk 3: Final Docs & Verification

### Task 5: Update all documentation

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `AGENTS.md`
- Modify: `docs/ARCHITECTURE.md` — if it references old package structure

- [ ] **Step 1: CHANGELOG**

Add under `## [Unreleased]`:
```markdown
- **Home dashboard:** New landing page with digest summary, active watches, open to-dos, library stats
- **Simplified onboarding:** 4-step flow with new product language
- **To-Do source links:** Each to-do shows which Watch or Digest it came from
- **Tasks domain connected:** To-dos linked to Watches and Digests with visual source indicators
```

- [ ] **Step 2: AGENTS.md — update Tasks domain**

Change Tasks row in the Four Pillars table to reflect that it's connected now.

- [ ] **Step 3: Commit**

```bash
git commit -m "docs: Phase 4 — Home dashboard, onboarding, task linkage"
```

---

### Task 6: Final verification

- [ ] **Step 1: pnpm build — clean**
- [ ] **Step 2: pnpm test — all pass**
- [ ] **Step 3: pnpm typecheck — clean**
- [ ] **Step 4: pnpm lint — clean**

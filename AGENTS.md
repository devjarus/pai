# AGENTS.md

The only file any coding agent needs to read before working on `pai`.

## Quick Start

```bash
pnpm install && pnpm build    # setup
pnpm verify                   # build + lint + typecheck + test (MUST pass before claiming done)
pnpm dev:ui                   # UI dev server (Vite + React)
pnpm start                    # API server at http://127.0.0.1:3141
pnpm e2e                      # Playwright end-to-end tests
```

## What pai Is

A self-hosted AI that keeps track of ongoing decisions and delivers personalized digests.

**Core loop:** Ask → Watch creation → Digest → Correction or To-Do → Next digest improves.

**What pai is NOT:** a generic AI OS, a research workbench, a standalone task manager, or an autonomous action-taking agent. Breadth is frozen unless it strengthens the core loop.

## Four Domains

| Domain | Package | API | What it owns |
|--------|---------|-----|-------------|
| **Library** | `packages/library` | `/api/library/*` | Memories, documents, research findings, unified search, ingestion pipelines |
| **Watches** | `packages/watches` | `/api/watches/*` | Recurring monitoring, templates, depth levels, delta research |
| **Digests** | `packages/server` (briefing) | `/api/digests/*` | Generation, ratings, corrections, suggestions, feedback loop |
| **Tasks** | `packages/plugin-tasks` | `/api/tasks/*` | To-dos linked to watches and digests, goals |

**Shared foundation** in `packages/core`: LLM client, storage (SQLite), telemetry, auth, agent harness.

Domains interact through TypeScript functions (same process), not HTTP.

## Naming

User-facing language differs from code. Use the left column in UI/CLI/messages, the right in code:

| User sees | Code uses |
|-----------|-----------|
| Memory | `Belief` |
| Document | `KnowledgeSource` |
| Finding | `ResearchFinding` |
| Watch | `ScheduledJob` / `Program` |
| Digest | `Briefing` |
| To-Do | `Task` |
| Source | `Evidence` |
| Activity | `Job` (hidden by default) |

## Rules

1. **`pnpm verify` must pass** before claiming done — no exceptions
2. **Don't break existing tests.** If you add a migration, update the count in `packages/server/test/migrations.test.ts`
3. **Update CHANGELOG.md** when you change user-facing behavior
4. **Stay in scope.** Don't refactor unrelated code or add unrequested features
5. **Use new product language** in user-facing surfaces (Watch/Digest/Memory/To-Do). Internal code keeps Belief/Briefing/ScheduledJob

## Where New Work Goes

**Before adding anything, ask:** Does this strengthen the Ask → Watch → Digest → Correction loop? If no, defer it.

| Type of work | Where it goes |
|-------------|--------------|
| New data entity | `packages/library` (if knowledge/memory related) or relevant domain package |
| New API endpoint | `packages/server/src/routes/` — create a new route file, register in `index.ts` |
| New UI page | `packages/ui/src/pages/` — wire in `App.tsx`, add to `Layout.tsx` nav if needed |
| New hook | `packages/ui/src/hooks/use-*.ts` — export from `hooks/index.ts` |
| New background job | `packages/server/src/workers.ts` (scheduling) + `background-dispatcher.ts` (execution) |
| Research improvement | `packages/plugin-research/` — wrap with agent harness |
| New delivery surface | Follow `packages/plugin-telegram/` as the pattern |
| Memory/belief change | `packages/core/src/memory/` — read MEMORY-LIFECYCLE.md first |

## Codebase Patterns

**Testing:** `createStorage` needs a real directory — use `mkdtempSync`, never `:memory:`

**Routes:** `validate(schema, data)` — schema FIRST. Errors: `reply.status(404).send({ error: "..." })`. Fastify throws on duplicate paths — don't add redirects while old routes exist.

**React:** `<Navigate to="/path/:id" />` doesn't interpolate params — use `useParams()`. Follow TanStack Query patterns in existing `use-*.ts` hooks.

**Architecture:** Domain packages re-export with user-facing aliases (see `packages/watches/src/index.ts`). Not every domain needs a package — Digests lives in server. Always check `packages/core/src/index.ts` for actual function signatures before calling.

**Research:** Agent harness (plan → execute → reflect → ingest) in `packages/core/src/agent-harness/`. Depth levels control effort. Delta context prevents repeating old findings. Findings flow to Library via `ingestResearchResult`. Feedback loop: ratings influence generation prompts (wrapped in try/catch).

## Key Files

| What | Where |
|------|-------|
| All core exports | `packages/core/src/index.ts` |
| Memory/belief logic | `packages/core/src/memory/memory.ts` |
| Research findings | `packages/library/src/findings.ts` |
| Unified search | `packages/library/src/search.ts` |
| Watch templates | `packages/watches/src/templates.ts` |
| Briefing generation | `packages/server/src/briefing.ts` |
| Digest ratings | `packages/server/src/digest-ratings.ts` |
| Worker loop | `packages/server/src/workers.ts` |
| Server migrations | `packages/server/src/migrations.ts` |
| UI router | `packages/ui/src/App.tsx` |
| UI navigation | `packages/ui/src/components/Layout.tsx` |

## Product Guardrails

These protect the product from drifting. Read them before proposing new features.

**Watches are not generic schedulers.** A Watch is an ongoing decision — not a bucket for every background process.

**Digests must recommend, not dump.** A Digest contains a recommendation, what changed, sources, memory assumptions, and next actions. Never raw research notes without a recommendation.

**To-Dos are follow-through, not a task manager.** They emerge from Digest recommendations and link back to Watches. They are not a standalone backlog.

**Memory must be traceable.** Every memory has provenance, origin, confidence, and correction state. Changes to memory must preserve or improve traceability.

**Core loop works without optional services.** Browser automation and sandbox are enrichments. Watch → Digest → Correction must work when they're unavailable.

**Internal nouns stay internal.** Swarm, blackboard, queue, schedule — these are implementation details. Don't expose them in UI, CLI, or API responses.

## Evolving the Product

Agents working on this project long-term should improve it, not just execute tasks.

**Check quality signals:**
- Digest ratings in `digest_ratings` table — low average means digests aren't useful
- Telemetry spans in `telemetry_spans` — high error rates or slow spans indicate problems
- Product events in `product_events` — track what users actually use

**After completing work, consider:**
- Did I discover a pattern that future work should follow? → Add it to "Codebase Patterns" above
- Did I find a gotcha that wasted time? → Add it to "Codebase Patterns" above
- Did the product boundary test ("does this strengthen the core loop?") reveal a gap? → Note it in the commit message
- Is there a test that should exist but doesn't? → Write it

**When proposing improvements:**
- Start from user impact, not code elegance
- Small, shipped improvements beat ambitious rewrites
- If unsure whether a change fits the product direction, check the guardrails above

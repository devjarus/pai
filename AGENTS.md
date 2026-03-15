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

A self-hosted personal AI — it remembers what matters, watches things in the background, and delivers personalized digests. Think "second brain that keeps you updated."

**Core loop:** Ask → Watch → Digest → Correction or To-Do → Next digest improves.

The core loop is the backbone, but the product can grow beyond it. New capabilities are welcome when they make the system more useful.

## Four Domains

| Domain | Package | API | What it owns |
|--------|---------|-----|-------------|
| **Library** | `packages/library` | `/api/library/*` | Memories, documents, research findings, unified search, ingestion pipelines |
| **Watches** | `packages/watches` | `/api/watches/*` | Recurring monitoring, templates, depth levels, delta research |
| **Digests** | `packages/server` (briefing) | `/api/digests/*` | Generation, ratings, corrections, suggestions, feedback loop |
| **Tasks** | `packages/plugin-tasks` | `/api/tasks/*` | To-dos linked to watches and digests, goals |

**Shared foundation** in `packages/core`: LLM client, storage (SQLite), telemetry, auth, agent harness.

**Other packages:** `plugin-assistant` (chat agent), `plugin-research` (research agents), `plugin-swarm` (parallel agents), `plugin-telegram` (Telegram bot), `plugin-curator` (memory health), `cli` (CLI + MCP server), `ui` (React SPA).

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
| Activity | `Job` |

## Rules

1. **`pnpm verify` must pass** before claiming done
2. **Don't break existing tests.** If you add a migration, update the count in `packages/server/test/migrations.test.ts`
3. **Update CHANGELOG.md** when you change user-facing behavior
4. **Stay in scope.** Don't refactor unrelated code or add unrequested features
5. **Use product language** in user-facing surfaces. Internal code keeps its own names

## Where New Work Goes

| Type of work | Where it goes |
|-------------|--------------|
| New data entity | `packages/library` (knowledge related) or relevant domain package |
| New API endpoint | `packages/server/src/routes/` — new file, register in `index.ts` |
| New UI page | `packages/ui/src/pages/` — wire in `App.tsx`, add to `Layout.tsx` nav if needed |
| New hook | `packages/ui/src/hooks/use-*.ts` — export from `hooks/index.ts` |
| New background job | `packages/server/src/workers.ts` + `background-dispatcher.ts` |
| Research improvement | `packages/plugin-research/` — use agent harness pattern |
| New delivery surface | Follow `packages/plugin-telegram/` as the pattern |
| Memory/belief change | `packages/core/src/memory/` — read `docs/MEMORY-LIFECYCLE.md` first |

## Codebase Patterns

**Testing:** `createStorage` needs a real directory — use `mkdtempSync`, never `:memory:`

**Routes:** `validate(schema, data)` — schema FIRST. Errors: `reply.status(404).send({ error: "..." })`. Fastify throws on duplicate paths.

**React:** `<Navigate to="/path/:id" />` doesn't interpolate params — use `useParams()`. Follow TanStack Query patterns in existing `use-*.ts` hooks.

**Architecture:** Domain packages re-export with user-facing aliases (see `packages/watches/src/index.ts`). Not every domain needs a package. Always check `packages/core/src/index.ts` for function signatures.

**Research:** Agent harness (plan → execute → reflect → ingest) in `packages/core/src/agent-harness/`. Depth levels control effort. Delta context prevents repeating old findings. Findings flow to Library via `ingestResearchResult`.

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

## Design Principles

Guidelines, not gates. Use judgment.

**Digests should recommend, not dump.** Users want answers, not raw research. Every digest should have a recommendation and reasoning.

**Memory should be traceable.** Provenance, confidence, correction state matter. When changing memory logic, preserve traceability.

**Make it work for one user first.** pai is self-hosted for a technical individual. Optimize for that before scaling to teams or non-technical users.

**Prefer compounding over one-shot.** Research should build on previous findings. Corrections should improve future digests. The system should get smarter over time.

**Keep the bar low for new features.** If something makes the user's life easier, ship it. Don't gate features behind philosophical purity tests. Test it, ship it, iterate.

## Evolving the Product

Agents working on this project should improve it, not just execute tasks.

**Quality signals to check:**
- `digest_ratings` table — are digests useful?
- `telemetry_spans` — error rates, slow operations
- `product_events` — what do users actually use?

**After completing work:**
- Found a pattern? Add it to Codebase Patterns above
- Found a gotcha? Add it too
- Missing test coverage? Write the test
- See an opportunity to improve UX? Note it in the commit or propose it

**This file is a living document.** Update it when the product evolves. If a section no longer reflects reality, change it. If a pattern is wrong, fix it. The goal is for any agent to land here and be productive in 2 minutes.

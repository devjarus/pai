# AGENTS.md

Instructions for any coding agent working on `pai` — a self-hosted personal AI that watches things for you, remembers what matters, and keeps you updated with personalized digests.

## Quick Start

```bash
pnpm install          # install dependencies
pnpm build            # build all packages
pnpm test             # run all tests (1028+ tests, must all pass)
pnpm lint             # lint check
pnpm typecheck        # TypeScript strict check
pnpm verify           # build + lint + typecheck + test (run before claiming done)

pnpm dev:ui           # start UI dev server (Vite + React)
pnpm start            # start API server at http://127.0.0.1:3141
pnpm stop             # stop the server
pnpm e2e              # Playwright end-to-end tests
```

## What This Product Is

A self-hosted AI that keeps track of ongoing decisions and delivers digests to users with their preferences in mind.

**Core loop:** Ask → Watch creation → Digest → Correction or To-Do → Next digest improves.

**The four domains:**

| Domain | What it does | Package | API |
|--------|-------------|---------|-----|
| **Library** | Unified knowledge — memories, documents, research findings | `packages/library` | `/api/library/*` |
| **Watches** | Recurring monitoring with templates and depth levels | `packages/watches` | `/api/watches/*` |
| **Digests** | Decision-ready outputs with ratings and corrections | `packages/server` (briefing) | `/api/digests/*` |
| **Tasks** | To-dos that emerge from digests, linked to watches | `packages/plugin-tasks` | `/api/tasks/*` |

Shared foundation in `packages/core`: LLM client, storage (SQLite), telemetry, auth, agent harness.

**Product nouns (user-facing → internal code):**

| User sees | Code uses | Notes |
|-----------|-----------|-------|
| Memory | `Belief` | Durable knowledge with confidence + decay |
| Document | `KnowledgeSource` | Ingested URLs and uploads |
| Finding | `ResearchFinding` | Structured research output |
| Watch | `ScheduledJob` / `Program` | Recurring monitoring |
| Digest | `Briefing` | Generated output with recommendations |
| To-Do | `Task` | Follow-through action |
| Source | `Evidence` | External reference backing a claim |
| Activity | `Job` | Background work (hidden by default) |

## Rules

1. **Run `pnpm verify` before claiming work is done.** All tests must pass, no type errors, no lint errors.
2. **Don't break existing tests.** If you add a migration, update the count in `packages/server/test/migrations.test.ts`.
3. **Update docs when you change behavior.** If you rename a concept, add an API, or change the core loop — update CHANGELOG.md and relevant docs in the same commit.
4. **Stay in scope.** Don't refactor unrelated code. Don't add features that weren't asked for.
5. **Keep changes small and reviewable.** One concern per commit. Commit often.
6. **Use new product language in user-facing surfaces.** UI labels, CLI output, API responses, Telegram messages use Watch/Digest/Memory/To-Do. Internal code can keep Belief/Briefing/ScheduledJob.

## Codebase Patterns

These patterns are validated by the codebase. Follow them to avoid common mistakes.

**Testing:**
- `createStorage` requires a real directory path — use `mkdtempSync` for temp dirs, never `:memory:`
- Migration count test: `packages/server/test/migrations.test.ts` asserts total count — update it when adding migrations

**Server routes:**
- `validate(schema, data)` — schema FIRST, data second (see `packages/server/src/validate.ts`)
- Error responses: `reply.status(404).send({ error: "..." })` — never use `app.httpErrors`
- Fastify throws on duplicate route paths — don't add 301 redirects while old routes still exist
- URL learning: fetch page via `fetchPageAsMarkdown` first, then `learnFromContent` — never pass raw URL

**React/UI:**
- `<Navigate to="/path/:id" />` doesn't interpolate params — use a component with `useParams()`
- Hooks follow TanStack Query patterns — see any `use-*.ts` file in `packages/ui/src/hooks/`
- Follow existing shadcn/ui + Tailwind patterns

**Architecture:**
- Domain packages re-export from underlying packages with user-facing aliases (see `packages/watches/src/index.ts`)
- Domains interact through TypeScript functions, not HTTP — the boundary is the module interface
- Not every domain needs its own package — Digests lives in the server because briefing logic is deeply integrated
- Always verify function signatures by reading `packages/core/src/index.ts` before calling core functions
- Core exports `AgentContext` — avoid naming collisions (use `AgentHarnessContext` etc.)

**Research system:**
- Agent harness pattern: plan → execute → reflect → ingest (see `packages/core/src/agent-harness/`)
- Depth levels (quick/standard/deep) control research effort per watch
- Delta context: previous findings appended to goal so agents don't repeat themselves
- Findings flow to Library via `ingestResearchResult` — this is how knowledge compounds
- Feedback loop: digest ratings influence next generation via prompt context (wrapped in try/catch)

## Key Files

| What | Where |
|------|-------|
| All core exports | `packages/core/src/index.ts` |
| Memory/belief CRUD | `packages/core/src/memory/memory.ts` |
| Knowledge ingestion | `packages/core/src/knowledge.ts` |
| Research findings | `packages/library/src/findings.ts` |
| Unified search | `packages/library/src/search.ts` |
| Ingestion pipelines | `packages/library/src/ingestion.ts` |
| Watch templates | `packages/watches/src/templates.ts` |
| Depth levels | `packages/watches/src/depth.ts` |
| Briefing generation | `packages/server/src/briefing.ts` |
| Digest ratings | `packages/server/src/digest-ratings.ts` |
| Background dispatch | `packages/server/src/background-dispatcher.ts` |
| Worker loop | `packages/server/src/workers.ts` |
| Server migrations | `packages/server/src/migrations.ts` |
| Route registration | `packages/server/src/index.ts` |
| UI router | `packages/ui/src/App.tsx` |
| UI navigation | `packages/ui/src/components/Layout.tsx` |
| Product charter | `docs/PRODUCT-CHARTER.md` |
| Architecture decisions | `docs/decisions/` |

## When Making Significant Changes

For multi-step tasks, architecture changes, or core-loop modifications:

1. **Read first:** [docs/PRODUCT-CHARTER.md](docs/PRODUCT-CHARTER.md), [docs/PRIMITIVES.md](docs/PRIMITIVES.md), [docs/DEFINITION-OF-DONE.md](docs/DEFINITION-OF-DONE.md)
2. **Plan before coding** — understand the scope and what tests you'll need
3. **Test as you go** — write tests first when adding new functions
4. **Update docs in the same task** — don't defer doc updates
5. **Run `pnpm verify`** before claiming done

For reactive work (fixing CI failures, test failures, build breaks):
- Find the root cause before applying a fix
- Add a guard (test or check) that prevents the same failure
- Record what broke and why in the commit message

## Validation

```bash
pnpm verify              # must pass — build + lint + typecheck + test
pnpm harness:core-loop   # run when touching Watches, Digests, memory, corrections
pnpm harness:regressions # run for repo-wide integrity checks
pnpm e2e                 # run when touching UI flows
```

Checklists (use when relevant):
- `harness/checklists/core-loop-change-checklist.md`
- `harness/checklists/memory-change-checklist.md`
- `harness/checklists/ui-change-checklist.md`
- `harness/checklists/reactive-fix-checklist.md`

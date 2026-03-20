# AGENTS.md

## What pai Is

Self-hosted personal AI — remembers what matters, watches things in the background, delivers personalized digests.

**Core loop:** Ask → Watch → Digest → Correction → Next digest improves.

## Quick Start

```bash
pnpm install && pnpm build
pnpm verify                   # typecheck + test + coverage — MUST pass before done (62 files, 1032+ tests, 80% coverage)
pnpm harness:core-loop        # integration test: Watch → Digest → Correction → Improvement
pnpm dev:ui                   # UI dev server
pnpm start                    # API at http://127.0.0.1:3141
pnpm e2e                      # Playwright browser tests
```

**Clean build** (if dist is corrupted or after deleting dist folders):
```bash
find . -name "*.tsbuildinfo" -delete
pnpm --filter @personal-ai/core build   # core must build first (composite: true)
pnpm build                               # then everything else
```

## Rules

1. `pnpm verify` must pass before done
2. Don't break existing tests — update migration count if adding migrations
3. Update CHANGELOG.md for user-facing changes
4. Stay in scope — no drive-by refactors

## Hooks

| Hook | What it does |
|------|-------------|
| **pre-commit** | `lint-staged` (eslint --fix on staged .ts files) + `agent-guard.sh` (nudges CHANGELOG/docs updates — bypass with `--no-verify` if not applicable) |
| **pre-push** | `pnpm ci` (same as verify — typecheck + test + coverage) |

## Domains

| Domain | Package | API |
|--------|---------|-----|
| Library | `packages/library` | `/api/library/*` |
| Watches | `packages/watches` | `/api/watches/*` |
| Digests | `packages/server` | `/api/digests/*` |
| Tasks | `packages/plugin-tasks` | `/api/tasks/*` |

Foundation: `packages/core` (LLM, storage, telemetry, auth, memory engine)

## Naming (user-facing → code)

Memory = `Belief` · Document = `KnowledgeSource` · Finding = `ResearchFinding` · Watch = `ScheduledJob` · Digest = `Briefing` · To-Do = `Task` · Activity = `Job`

## Where Things Go

- Data entity → `packages/library` or relevant domain
- API route → `packages/server/src/routes/library.ts` (unified) or domain-specific route file
- UI page → `packages/ui/src/pages/`, wire in `App.tsx` — read [PRODUCT.md](docs/PRODUCT.md) for look and feel
- Background job → `packages/server/src/workers.ts`
- Memory change → `packages/core/src/memory/` — read [MEMORY-LIFECYCLE.md](docs/MEMORY-LIFECYCLE.md)
- Research module → `packages/plugin-research/src/` (6 modules: types, repository, prompts, tools, charts, research)
- Architecture reference → [ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Patterns

- `validate(schema, data)` — schema first
- Errors: `reply.status(404).send({ error: "..." })`
- Tests: `createStorage` needs real dir — use `mkdtempSync`
- Migration count test: `packages/server/test/migrations.test.ts`
- Domain packages re-export with user-facing aliases
- New package → add to `Dockerfile` (both build stage manifests AND runtime stage dist copies)
- Shared UI utilities: `lib/datetime.ts` (timeAgo, formatDate, formatDateTime, formatInterval)
- Shared UI components: `ConfirmDialog`, `QueryError`

## Quality Checks (server must be running)

```bash
curl -s localhost:3141/api/library/findings | jq '.[0] | {summary,sources,confidence}'
curl -s localhost:3141/api/digests/latest | jq '.sections | {recommendation,evidence,next_actions}'
curl -s localhost:3141/api/observability/overview | jq '{errorCount,totalSpans}'
curl -s localhost:3141/api/watches | jq '.[] | select(.status=="active") | {title,nextRunAt}'
```

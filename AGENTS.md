# AGENTS.md

## Quick Start

```bash
pnpm install && pnpm build
pnpm verify                   # MUST pass before claiming done
pnpm dev:ui                   # UI dev server
pnpm start                    # API at http://127.0.0.1:3141
```

## What pai Is

Self-hosted personal AI — remembers what matters, watches things in the background, delivers personalized digests.

**Core loop:** Ask → Watch → Digest → Correction or To-Do → Next digest improves.

## Domains

| Domain | Package | API |
|--------|---------|-----|
| Library | `packages/library` | `/api/library/*` |
| Watches | `packages/watches` | `/api/watches/*` |
| Digests | `packages/server` | `/api/digests/*` |
| Tasks | `packages/plugin-tasks` | `/api/tasks/*` |

Foundation: `packages/core` (LLM, storage, telemetry, auth, agent harness)

## Naming (user-facing → code)

Memory = `Belief` · Document = `KnowledgeSource` · Finding = `ResearchFinding` · Watch = `ScheduledJob` · Digest = `Briefing` · To-Do = `Task` · Activity = `Job`

## Rules

1. `pnpm verify` must pass before done
2. Don't break existing tests — update migration count if adding migrations
3. Update CHANGELOG.md for user-facing changes
4. Stay in scope

## Where Things Go

- Data entity → `packages/library` or relevant domain
- API route → `packages/server/src/routes/`, register in `index.ts`
- UI page → `packages/ui/src/pages/`, wire in `App.tsx`
- Background job → `packages/server/src/workers.ts`
- Memory change → `packages/core/src/memory/` — read [MEMORY-LIFECYCLE.md](docs/MEMORY-LIFECYCLE.md)
- Systems architecture → read [ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Setup/deployment → read [SETUP.md](docs/SETUP.md)

## Patterns

- `validate(schema, data)` — schema first
- Errors: `reply.status(404).send({ error: "..." })`
- Tests: `createStorage` needs real dir — use `mkdtempSync`
- Migration count test: `packages/server/test/migrations.test.ts`
- Domain packages re-export with user-facing aliases
- Agent harness: plan → execute → reflect → ingest
- Research: depth levels + delta context = compounding knowledge

## This File

Living document. If you find a pattern or gotcha, add it. If something is wrong, fix it. Keep it under 80 lines.

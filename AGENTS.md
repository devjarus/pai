# AGENTS.md

## What pai Is

Self-hosted personal AI — remembers what matters, watches things in the background, delivers personalized digests.

**Core loop:** Ask → Watch → Digest → Correction → Next digest improves.

## Quick Start

```bash
pnpm install && pnpm build
pnpm verify
pnpm harness:core-loop
pnpm harness:regressions
pnpm start                    # API at http://127.0.0.1:3141
pnpm dev:ui                   # UI dev server
pnpm e2e
```

If `dist` is stale or broken:
```bash
find . -name "*.tsbuildinfo" -delete
pnpm --filter @personal-ai/core build
pnpm build
```

## Non-Negotiables

1. **All three gates must pass before done:**
   ```bash
   pnpm verify              # Typecheck + unit tests + coverage
   pnpm harness:core-loop   # Core loop scenario tests
   pnpm e2e                 # Browser smoke tests
   ```
2. Keep changes scoped; no drive-by refactors
3. Update CHANGELOG.md for user-facing changes
4. Update migration tests if you add a migration
5. Do not hardcode secrets, API keys, live team IDs, or project IDs

## Hooks

| Hook | What it does |
|------|-------------|
| **pre-commit** | `lint-staged` (eslint --fix on staged .ts files) + `agent-guard.sh` (nudges CHANGELOG/docs updates — bypass with `--no-verify` if not applicable) |
| **pre-push** | `pnpm ci` (same as verify — typecheck + test + coverage) |

## Workflow

1. Pick the owning architecture block
2. State what you're changing and what must not regress
3. Make the smallest change that proves the fix
4. Update CHANGELOG.md for user-facing changes
5. Update docs/README/ARCHITECTURE.md if the change is significant (new routes, new packages, changed domain boundaries)
6. Pass all three gates
7. Commit with a message that summarizes what changed, why, and any residual risk

## Architecture Blocks

- **Core Platform**: API, runtime/config/auth/storage, memory, knowledge, watches, digests, tasks/actions, background orchestration, quality/observability, channel adapters
- **Agent Plane**: assistant, curator, research, swarm

If ownership is unclear, stop and resolve that first. Do not hide product rules inside agent code.

## Naming (user-facing → code)

Memory = `Belief` · Document = `KnowledgeSource` · Finding = `ResearchFinding` · Watch = `ScheduledJob` · Digest = `Briefing` · To-Do = `Task` · Activity = `Job`

## Where Things Go

- Core platform state/rules → owning domain block first, then the current package that implements it
- Agent behavior / planning / synthesis → agent-plane package and, when possible, through `packages/core/src/agent-harness/`
- Data entity → `packages/library` or relevant core-platform domain
- API route → `packages/server/src/routes/library.ts` (unified) or domain-specific route file
- UI page → `packages/ui/src/pages/`, wire in `App.tsx`
- Background job → `packages/server/src/workers.ts`
- Memory change → `packages/core/src/memory/`
- Architecture reference → [ARCHITECTURE.md](docs/ARCHITECTURE.md) and `docs/architecture/*`
- Coding-agent harness → `harness/README.md`, `harness/scenarios/*`

## Patterns

- `validate(schema, data)` — schema first
- Errors: `reply.status(404).send({ error: "..." })`
- Tests: `createStorage` needs real dir — use `mkdtempSync`
- Migration count test: `packages/server/test/migrations.test.ts`
- If you change UI behavior, smoke test it in a browser
- If you add a new package, update `tsconfig.json` references, `Dockerfile`, and `pnpm-workspace.yaml`

## Validation

All three gates are mandatory. Run `pnpm harness:regressions` additionally if you change harness scripts or architecture docs.

## Useful Spot Checks

```bash
curl -s localhost:3141/api/library/findings | jq '.[0] | {summary,sources,confidence}'
curl -s localhost:3141/api/digests/latest | jq '.sections | {recommendation,evidence,next_actions}'
curl -s localhost:3141/api/observability/overview | jq '{errorCount,totalSpans}'
curl -s localhost:3141/api/watches | jq '.[] | select(.status=="active") | {title,nextRunAt}'
```

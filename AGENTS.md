# AGENTS.md

This file is the front door for any coding agent working in `pai`. It is intentionally short. Treat it as the coordinator, not the full handbook.

For runtime/setup detail, use [docs/SETUP.md](docs/SETUP.md). For system internals, use [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/MEMORY-LIFECYCLE.md](docs/MEMORY-LIFECYCLE.md).

## Repo Quick Start

```bash
pnpm install
pnpm build
pnpm start
pnpm dev:ui

pnpm test
pnpm lint
pnpm typecheck
pnpm verify

pnpm harness:core-loop
pnpm harness:regressions
```

Useful existing entrypoints:

- `pnpm pai ...` for CLI workflows
- `pnpm e2e` for Playwright coverage
- `pnpm stop` to stop the local server

## Required Read Order

Read these in order before making non-trivial changes:

1. [docs/PRODUCT-CHARTER.md](docs/PRODUCT-CHARTER.md)
2. [docs/PRIMITIVES.md](docs/PRIMITIVES.md)
3. [docs/DEFINITION-OF-DONE.md](docs/DEFINITION-OF-DONE.md)
4. Relevant files under [docs/decisions](docs/decisions)
5. Relevant checklists under [harness/checklists](harness/checklists)

Read these as needed for implementation detail:

- [docs/ARCHITECTURE-BOUNDARIES.md](docs/ARCHITECTURE-BOUNDARIES.md)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/MEMORY-LIFECYCLE.md](docs/MEMORY-LIFECYCLE.md)
- [docs/SETUP.md](docs/SETUP.md)

## Mandatory Workflow

Before coding:

- Create a task contract from [harness/task-contract.template.yaml](harness/task-contract.template.yaml) for any multi-step task, architecture change, or core-loop change.
- Save it under `harness/runs/`.
- Keep per-task files in `harness/runs/` local to the working tree; do not commit them.
- Set `work_mode` in the task contract. Use `reactive` when the task is triggered by CI, coverage, build, regression, or another failing guardrail.
- Confirm scope, success criteria, validations, and escalation conditions before editing code.

During work:

- Stay within scope.
- Avoid unrelated cleanup unless the task contract is updated first.
- Keep an evidence pack updated during long sessions using [harness/evidence-pack.template.md](harness/evidence-pack.template.md).
- For reactive work, record the failure signal, restore condition, root cause, proof of restore, and prevention step in the evidence pack.
- Record meaningful architectural or product tradeoffs in `docs/decisions/*` when the task changes repo expectations.
- If a change materially alters product behavior, architecture boundaries, memory/correction rules, validation expectations, or operator workflow, update the relevant docs in the same task.
- Relevant docs may include `README.md`, `docs/ARCHITECTURE*.md`, `docs/MEMORY-LIFECYCLE.md`, `docs/SETUP.md`, `docs/DEFINITION-OF-DONE.md`, `docs/decisions/*`, and `CHANGELOG.md`.

Before claiming completion:

- Run the relevant tests and harness checks.
- Use at least one relevant checklist from `harness/checklists/*`.
- Produce or update an evidence pack.
- Confirm whether docs changed. If a significant behavior or workflow change did not require a doc update, say why in the evidence pack and final handoff.
- For reactive work, rerun the failing gate when possible and capture whether the fix added a durable guard.
- State uncertainty honestly.
- Escalate if ambiguity, missing validation, or scope drift remains.

## Long-Session Rule

For work that spans multiple steps, multiple files, or touches the Ask → Watch → Digest → Correction loop:

- create a task contract under `harness/runs/`
- maintain an evidence pack alongside it
- use at least one relevant checklist
- update the task contract before continuing if scope changes

## Product Rules Summary

- Core loop: Ask → Watch creation → Digest → Correction or To-Do → Next digest improves.
- Primary product nouns: `Watch`, `Digest`, `To-Do`, `Memory`, `Source`.
- Internal-only nouns (code): `Belief`, `Briefing`, `ScheduledJob`, `Episode`. These map to user-facing names at the API/UI boundary.
- `Chat` (Thread) is an interaction container, not a primary product object.
- `Activity` (Job) is a user-facing noun for background work visibility, collapsed by default.
- Browser automation and sandbox execution are optional enrichments, not core correctness dependencies.
- Do not promote internal nouns like `swarm`, `blackboard`, or `schedule` into the main product story unless a decision log changes that rule.

## Four Pillars Architecture

The codebase is organized into four domain pillars plus a shared foundation:

| Domain | Package | Owns | User-Facing Name |
|--------|---------|------|-----------------|
| Library | `packages/library` | Memories, Documents, Findings, unified search, ingestion | Library |
| Watches | `packages/watches` | Watch definitions, scheduling, templates, depth levels, delta research | Watches |
| Digests | server/briefing + routes/digests | Digest generation, ratings, corrections, suggestions, feedback loop | Digests |
| Tasks | `packages/plugin-tasks` | To-Dos, Goals, follow-through, linked to Watches and Digests | Tasks |

Shared foundation lives in `packages/core`: LLM client, storage, telemetry, auth, agent harness.

Domains interact through **exported TypeScript functions** (same process), not HTTP. The boundary is the module interface.

See: [docs/superpowers/specs/2026-03-15-four-pillars-roadmap-design.md](docs/superpowers/specs/2026-03-15-four-pillars-roadmap-design.md)

## Agent Execution Patterns (Learned)

These patterns were validated during Phase 1 implementation. Follow them to avoid repeated mistakes.

**Storage tests:** `createStorage` requires a real directory path. Use `mkdtempSync` for temp directories in tests — never `:memory:`.

**Validation:** `validate(schema, data)` — schema first, data second. Every route file follows this. Read `packages/server/src/validate.ts` if unsure.

**Error responses:** Use `reply.status(404).send({ error: "..." })` in Fastify routes. Do NOT use `app.httpErrors` — `@fastify/sensible` may not be registered.

**Migration counts:** `packages/server/test/migrations.test.ts` asserts the total migration count. Update it when adding new migrations.

**Route conflicts:** Fastify throws on duplicate route paths. When adding new routes alongside existing ones (e.g., `/api/library/memories` alongside `/api/beliefs`), do NOT add 301 redirects if the old routes still exist — comment them for when old routes are removed.

**React Router params:** `<Navigate to="/path/:id" />` does NOT interpolate params. Use a redirect component with `useParams()` for parameterized redirects.

**LLM client API:** `correctBelief` is async and requires `LLMClient`. Always verify function signatures by reading actual exports in `packages/core/src/index.ts`.

**Page fetching:** URL learning must fetch page content first via `fetchPageAsMarkdown`, then pass to `learnFromContent`. Never call `learnFromContent` with a raw URL.

**Naming collisions:** Core already exports `AgentContext`. New types should use distinct names (e.g., `AgentHarnessContext`).

**Concurrent agents on same package:** When dispatching parallel agents, ensure they touch different files. Two agents modifying `server/src/index.ts` simultaneously causes merge conflicts. Workers.ts and routes/ are safe to parallelize.

**Wrap, don't rewrite:** When integrating new patterns (e.g., agent harness) into existing code, wrap with callbacks rather than restructuring. The harness wraps research execution — it doesn't replace the LLM call logic.

**Re-export with aliases:** Domain packages (library, watches) re-export from underlying packages with user-facing names. This keeps internal code stable while presenting a clean API. See `packages/watches/src/index.ts` for the pattern.

**Depth + delta = compounding:** Research depth levels control effort per run. Delta context (previous findings appended to the goal) ensures agents don't repeat themselves. Together they make each Watch run more valuable than the last.

**In-place domains are fine:** Not every domain needs a new package. Digests stayed in the server package because briefing logic is deeply woven into workers, dispatch, and generation. A clean API surface (`/api/digests/*`) is sufficient domain boundary.

**Feedback as prompt context:** User ratings and feedback text are injected into the LLM prompt, not the generation logic. This is the lightest integration that still influences output quality. Always wrap feedback queries in try/catch to never break generation.

**Suggestions from structure:** Digest `next_actions` are already structured — extracting them as to-do suggestions is pure data mapping, no LLM needed.

**Dashboard as integration surface:** The Home page pulls from all four domains (Library stats, Watches list, Digests latest, Tasks open). It's the proof that the pillar boundaries work — each domain provides a clean hook and the dashboard composes them.

**Onboarding teaches product language:** The 4-step onboarding introduces Watch, Library, and Digest naturally through user actions, not definitions. "Tell me about yourself" → Library. "What to track?" → Watch. The product explains itself through use.

## Validation Expectations

- The source of truth for completion is [docs/DEFINITION-OF-DONE.md](docs/DEFINITION-OF-DONE.md).
- Release blockers and warn-only issues are defined there and must be reflected in the evidence pack.
- Use `pnpm harness:core-loop` when the change touches Watches, Digests, memory trust, correction handling, or recurring follow-through.
- Use `pnpm harness:regressions` for repo-wide harness integrity checks.
- Pick the checklist that matches the work:
  - `core-loop-change-checklist.md`
  - `memory-change-checklist.md`
  - `reactive-fix-checklist.md`
  - `ui-change-checklist.md`

## Repo Conventions That Still Apply

- Run the existing build/test/dev commands above. Do not invent alternate workflows when the repo already has one.
- Update `CHANGELOG.md` for user-facing product changes.
- Keep changes small, single-purpose, and reviewable.
- Prefer repo-native artifacts over agent-specific notes.
- After significant project changes, record durable context with `pnpm pai memory remember "<what changed and why>"` if the local runtime is available.

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

Before claiming completion:

- Run the relevant tests and harness checks.
- Use at least one relevant checklist from `harness/checklists/*`.
- Produce or update an evidence pack.
- For reactive work, rerun the failing gate when possible and capture whether the fix added a durable guard.
- State uncertainty honestly.
- Escalate if ambiguity, missing validation, or scope drift remains.

## Long-Session Rule

For work that spans multiple steps, multiple files, or touches the Ask -> Program -> Brief -> Correction loop:

- create a task contract under `harness/runs/`
- maintain an evidence pack alongside it
- use at least one relevant checklist
- update the task contract before continuing if scope changes

## Product Rules Summary

- Core loop: Ask -> Keep watching this / Program creation -> Brief -> Correction or Action -> Next brief improves.
- Primary product nouns: `Program`, `Brief`, `Action`, `Belief`, `Evidence`.
- `Thread` is an interaction container, not a primary product object.
- Browser automation and sandbox execution are optional enrichments, not core correctness dependencies.
- Do not promote internal nouns like `swarm`, `job`, `blackboard`, or `schedule` into the main product story unless a decision log changes that rule.

## Validation Expectations

- The source of truth for completion is [docs/DEFINITION-OF-DONE.md](docs/DEFINITION-OF-DONE.md).
- Release blockers and warn-only issues are defined there and must be reflected in the evidence pack.
- Use `pnpm harness:core-loop` when the change touches Programs, Briefs, memory trust, correction handling, or recurring follow-through.
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

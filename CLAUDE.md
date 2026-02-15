# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Local-first personal AI with a plugin architecture. CLI tool (`pai`) backed by SQLite and Ollama/OpenAI.

## Architecture

pnpm monorepo with 4 packages under `packages/`:

- **`core`** (~300 lines) — Config (env-based via `loadConfig`), Storage (better-sqlite3 with migration tracking), LLM Client (Ollama-first, OpenAI fallback), Plugin/Command interfaces
- **`cli`** — Commander.js entrypoint that loads plugins, runs migrations, and wires commands as `pai <group> <command>`
- **`plugin-memory`** — Episodes (append-only observations) + Beliefs (durable knowledge with confidence scores). FTS5 full-text search. LLM extracts beliefs from episodes via `remember()`.
- **`plugin-tasks`** — Tasks (with priority/status/due dates) + Goals. `ai-suggest` feeds tasks+memory to LLM for prioritization.

**Plugin contract:** Plugins implement `Plugin` interface — provide `name`, `version`, `migrations[]`, and `commands(ctx)`. They receive a `PluginContext` with config, storage, and LLM client. No lifecycle hooks or event system.

**Database:** Single SQLite file at `{dataDir}/personal-ai.db`. Each plugin owns its tables; migrations tracked in `_migrations` table. WAL mode, foreign keys enabled.

## Build & Test Commands

```bash
pnpm install                              # install all dependencies
pnpm build                                # build all packages (tsc)
pnpm test                                 # run all tests (vitest)
pnpm test:watch                           # watch mode
pnpm --filter @personal-ai/core test      # test single package
pnpm --filter @personal-ai/plugin-memory test
pnpm --filter @personal-ai/plugin-tasks test
pnpm typecheck                            # type-check all packages
pnpm lint                                 # eslint across all packages
node packages/cli/dist/index.js --help    # run CLI after build
pnpm run test:coverage                   # run tests with v8 coverage
pnpm run verify                          # typecheck + tests
pnpm run ci                              # verify + coverage thresholds
```

## Tech Stack

- TypeScript strict mode, ES2022 target, NodeNext modules
- Node.js 20+, pnpm workspaces
- better-sqlite3 + FTS5 (no external DB servers)
- Commander.js for CLI, Zod for validation, nanoid for IDs
- Vitest for testing
- Vercel AI SDK (ai, @ai-sdk/openai, ai-sdk-ollama) for LLM integration with token tracking
- Ollama (local LLM, default) / OpenAI-compatible API (fallback)

## Configuration

All config via env vars (or `.env`): `PAI_DATA_DIR`, `PAI_LLM_PROVIDER`, `PAI_LLM_MODEL`, `PAI_LLM_BASE_URL`, `PAI_LLM_API_KEY`, `PAI_LLM_FALLBACK_MODE`, `PAI_PLUGINS`.

## Git Hooks

Pre-commit and pre-push hooks via Husky:

- **Pre-commit:** Runs `lint-staged` — lints staged `.ts` files with ESLint
- **Pre-push:** Runs `pnpm run verify` — typecheck + tests must pass

To skip hooks in emergencies: `git commit --no-verify` / `git push --no-verify`

## Coverage

Coverage via `@vitest/coverage-v8` with thresholds enforced in `vitest.config.ts`. Run `pnpm run test:coverage` to check. HTML report generated in `coverage/`.

## Design Constraints

- TypeScript only — no Python, Docker, or separate processes
- SQLite only — no Postgres, Redis, or vector DBs
- Every plugin must be optional — core + any single plugin = working system
- CLI-first — no web UI in current phase
- Target under 2000 lines of source (excluding tests)

## Key Design Documents

- `docs/plans/2026-02-15-unified-personal-ai-design.md` — Full design with rationale, learned from 44 prior failed attempts
- `docs/plans/2026-02-15-implementation-plan.md` — 9-task TDD implementation plan with exact file contents and test-first workflow

## Implementation Plan Task Order

Tasks 1-4 are sequential (scaffold → types/config → storage → LLM client). Tasks 5-7 can parallelize (memory CRUD, memory LLM export, tasks plugin). Task 8 (CLI) depends on 5-7. Task 9 (polish) is last.

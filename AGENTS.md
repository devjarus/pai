# AGENTS.md

This file provides guidance to coding agents (Codex, Claude Code) when working with code in this repository.

## Project Overview

Persistent AI memory layer for coding agents. CLI tool (`pai`) + MCP server backed by SQLite and Ollama/OpenAI. Core value: belief lifecycle (create → reinforce → contradict → decay → prune) with semantic search.

## Architecture

pnpm monorepo with 3 packages under `packages/`:

- **`core`** — Config (env-based via `loadConfig`), Storage (better-sqlite3 with migration tracking), LLM Client (Ollama-first, OpenAI fallback, embedding support), Logger (NDJSON to stderr + file), Plugin/Command interfaces, **Memory** (episodes, beliefs, embeddings, semantic search, contradiction detection, context packing). Memory is always available — it's the product, not a plugin.
- **`cli`** — Commander.js entrypoint that registers memory commands unconditionally, loads optional plugins, runs migrations, and wires commands as `pai <group> <command>`
- **`plugin-tasks`** — Tasks (with priority/status/due dates) + Goals. `ai-suggest` feeds tasks+memory to LLM for prioritization.

**Plugin contract:** Plugins implement `Plugin` interface — provide `name`, `version`, `migrations[]`, and `commands(ctx)`. They receive a `PluginContext` with config, storage, LLM client, and logger. No lifecycle hooks or event system.

**Database:** Single SQLite file at `{dataDir}/personal-ai.db`. Each plugin owns its tables; migrations tracked in `_migrations` table. WAL mode, foreign keys enabled.

## Build & Test Commands

```bash
pnpm install                              # install all dependencies
pnpm build                                # build all packages (tsc)
pnpm test                                 # run all tests (vitest)
pnpm test:watch                           # watch mode
pnpm --filter @personal-ai/core test      # test single package (includes memory)
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

All config via env vars (or `.env`): `PAI_DATA_DIR`, `PAI_LLM_PROVIDER`, `PAI_LLM_MODEL`, `PAI_LLM_EMBED_MODEL`, `PAI_LLM_BASE_URL`, `PAI_LLM_API_KEY`, `PAI_LLM_FALLBACK_MODE`, `PAI_PLUGINS`, `PAI_LOG_LEVEL`.

## Logging

Structured NDJSON logging via `createLogger()` with dual output:

- **Stderr:** Controlled by `PAI_LOG_LEVEL` env var. Levels: `silent` (default), `error`, `warn`, `info`, `debug`. Set `PAI_LOG_LEVEL=debug` to see all internal activity.
- **File:** Always writes to `{dataDir}/pai.log` at `info` level by default (configurable via `LogFileOptions.level`). File logging is automatic — no extra config needed.
- **Rotation:** Size-based, 5MB max with 1 backup (`pai.log.1`). Checked at logger creation.
- **Debugging:** Check `~/.personal-ai/pai.log` (or your `PAI_DATA_DIR`) for post-hoc debugging. Logs persist even when stderr is `silent`.

## Git Hooks

Pre-commit and pre-push hooks via Husky:

- **Pre-commit:** Runs `lint-staged` — lints staged `.ts` files with ESLint
- **Pre-push:** Runs `pnpm run ci` — typecheck + tests + coverage thresholds must pass

To skip hooks in emergencies: `git commit --no-verify` / `git push --no-verify`

## Coverage

Coverage via `@vitest/coverage-v8` with thresholds enforced in `vitest.config.ts`. Run `pnpm run test:coverage` to check. HTML report generated in `coverage/`.

## Design Constraints

- TypeScript only — no Python, Docker, or separate processes
- SQLite only — no Postgres, Redis, or external vector DBs (embeddings stored as JSON in SQLite)
- Every plugin must be optional — core + any single plugin = working system
- CLI-first — no web UI in current phase
- Target under 2000 lines of source (excluding tests)

## CLI as Agent Tools

The `pai` CLI commands can be called directly from any coding agent (Claude Code, Codex) via bash. After `pnpm build`, run with `node packages/cli/dist/index.js` or alias as `pai`.

### Memory — Store and retrieve personal knowledge

```bash
# Store a fact/preference — LLM extracts beliefs, deduplicates via embeddings
pai memory remember "User prefers Vitest over Jest for TypeScript projects"

# Semantic search — finds beliefs by meaning, not just keywords
pai memory recall "testing framework preference"

# Get formatted context block for LLM injection
pai memory context "coding preferences"

# List all active beliefs sorted by confidence
pai memory beliefs
pai memory beliefs --status forgotten    # see forgotten/invalidated beliefs

# Soft-delete a belief (preserves audit trail)
pai memory forget <id-or-prefix>

# Remove low-confidence beliefs (default threshold: 0.05)
pai memory prune
pai memory prune --threshold 0.1

# Scan for duplicate and stale beliefs
pai memory reflect

# Memory health summary
pai memory stats

# Export/import memory for backup or migration
pai memory export backup.json
pai memory import backup.json

# View belief change history
pai memory history <id-or-prefix>

# List raw episodes (observations)
pai memory episodes --limit 10
```

### Tasks — Track work items

```bash
# Add a task
pai task add "Implement auth middleware" --priority high --due 2026-03-01

# List tasks (default: open)
pai task list
pai task list --status done
pai task list --status all

# Complete / reopen a task
pai task done <id-or-prefix>
pai task reopen <id-or-prefix>

# Edit a task
pai task edit <id-or-prefix> --title "New title" --priority medium --due 2026-04-01

# AI-powered prioritization (uses memory context + open tasks)
pai task ai-suggest
```

### Goals

```bash
pai goal add "Launch personal AI v1"
pai goal list
pai goal done <id-or-prefix>
```

### Health

```bash
pai health    # check LLM provider connectivity
```

## MCP Server

pai exposes an MCP (Model Context Protocol) server for native integration with Claude Code, Cursor, Windsurf, and any MCP-compatible agent. This is the primary integration point for coding agents.

**Start the server:**
```bash
node packages/cli/dist/mcp.js    # stdio transport
```

**Configure in Claude Code** (`~/.claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "pai": {
      "command": "node",
      "args": ["/absolute/path/to/packages/cli/dist/mcp.js"]
    }
  }
}
```

**Available tools:** `remember`, `recall`, `memory-context`, `beliefs`, `forget`, `memory-stats`, `task-list`, `task-add`, `task-done`, `task-edit`, `task-reopen`, `goal-list`, `goal-add`, `goal-done`

### Exit Codes

- **0** — success (results found or mutation succeeded)
- **1** — error (invalid ID, missing args, LLM failure)
- **2** — no results (empty search, no tasks/beliefs/episodes)

Agents can branch on `$?`: `pai memory recall "topic" && echo "found" || echo "empty or error"`.

### JSON Mode

All commands support `--json` for structured output:
```bash
pai --json task list          # returns JSON array of task objects
pai --json memory beliefs     # returns JSON array of belief objects
pai --json memory recall "X"  # returns JSON array (empty [] if no results)
pai --json task done <id>     # returns {"ok":true} or {"error":"..."} with exit code 1
```

### Agent Usage Patterns

**Before starting work** — retrieve relevant context:
```bash
pai memory recall "error handling preferences"
pai task list --status open
```

**During work** — store learnings:
```bash
pai memory remember "User's project uses Zod for validation, not Joi"
```

**After completing work** — update tasks:
```bash
pai task done <id>
pai memory remember "Completed auth middleware using JWT approach"
```

**All IDs support prefix matching** — use first 8 characters instead of the full nanoid.

## Dogfooding (MANDATORY)

This project builds `pai` — a persistent memory tool for coding agents. You ARE the target user. Use `pai` throughout every session, not just at the end. The CLI is at `node packages/cli/dist/index.js` (build first with `pnpm build`).

### Session Start — recall before doing anything

```bash
pai memory recall "<topic you're about to work on>"
pai task list
```

Apply retrieved beliefs to your approach. If a belief says "User prefers X over Y", follow it.

### During Work — store decisions as they happen

**When the user makes a design decision or rejects an approach**, store it immediately:

```bash
pai memory remember "<decision and rationale>"
```

Don't wait until the end. Decisions made mid-conversation are the most valuable beliefs — they capture the "why" that code can't.

**When you discover something about the codebase**, store it:

```bash
pai memory remember "<what you learned>"
```

### When Deciding What To Work On

```bash
pai task ai-suggest
```

### After Completing Work

```bash
pai memory remember "<what was done and key outcomes>"
pai task done <id>
pai task add "<new tasks discovered>" --priority <low|medium|high>
```

### Per-Session Checklist

- [ ] `memory recall` before starting work
- [ ] `memory remember` after every design decision or rejection
- [ ] `memory remember` when discovering codebase facts
- [ ] `task ai-suggest` when choosing what to work on
- [ ] `memory remember` + `task done` after completing work

## Architecture Reference

See `docs/ARCHITECTURE.md` for full design, data model, and future plugin path.

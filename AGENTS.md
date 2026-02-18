# AGENTS.md

This file provides guidance to coding agents (Codex, Claude Code) when working with code in this repository.

## Project Overview

Local-first personal AI with a plugin architecture. CLI tool (`pai`) backed by SQLite and Ollama/OpenAI.

## Architecture

pnpm monorepo with 4 packages under `packages/`:

- **`core`** (~300 lines) — Config (env-based via `loadConfig`), Storage (better-sqlite3 with migration tracking), LLM Client (Ollama-first, OpenAI fallback, embedding support), Logger (NDJSON to stderr + file), Plugin/Command interfaces
- **`cli`** — Commander.js entrypoint that loads plugins, runs migrations, and wires commands as `pai <group> <command>`
- **`plugin-memory`** — Episodes (append-only observations) + Beliefs (durable knowledge with confidence scores, typed as `fact` or `insight`). Semantic search via embeddings (cosine similarity) with FTS5 fallback. `remember()` extracts dual beliefs (personal fact + generalized insight) and uses embedding similarity for smart dedup/merge. Features: 30-day confidence decay, LLM-based contradiction detection, belief change audit trail, context packing for cross-plugin LLM injection.
- **`plugin-tasks`** — Tasks (with priority/status/due dates) + Goals. `ai-suggest` feeds tasks+memory to LLM for prioritization.

**Plugin contract:** Plugins implement `Plugin` interface — provide `name`, `version`, `migrations[]`, and `commands(ctx)`. They receive a `PluginContext` with config, storage, LLM client, and logger. No lifecycle hooks or event system.

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
- **Pre-push:** Runs `pnpm run verify` — typecheck + tests must pass

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

pai exposes an MCP (Model Context Protocol) server for native integration with Claude Code, Cursor, Windsurf, and any MCP-compatible agent.

**Start the server:**
```bash
node packages/cli/dist/mcp.js    # stdio transport
```

**Configure in Claude Code** (`~/.claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "personal-ai": {
      "command": "node",
      "args": ["/absolute/path/to/packages/cli/dist/mcp.js"]
    }
  }
}
```

**Available tools:** `remember`, `recall`, `memory-context`, `beliefs`, `forget`, `task-list`, `task-add`, `task-done`, `goal-list`, `goal-add`

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

## Development Workflow

When working on this project, use `pai` itself to guide development:

```bash
# 1. Check what to work on
pai task ai-suggest

# 2. Before implementing, recall relevant context
pai memory recall "<topic>"

# 3. After implementing, remember what you learned
pai memory remember "<what you learned or decided>"

# 4. Mark completed work
pai task done <id>

# 5. Add new tasks discovered during work
pai task add "<title>" --priority <low|medium|high>
```

Keep it simple. Don't add features unless they're clearly valuable. Prefer small, composable commands over complex workflows.

## Architecture Reference

See `docs/ARCHITECTURE.md` for full design, data model, and future plugin path.

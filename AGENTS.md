# AGENTS.md

This file provides guidance to coding agents (Codex, Claude Code) when working with code in this repository.

## Project Overview

Personal AI agent platform. Chat via web UI or Telegram, manage tasks, learn from web pages, and build persistent memory — with CLI, MCP server, REST API, and a plugin architecture. Backed by SQLite and Ollama/OpenAI/Anthropic/Google AI.

## Architecture

pnpm monorepo with 8 packages under `packages/`:

- **`core`** — Config (env vars + config.json via `loadConfig`), Storage (better-sqlite3 with migration tracking, transaction-wrapped migrations, automatic pre-migration backups via `backupDatabase()`), LLM Client (multi-provider: Ollama, OpenAI, Anthropic, Google — with `humanizeError()` for friendly error messages), Logger (NDJSON to stderr + file), Plugin/Command/AgentPlugin interfaces, **Memory** (episodes, beliefs, embeddings, semantic search, `classifyRelationship()` for 3-way grey zone contradiction detection, proportional evidence weighing, context packing, unified retrieval), **Knowledge** (web page chunks, FTS5 prefilter + cosine re-ranking). Memory is always available — it's the product, not a plugin.
- **`cli`** — Commander.js entrypoint that registers memory commands unconditionally, loads optional plugins, runs migrations, and wires commands as `pai <group> <command>`. Includes `pai init` for interactive project setup.
- **`plugin-tasks`** — Tasks (with priority/status/due dates) + Goals. `ai-suggest` feeds tasks+memory to LLM for prioritization.
- **`plugin-assistant`** — Personal Assistant agent plugin with persistent memory, Brave web search, knowledge base, and task management. Implements `AgentPlugin` with `createTools()` (AI SDK tool definitions for memory, knowledge, search, tasks) and `afterResponse` (extracts learnings into memory). Uses `retrieveContext()` for unified belief + knowledge retrieval.
- **`plugin-curator`** — Memory Curator agent plugin. Analyzes memory health (duplicates, stale beliefs, contradictions) and fixes issues with user approval. Tools: `curate_memory`, `fix_issues`, `list_beliefs`.
- **`plugin-telegram`** — Telegram bot interface. Uses grammY to connect to Telegram, reuses the same agent chat pipeline (memory, tools, web search) as the web UI. Runs standalone without the Fastify server. Thread persistence via `telegram_threads` mapping table.
- **`server`** — Fastify API server. Serves REST endpoints for memory, agents, chat (SSE streaming), config, and threads. Also serves the static UI build. Has `reinitialize()` for hot-swapping data directories. Default port: 3141.
- **`ui`** — React + Vite + Tailwind CSS + shadcn/ui SPA. Pages: Chat (SSE streaming, markdown rendering, token usage badge), Memory Explorer (type tooltips, explainer, clear all), Knowledge (browse sources, view chunks, search), Settings (editable config, directory browser, provider presets auto-fill), Timeline. Global error handling via `ErrorBoundary` and `OfflineBanner` (auto-reconnect detection).

**Plugin contract:** Two interfaces:

- **`Plugin`** — Provides `name`, `version`, `migrations[]`, and `commands(ctx)`. Receives a `PluginContext` with config, storage, LLM client, and logger.
- **`AgentPlugin extends Plugin`** — Adds `agent` field with `displayName`, `description`, `systemPrompt`, `capabilities`, `createTools(ctx)`, `afterResponse(ctx, response)`. Used by the server to power chat-based agents with AI SDK tool-calling.

**Database:** Single SQLite file at `{dataDir}/personal-ai.db`. Each plugin owns its tables; migrations tracked in `_migrations` table. WAL mode, foreign keys enabled.

## Build & Run

```bash
pnpm install                              # install all dependencies
pnpm build                                # build all packages (tsc + vite)
pnpm start                                # start server (port 3141)
pnpm stop                                 # stop server (reads PID file)
pnpm dev                                  # build + start server
pnpm dev:ui                               # vite dev server (hot reload, proxies API)
```

## Docker

```bash
# Cloud provider only (no Ollama)
docker compose up -d

# With local Ollama sidecar
docker compose --profile local up -d

# One-click install (interactive — asks for provider choice)
curl -fsSL https://raw.githubusercontent.com/devjarus/pai/main/install.sh | bash
```

The `docker-compose.yml` uses Docker Compose profiles: Ollama is in the `local` profile so it only starts when requested. LLM configuration is passed via environment variables (`PAI_LLM_PROVIDER`, `PAI_LLM_BASE_URL`, `PAI_LLM_MODEL`, `PAI_LLM_API_KEY`) or configured in the Settings UI after startup.

GitHub Actions (`.github/workflows/docker.yml`) builds and pushes Docker images to GHCR on `v*` tag push.

## Test Commands

```bash
pnpm test                                 # run all tests (vitest)
pnpm test:watch                           # watch mode
pnpm --filter @personal-ai/core test      # test single package
pnpm --filter @personal-ai/server test
pnpm typecheck                            # type-check all packages
pnpm lint                                 # eslint across all packages
pnpm run test:coverage                    # v8 coverage with thresholds
pnpm run verify                           # typecheck + tests
pnpm run ci                               # verify + coverage thresholds
```

## Tech Stack

- TypeScript strict mode, ES2022 target, NodeNext modules
- Node.js 20+, pnpm workspaces
- better-sqlite3 + FTS5 (no external DB servers)
- Commander.js for CLI, Zod for validation, nanoid for IDs
- Vitest for testing
- Vercel AI SDK (ai, @ai-sdk/react, @ai-sdk/openai, @ai-sdk/google, ai-sdk-ollama) for LLM integration, streaming, and tool-calling
- Ollama (local LLM, default) / OpenAI / Anthropic / Google AI (cloud providers)
- Fastify for API server
- React + Vite + Tailwind CSS + shadcn/ui for web UI
- react-markdown + remark-gfm for chat rendering
- lucide-react for icons

## Configuration

Config comes from two sources, merged with this priority: env vars > config.json > defaults.

**Environment variables** (for dev/CLI): `PAI_DATA_DIR`, `PAI_LLM_PROVIDER`, `PAI_LLM_MODEL`, `PAI_LLM_EMBED_MODEL`, `PAI_LLM_BASE_URL`, `PAI_LLM_API_KEY`, `PAI_PLUGINS`, `PAI_LOG_LEVEL`, `PAI_TELEGRAM_TOKEN`, `PAI_WEB_SEARCH` (set to `false` to disable), `PAI_JWT_SECRET` (optional, auto-generated if not set), `PAI_RESET_PASSWORD` (set to reset owner password on next boot, remove after use).

**Config file** (for server/UI): `~/.personal-ai/config.json`. Editable through the web UI Settings page. Data directory defaults to `~/.personal-ai/data/`.

## Logging

Structured NDJSON logging via `createLogger()` with dual output:

- **Stderr:** Controlled by `PAI_LOG_LEVEL` env var. Levels: `silent` (default), `error`, `warn`, `info`, `debug`. Set `PAI_LOG_LEVEL=debug` to see all internal activity.
- **File:** Always writes to `{dataDir}/pai.log` at `info` level by default (configurable via `LogFileOptions.level`). File logging is automatic — no extra config needed.
- **Rotation:** Size-based, 5MB max with 1 backup (`pai.log.1`). Checked at logger creation.
- **Debugging:** Check `~/.personal-ai/data/pai.log` (or your `PAI_DATA_DIR`) for post-hoc debugging. Logs persist even when stderr is `silent`.

## Git Hooks

Pre-commit and pre-push hooks via Husky:

- **Pre-commit:** Runs `lint-staged` — lints staged `.ts` files with ESLint
- **Pre-push:** Runs `pnpm run ci` — typecheck + tests + coverage thresholds must pass

To skip hooks in emergencies: `git commit --no-verify` / `git push --no-verify`

## Coverage

Coverage via `@vitest/coverage-v8` with thresholds enforced in `vitest.config.ts`. Run `pnpm run test:coverage` to check. HTML report generated in `coverage/`.

## Design Principles

- **KISS** — prefer the simplest solution that works. Avoid premature abstraction.
- **SOLID** — single responsibility per module, depend on interfaces not implementations, keep plugins independently deployable.
- **TDD** — write tests alongside implementation. All new features and bug fixes should include tests. Run `pnpm test` before committing.

## Conventions

- **Tool cards:** When adding a new agent tool (via `createTools()` in any plugin), create a corresponding tool card component in `packages/ui/src/components/tools/` and register it in the dispatcher (`index.tsx`). Follow the state machine pattern: `input-available` (loading), `output-available` (success), `output-error` (failure). Polymorphic cards (like `ToolTaskAction`, `ToolKnowledgeAction`) group related tools via a `toolName` prop.

- **Changelog:** Update `CHANGELOG.md` when making user-facing changes. Follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format with sections: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`. Add entries under `[Unreleased]`; move them to a versioned heading (`[x.y.z] - YYYY-MM-DD`) at release time. Use [Semantic Versioning](https://semver.org/): MAJOR for breaking changes, MINOR for new features, PATCH for bug fixes.

- **pai memory:** After completing significant project changes, run `pnpm pai memory remember "<what changed and why>"` so future sessions have context.

## CLI

After `pnpm build`, use `pnpm pai <command>`. To get `pai` directly on your PATH:

```bash
pnpm -C packages/cli link --global    # one-time setup, then use `pai` directly
```

All examples below use `pai` for brevity — substitute `pnpm pai` if not globally linked.

### Memory — Store and retrieve personal knowledge

```bash
# Store a fact/preference — LLM extracts typed beliefs (factual/preference/procedural/architectural + insight)
# Deduplicates via embeddings, detects contradictions with evidence weighing
pai memory remember "User prefers Vitest over Jest for TypeScript projects"

# Multi-factor semantic search (cosine similarity + importance + recency) with FTS5 fallback
pai memory recall "testing framework preference"

# Get formatted context block with stability tags for LLM injection
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

# Generate meta-beliefs from related belief clusters
pai memory synthesize

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

### Knowledge — Learn from web pages

```bash
# Learn from a URL (fetches, extracts content, chunks, stores with embeddings)
pai knowledge learn "https://react.dev/learn"

# Search the knowledge base
pai knowledge search "React state management"

# List all learned sources
pai knowledge list

# Remove a source and its chunks
pai knowledge forget <id-or-prefix>
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

**Available tools (19):** `remember`, `recall`, `memory-context`, `beliefs`, `forget`, `memory-stats`, `memory-synthesize`, `knowledge-learn`, `knowledge-search`, `knowledge-sources`, `knowledge-forget`, `task-list`, `task-add`, `task-done`, `task-edit`, `task-reopen`, `goal-list`, `goal-add`, `goal-done`

## Web UI

```bash
pnpm start                           # http://127.0.0.1:3141
pnpm stop                            # graceful shutdown via PID file
```

Pages:
- **Chat** — Talk to the Personal Assistant agent. AI SDK streaming with tool cards, markdown rendering, memory-aware responses with web search. Thread sidebar with SQLite persistence. Responsive mobile design. Token usage badge on completed messages.
- **Memory Explorer** — Browse beliefs by type/status, semantic search, see belief details with confidence/stability/importance metrics. Info tooltips on all types. Clear all memory. Empty state with guidance.
- **Knowledge** — Browse learned sources, view chunks full-screen, search knowledge base, learn from URLs, re-learn/crawl sub-pages.
- **Settings** — Edit LLM provider (select dropdown with auto-populated presets for Ollama, OpenAI, Anthropic, Google AI), model, base URL, API key, embed model. Browse filesystem to change data directory.
- **Timeline** — Chronological view of belief events. Empty state with guidance.

Global error handling:
- **ErrorBoundary** — Catches React render errors. Shows friendly message with "Refresh" and "Copy error details" buttons.
- **OfflineBanner** — Pings `/api/stats` every 10s. Shows amber warning when server is unreachable. Auto-dismisses on reconnect.

API endpoints:
```
GET    /api/beliefs          List beliefs (filter: status, type)
GET    /api/beliefs/:id      Belief detail
GET    /api/search?q=...     Semantic search
GET    /api/stats            Memory health stats
POST   /api/remember         Store observation
POST   /api/forget/:id       Soft-delete belief
POST   /api/memory/clear     Clear all active beliefs
GET    /api/agents           List agent plugins
POST   /api/chat             Chat with agent (SSE streaming)
GET    /api/chat/history     Conversation history
DELETE /api/chat/history     Clear conversation
GET    /api/threads          List threads
POST   /api/threads          Create thread
DELETE /api/threads/:id      Delete thread
PATCH  /api/threads/:id      Rename thread
GET    /api/config           Current config (no secrets)
PUT    /api/config           Update config
GET    /api/browse?path=...  Directory browser
```

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

## Dogfooding

This project builds `pai`. If you have Ollama running, use the CLI during development to test the product and preserve project context across sessions:

```bash
pai memory recall "<topic>"       # before starting work
pai memory remember "<decision>"  # after design decisions
pai task list                     # check open work
pai task ai-suggest               # choose what to work on
```

## Telegram Bot

Chat with the Personal Assistant via Telegram. Uses the same agent pipeline as the web UI (memory, tools, web search) but runs standalone.

### Setup

1. Create a bot with [@BotFather](https://t.me/BotFather) on Telegram
2. Set the token: `export PAI_TELEGRAM_TOKEN=<your-token>`
3. Build and start:

```bash
pnpm build
PAI_TELEGRAM_TOKEN=<token> node packages/plugin-telegram/dist/index.js
```

### Commands

- `/start` — Welcome message
- `/help` — List commands
- `/clear` — Clear conversation history
- `/tasks` — Show open tasks
- `/memories` — Show top 10 memories

Or just send any text message to chat with the assistant.

### How it works

- Each Telegram chat gets a unique thread (persisted in `telegram_threads` table)
- Messages go through `runAgentChat()` which uses `generateText` with the same tools as the web UI
- Tool calls show status updates in the chat ("Searching the web...", "Recalling memories...")
- Long responses are automatically split at Telegram's 4096-char limit
- Markdown from the LLM is converted to Telegram-compatible HTML

## Architecture Reference

See `docs/ARCHITECTURE.md` for full design, data model, and future plugin path.

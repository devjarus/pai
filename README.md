# pai — Persistent AI Memory

Local-first memory layer for coding agents. Belief lifecycle, semantic search, contradiction detection, and task management — all in a single SQLite file on your machine.

**What makes pai different:** Beliefs aren't just stored — they're reinforced when repeated, invalidated when contradicted, and decay when stale. Your agent's memory gets smarter over time.

## Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) 9+
- [Ollama](https://ollama.ai/) running locally (or an OpenAI-compatible API)

## Install

```bash
git clone https://github.com/devjarus/pai.git
cd pai
pnpm install
pnpm build
```

## MCP Server (for coding agents)

pai exposes an MCP server for native integration with Claude Code, Cursor, Windsurf, and any MCP-compatible agent.

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

**14 MCP tools:** `remember`, `recall`, `memory-context`, `beliefs`, `forget`, `memory-stats`, `task-list`, `task-add`, `task-done`, `task-edit`, `task-reopen`, `goal-list`, `goal-add`, `goal-done`

## CLI Usage

```bash
# Memory — belief lifecycle with semantic dedup
pai memory remember "I prefer TypeScript over JavaScript"
pai memory recall "language preference"
pai memory beliefs
pai memory context "coding preferences"
pai memory forget <id-or-prefix>
pai memory reflect                    # find duplicates and stale beliefs
pai memory stats                      # memory health summary
pai memory export backup.json         # export for backup
pai memory import backup.json         # import (skips duplicates)

# Tasks
pai task add "Ship v0.1" --priority high --due 2026-03-01
pai task list
pai task done <id-or-prefix>
pai task ai-suggest                   # LLM prioritization with memory context

# Goals
pai goal add "Launch v1"
pai goal list
pai goal done <id-or-prefix>

# All commands support --json for structured output
pai --json memory recall "topic"
```

> All IDs support prefix matching — use first 8 characters instead of the full ID.

## How Memory Works

```
observe → extract fact + insight → embed → compare to existing beliefs
  ├── similarity > 0.85  → reinforce (boost confidence, reset decay)
  ├── similarity 0.7-0.85 → LLM contradiction check → invalidate or create new
  └── similarity < 0.7   → create new belief with embedding
```

Beliefs decay with a 30-day half-life. Stale beliefs fade; reinforced beliefs stay strong. The `reflect` command finds duplicates and `prune` removes low-confidence beliefs.

## Configuration

Set via environment variables or `.env` file.

| Variable | Default | Description |
|----------|---------|-------------|
| `PAI_DATA_DIR` | `~/.personal-ai` | SQLite database location |
| `PAI_LLM_PROVIDER` | `ollama` | `ollama` or `openai` |
| `PAI_LLM_MODEL` | `llama3.2` | Chat model name |
| `PAI_LLM_EMBED_MODEL` | `nomic-embed-text` | Embedding model name |
| `PAI_LLM_BASE_URL` | `http://127.0.0.1:11434` | Provider URL |
| `PAI_LLM_API_KEY` | | API key (required for Ollama Cloud and OpenAI) |
| `PAI_LOG_LEVEL` | `silent` | Stderr log level: `silent`, `error`, `warn`, `info`, `debug` |
| `PAI_PLUGINS` | `memory,tasks` | Comma-separated active plugins |

## Architecture

pnpm monorepo with 4 packages: `core`, `cli`, `plugin-memory`, `plugin-tasks`. SQLite + FTS5 for storage, embeddings for semantic search, Vercel AI SDK for LLM integration.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full design.

## Development

```bash
pnpm test                # run all tests (vitest)
pnpm test:watch          # watch mode
pnpm test:coverage       # coverage report with thresholds
pnpm typecheck           # type-check all packages
pnpm lint                # eslint
pnpm run ci              # typecheck + tests + coverage
```

**Git hooks** (via Husky):
- `pre-commit` — lint-staged runs ESLint on staged `.ts` files
- `pre-push` — runs `pnpm run ci` (typecheck + tests + coverage)

## License

[MIT](LICENSE)

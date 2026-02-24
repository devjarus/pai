# pai — Personal AI with Persistent Memory

Personal AI agent platform. Chat via web UI or Telegram, learn from web pages, manage tasks, search the web, and extend with plugins — all running locally on your machine.

**What makes pai different:** A full agent system with persistent memory, knowledge base, and multi-channel access. Memory evolves over time — beliefs are reinforced, contradicted, decayed, and synthesized. Multi-person aware.

## Features

- **Web UI** — streaming chat with tool cards, memory explorer, knowledge browser, settings, timeline
- **Telegram bot** — same agent pipeline, multi-user aware (owner vs. others)
- **Knowledge base** — learn from web pages, FTS5 prefilter + cosine re-ranking
- **Persistent memory** — beliefs with lifecycle (reinforce, contradict, decay, synthesize), semantic search
- **Web search** — Brave Search for current information, no API key required
- **Task management** — tasks + goals with AI prioritization
- **MCP server** — 19 tools for Claude Code, Cursor, Windsurf integration
- **CLI** — `pai` commands with `--json` output and prefix-matched IDs
- **Plugin architecture** — extend with custom agents, tools, and commands

## Quick Start — Docker (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/devjarus/personal-ai/main/install.sh | bash
```

The installer checks for Docker, asks whether you want local (Ollama) or cloud (OpenAI/Anthropic/Google) LLM, and starts everything. Open **http://localhost:3141**.

> **Full setup guide:** See [docs/SETUP.md](docs/SETUP.md) for detailed instructions — Docker, from source, Ollama Cloud, OpenAI, Anthropic, Google AI, Telegram bot, and usage walkthrough.

Or run manually:

```bash
# With local Ollama sidecar
docker compose --profile local up -d

# Cloud only (no Ollama) — configure provider in Settings UI
docker compose up -d

# Or pass provider directly
PAI_LLM_PROVIDER=openai PAI_LLM_API_KEY=sk-... docker compose up -d
```

## Quick Start — From Source

**Prerequisites:** Node.js 20+, pnpm 9+, [Ollama](https://ollama.ai/) or a cloud API key

```bash
git clone https://github.com/devjarus/pai.git
cd pai
pnpm install
pnpm build

pnpm start                # start server → http://127.0.0.1:3141
pnpm stop                 # stop server
```

## Web UI

Open `http://127.0.0.1:3141` after starting the server:

| Page | Description |
|------|-------------|
| **Chat** | Streaming chat with tool cards (memory, search, tasks). Thread sidebar. Responsive mobile. |
| **Memory** | Browse beliefs by type/status, semantic search, detail view with confidence/stability. |
| **Knowledge** | Browse learned sources, view chunks, search knowledge base, learn from URLs. |
| **Settings** | LLM provider, model, API key, data directory, Telegram bot config. |
| **Timeline** | Chronological episodes and belief changes. |

## Telegram Bot

Chat with the same assistant via Telegram — multi-user aware.

```bash
# Set token from @BotFather
export PAI_TELEGRAM_TOKEN=<your-token>

# Option 1: standalone
node packages/plugin-telegram/dist/index.js

# Option 2: via server (enable Telegram in Settings UI, then pnpm start)
```

Commands: `/start`, `/help`, `/clear`, `/tasks`, `/memories` — or just send any message.

The bot knows who's talking (owner vs. family/friends) and attributes memories to the correct person.

## MCP Server

Native integration with Claude Code, Cursor, Windsurf, and any MCP-compatible agent.

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

**19 tools:** `remember`, `recall`, `memory-context`, `beliefs`, `forget`, `memory-stats`, `memory-synthesize`, `task-list`, `task-add`, `task-done`, `task-edit`, `task-reopen`, `goal-list`, `goal-add`, `goal-done`, `knowledge-learn`, `knowledge-search`, `knowledge-sources`, `knowledge-forget`

## CLI

Use `pnpm pai <command>` or link globally for direct access:

```bash
pnpm -C packages/cli link --global    # one-time setup, then use `pai` directly
```

```bash
# Memory
pai memory remember "Alex prefers Zustand over Redux"
pai memory recall "state management preference"
pai memory beliefs
pai memory forget <id-or-prefix>
pai memory reflect                    # find duplicates + stale beliefs
pai memory synthesize                 # generate meta-beliefs from clusters
pai memory stats
pai memory export backup.json
pai memory import backup.json

# Tasks
pai task add "Ship v0.1" --priority high --due 2026-03-01
pai task list
pai task done <id-or-prefix>
pai task ai-suggest                   # LLM prioritization with memory context

# Goals
pai goal add "Launch v1"
pai goal list
pai goal done <id-or-prefix>

# Knowledge
pai knowledge learn "https://react.dev/learn"
pai knowledge search "React state management"
pai knowledge list
pai knowledge forget <id-or-prefix>

# All commands support --json and prefix-matched IDs
pai --json memory recall "topic"
```

## How Memory Works

```
User says something
    │
    ├── afterResponse: LLM extracts facts → validates → remember()
    │
    └── remember():
          create episode → embed
          extract belief (type + importance + subject) → embed
            │
            ├── similarity > 0.85  → reinforce (boost confidence)
            ├── similarity 0.7-0.85 → contradiction check:
            │     weak evidence → invalidate old, create new
            │     strong evidence (≥3 episodes) → weaken old, both coexist
            └── similarity < 0.7   → create new + link to neighbors

Every 5 turns:
    → LLM summarizes conversation → searchable episode

Recall (unified retrieval):
    → single embedding call
    → beliefs: semantic search (50% cosine + 20% importance + 10% recency)
    → knowledge: FTS5 prefilter → cosine re-rank
    → graph traversal on belief_links
    → FTS5 fallback for both
```

Beliefs decay with a 30-day half-life (adjustable via stability). Frequently accessed beliefs decay slower (SM-2 inspired). The `reflect` command finds duplicates and `prune` removes low-confidence beliefs.

## Architecture

```
packages/
  core/               Config, Storage, LLM Client, Logger, Memory, Knowledge, Threads
  cli/                Commander.js CLI + MCP server (19 tools)
  plugin-assistant/   Personal Assistant agent (tools, system prompt, afterResponse)
  plugin-curator/     Memory Curator agent (health analysis, dedup, contradiction resolution)
  plugin-tasks/       Tasks + Goals with AI prioritization
  plugin-telegram/    Telegram bot (grammY, standalone or server-managed)
  server/             Fastify API (REST + SSE streaming + static UI)
  ui/                 React + Vite + Tailwind + shadcn/ui
```

Data stored at `~/.personal-ai/data/`. SQLite with WAL mode for the default storage backend.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for C4 diagrams, dataflows, and full data model.

## Configuration

Environment variables or `~/.personal-ai/config.json` (editable via Settings UI).

| Variable | Default | Description |
|----------|---------|-------------|
| `PAI_DATA_DIR` | `~/.personal-ai/data` | Database location |
| `PAI_LLM_PROVIDER` | `ollama` | `ollama`, `openai`, `anthropic`, or `google` |
| `PAI_LLM_MODEL` | `llama3.2` | Chat model |
| `PAI_LLM_EMBED_MODEL` | `nomic-embed-text` | Embedding model |
| `PAI_LLM_BASE_URL` | `http://127.0.0.1:11434` | Provider URL |
| `PAI_LLM_API_KEY` | | API key (Ollama Cloud / OpenAI) |
| `PAI_TELEGRAM_TOKEN` | | Telegram bot token from @BotFather |
| `PAI_LOG_LEVEL` | `silent` | `silent`, `error`, `warn`, `info`, `debug` |

## Development

```bash
pnpm test                # 331 tests (vitest)
pnpm test:watch          # watch mode
pnpm test:coverage       # v8 coverage with thresholds
pnpm typecheck           # type-check all packages
pnpm lint                # eslint
pnpm run ci              # typecheck + tests + coverage
```

**Git hooks** (Husky): pre-commit runs lint-staged, pre-push runs full CI.

## Tech Stack

TypeScript strict · Node.js 20+ · pnpm · better-sqlite3 + FTS5 · Vercel AI SDK (@ai-sdk/openai, @ai-sdk/google, ai-sdk-ollama) · Fastify · React + Vite + Tailwind + shadcn/ui · grammY · Commander.js · Vitest · Zod · nanoid · Docker

## License

[MIT](LICENSE)

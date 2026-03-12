# pai — Self-Hosted AI for Recurring Decisions

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/sFecIN?referralCode=g0LiHY&utm_medium=integration&utm_source=template&utm_campaign=generic)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/devjarus/pai)

Self-hosted AI for recurring decisions. Start with Ask, let `pai` keep track of what matters in the background, and get recommendation-first briefs shaped by your preferences, constraints, and corrections.

**What makes pai different:** It is organized around Programs and Briefs instead of broad assistant surface area. Memory evolves over time, recurring questions stay in context, and the next brief improves when you correct the system.

## Features

- **Programs** — recurring decisions or commitments with cadence, preferences, constraints, and follow-through context
- **Brief-first home** — recommendation, what changed, evidence, memory assumptions, and next actions delivered in one place
- **Persistent memory** — beliefs with lifecycle (reinforce, contradict, decay, synthesize), semantic search, and correction-aware context reuse
- **Background research and analysis** — lighter research or deeper analysis runs feeding the same brief workflow
- **Companion surfaces** — web UI as the control center, with Telegram, CLI, and MCP as supporting delivery and power-user surfaces
- **Supporting tools** — web search, knowledge ingestion, sandbox execution, and task tracking remain available without becoming the main product story

## Quick Start

```bash
# Download and review, then run:
curl -fsSL https://raw.githubusercontent.com/devjarus/pai/main/install.sh -o install.sh
bash install.sh
```

The installer asks Docker or from-source, then local (Ollama) or cloud (OpenAI/Anthropic/Google) LLM, and starts everything. Open **http://localhost:3141**.

> **Full setup guide:** See [docs/SETUP.md](docs/SETUP.md) for detailed instructions — Docker, from source, Ollama Cloud, OpenAI, Anthropic, Google AI, Telegram bot, and usage walkthrough.

Or run manually:

```bash
# With local Ollama sidecar
docker compose --profile local up -d

# Cloud only (no Ollama) — configure provider in Settings UI
docker compose up -d

# With SearXNG web search + code sandbox
docker compose --profile sandbox up -d

# With everything (Ollama + sandbox)
docker compose --profile local --profile sandbox up -d

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
| **Home** (`/`) | Brief feed for daily and research updates, with recommendation-first detail views and refresh. |
| **Programs** | Recurring decisions or commitments that `pai` keeps watching over time. |
| **Ask** | Chat control surface for one-off questions, follow-ups, and creating/refining ongoing work. |
| **Memory** | Browse remembered preferences, constraints, and other beliefs that shape future briefs. |
| **Settings** | LLM provider, model, API key, data directory, Telegram bot config, and advanced controls. |

Supporting routes such as Tasks, Knowledge, Jobs, Timeline, and Schedules remain available, but they are secondary surfaces rather than the primary product loop.

## Telegram Bot

Chat with the same assistant via Telegram — multi-user aware.

```bash
# Set token from @BotFather
export PAI_TELEGRAM_TOKEN=<your-token>

# Option 1: standalone
node packages/plugin-telegram/dist/index.js

# Option 2: via server (enable Telegram in Settings UI, then pnpm start)
```

Commands: `/start`, `/help`, `/clear`, `/tasks`, `/memories`, `/jobs`, `/research <query>` — or just send any message.

The bot knows who's talking (owner vs. family/friends) and attributes memories to the correct person.
Research and analysis reports stay inside Telegram: the bot sends a protected preview, inline visuals, and an attached HTML report document instead of publishing a public article link.

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
  plugin-research/    Background research agent (domain-specific: flight, stock, crypto, news)
  plugin-swarm/       Sub-agent swarm (parallel task decomposition, shared blackboard)
  plugin-schedules/   Scheduled recurring jobs
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
| `PAI_LLM_PROVIDER` | `ollama` | `ollama`, `openai`, `anthropic`, `google`, or `cerebras` |
| `PAI_LLM_MODEL` | `llama3.2` | Chat model |
| `PAI_LLM_EMBED_MODEL` | `nomic-embed-text` | Embedding model |
| `PAI_LLM_BASE_URL` | `http://127.0.0.1:11434` | Provider URL |
| `PAI_LLM_API_KEY` | | API key (required for cloud providers) |
| `PAI_TELEGRAM_TOKEN` | | Telegram bot token from @BotFather |
| `PAI_LOG_LEVEL` | `silent` | `silent`, `error`, `warn`, `info`, `debug` |
| `PAI_JWT_SECRET` | _(auto-generated)_ | Custom JWT signing secret |
| `PAI_RESET_PASSWORD` | | Set to reset owner password on next boot (remove after use) |
| `PAI_SEARCH_URL` | _(auto-detected in Docker)_ | SearXNG base URL |
| `PAI_SANDBOX_URL` | | Code execution sandbox URL (opt-in) |
| `PAI_TIMEZONE` | | IANA timezone (e.g., `Asia/Kolkata`) |
| `PAI_CONTEXT_WINDOW` | | Override context window size for unrecognized models |

## Development

```bash
pnpm test                # 712 tests (vitest)
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

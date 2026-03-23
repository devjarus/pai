# pai — Self-Hosted AI for Recurring Decisions

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/sFecIN?referralCode=g0LiHY&utm_medium=integration&utm_source=template&utm_campaign=generic)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/devjarus/pai)

Your second brain that watches things for you. Start with Ask, set up Watches for things you care about, and get recommendation-first Digests shaped by your preferences, constraints, and corrections.

**What makes pai different:** It remembers what matters, researches in the background, and delivers personalized Digests that improve every time you correct them. Knowledge compounds — research findings feed your Library, corrections make future Digests smarter.

## Features

- **Watches** — recurring monitoring with templates (price, news, competitor, availability), depth levels, and delta-focused research that builds on previous findings
- **Digests** — recommendation-first updates with what changed, evidence, memory assumptions, and suggested to-dos. Rate them, correct them, and the next one improves
- **Library** — unified knowledge layer combining memories, documents, and research findings with cross-source search
- **Persistent memory** — beliefs with lifecycle (reinforce, contradict, decay, synthesize), semantic search, and correction-aware context reuse
- **Home dashboard** — latest digest, active watches, open to-dos, and library stats at a glance
- **Companion surfaces** — web UI, Telegram, CLI, and MCP for Claude Code / Cursor integration

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

For development or contributor workflows:

```bash
pnpm verify               # repo-wide typecheck + tests + coverage
pnpm harness:regressions  # validate coding-agent harness docs, checklists, templates, script wiring
pnpm harness:core-loop    # validate Ask → Watch → Digest → Correction behavior
```

## Web UI

Open `http://127.0.0.1:3141` after starting the server:

| Page | Description |
|------|-------------|
| **Home** (`/`) | Dashboard with latest digest, active watches, open to-dos, library stats, and quick ask. |
| **Digests** (`/digests`) | Feed of daily and research digests with ratings, inline corrections, and suggested to-dos. |
| **Watches** (`/watches`) | Recurring monitors with templates, depth levels, linked findings and digests. |
| **Chat** (`/ask`) | Chat for questions, follow-ups, and creating watches. |
| **Library** (`/library`) | Unified view of memories, documents, and research findings with cross-source search. |
| **Tasks** (`/tasks`) | To-dos linked to watches and digests. |
| **Settings** | LLM provider, model, API key, Telegram config, and diagnostics. |

## Telegram Bot

Chat with the same assistant via Telegram — multi-user aware.

```bash
# Set token from @BotFather
export PAI_TELEGRAM_TOKEN=<your-token>

# Option 1: standalone
node packages/plugin-telegram/dist/index.js

# Option 2: via server (enable Telegram in Settings UI, then pnpm start)
```

Commands: `/start`, `/help`, `/clear`, `/tasks`, `/digests`, `/watches`, `/library`, `/todo`, `/research <query>` — or just send any message.

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

**Tools:** `library-remember`, `library-search`, `library-context`, `library-memories`, `library-forget`, `library-stats`, `library-synthesize`, `library-learn-url`, `library-documents`, `library-forget-document`, `tasks-list`, `tasks-add`, `tasks-done`, `tasks-edit`, `tasks-reopen`, `goals-list`, `goals-add`, `goals-done` (old tool names also work)

## CLI

Use `pnpm pai <command>` or link globally for direct access:

```bash
pnpm -C packages/cli link --global    # one-time setup, then use `pai` directly
```

```bash
# Library (memories, documents, search)
pai library remember "Alex prefers Zustand over Redux"
pai library search "state management preference"
pai library memories
pai library forget <id-or-prefix>
pai library stats
pai library learn "https://react.dev/learn"
pai library documents

# Tasks
pai task add "Ship v0.1" --priority high --due 2026-03-01
pai task list
pai task done <id-or-prefix>

# Goals
pai goal add "Launch v1"
pai goal list
pai goal done <id-or-prefix>

# All commands support --json and prefix-matched IDs
pai --json library search "topic"
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
  core/               Shared foundation: LLM client, storage, memory, knowledge, telemetry, agent harness
  library/            Library domain: unified search, research findings, ingestion pipelines
  watches/            Watches domain: templates, depth levels, delta research
  server/             Fastify API (REST + SSE + digest ratings + background workers)
  ui/                 React + Vite + Tailwind + shadcn/ui (Home, Library, Watches, Digests, Tasks)
  cli/                Commander.js CLI + MCP server
  plugin-assistant/   Chat agent with tools and memory recall
  plugin-research/    Background research with agent harness
  plugin-swarm/       Parallel sub-agent coordination
  plugin-schedules/   Scheduled recurring jobs
  plugin-tasks/       To-dos + Goals
  plugin-curator/     Memory health (dedup, contradiction resolution)
  plugin-telegram/    Telegram bot (grammY)
```

Data stored at `~/.personal-ai/data/`. SQLite with WAL mode for the default storage backend.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for C4 diagrams, dataflows, and full data model.

For the architecture-block split and contributor workflow:

- [docs/architecture/overview.md](docs/architecture/overview.md)
- [docs/architecture/core-platform.md](docs/architecture/core-platform.md)
- [docs/architecture/agent-plane.md](docs/architecture/agent-plane.md)
- [docs/architecture/dependency-rules.md](docs/architecture/dependency-rules.md)
- [harness/README.md](harness/README.md)

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
pnpm test                # 1028+ tests (vitest)
pnpm test:watch          # watch mode
pnpm test:coverage       # v8 coverage with thresholds
pnpm typecheck           # type-check all packages
pnpm lint                # eslint
pnpm harness:regressions # coding-agent harness assets
pnpm harness:core-loop   # executable product-loop harness
pnpm run ci              # typecheck + tests + coverage
```

**Git hooks** (Husky): pre-commit runs lint-staged, pre-push runs full CI.

Non-trivial changes should follow the harness workflow in [harness/README.md](harness/README.md): identify the owning architecture block, pick the matching checklist, and capture a task contract plus evidence pack.

## Tech Stack

TypeScript strict · Node.js 20+ · pnpm · better-sqlite3 + FTS5 · Vercel AI SDK (@ai-sdk/openai, @ai-sdk/google, ai-sdk-ollama) · Fastify · React + Vite + Tailwind + shadcn/ui · grammY · Commander.js · Vitest · Zod · nanoid · Docker

## License

[MIT](LICENSE)

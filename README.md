# pai — Self-Hosted AI for Recurring Decisions

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/sFecIN?referralCode=g0LiHY&utm_medium=integration&utm_source=template&utm_campaign=generic)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/devjarus/pai)

Your second brain that watches things for you. Start with Ask, set up Watches for things you care about, and get recommendation-first Digests shaped by your preferences, constraints, and corrections.

**What makes pai different:** It remembers what matters, researches in the background, and delivers personalized Digests that improve every time you correct them. Knowledge compounds — research findings feed your Library, corrections make future Digests smarter.

## Features

- **Watches** — recurring monitoring with templates (price, news, competitor, availability), depth levels, and delta-focused research
- **Digests** — recommendation-first updates with evidence, memory assumptions, and suggested to-dos. Rate and correct them.
- **Library** — unified knowledge layer: memories, documents, and research findings with cross-source search
- **Persistent memory** — beliefs with lifecycle (reinforce, contradict, decay, synthesize), semantic search, and correction-aware context
- **Image understanding** — upload images in chat for multimodal analysis
- **Activity dashboard** — monitor background jobs with real-time progress and failure notifications
- **Companion surfaces** — web UI, Telegram, CLI, and MCP for Claude Code / Cursor integration
- **Linear integration** — conversational issue intake and automatic recurring-error deduplication
- **Resilient background jobs** — rate-limited retries with exponential backoff, failure notifications

## Quick Start

```bash
curl -fsSL https://raw.githubusercontent.com/devjarus/pai/main/install.sh -o install.sh
bash install.sh
```

The installer asks Docker or from-source, then local (Ollama) or cloud (OpenAI/Anthropic/Google) LLM, and starts everything. Open **http://localhost:3141**.

Or run manually with Docker:

```bash
docker compose up -d                              # cloud provider (configure in Settings UI)
docker compose --profile local up -d              # with local Ollama
docker compose --profile local --profile sandbox up -d  # everything
```

Or from source:

```bash
git clone https://github.com/devjarus/pai.git && cd pai
pnpm install && pnpm build && pnpm start          # → http://127.0.0.1:3141
```

> **Full setup guide:** [docs/SETUP.md](docs/SETUP.md) — Docker, Railway, LLM providers, Telegram bot, CLI, MCP, troubleshooting.

## Architecture

```
packages/
  core/               Shared foundation: LLM, storage, memory, knowledge, telemetry, agent harness
  library/            Library domain: unified search, findings, ingestion pipelines
  watches/            Watches domain: templates, depth levels, delta research
  plugin-schedules/   Recurring scheduled jobs (owns Program/ScheduledJob types)
  server/             Fastify API (REST + SSE + auth + background workers)
  ui/                 React + Vite + Tailwind + shadcn/ui
  cli/                Commander.js CLI + MCP server
  plugin-assistant/   Chat agent with tools and memory recall
  plugin-research/    Background research with agent harness
  plugin-swarm/       Parallel sub-agent coordination
  plugin-tasks/       To-dos + Goals
  plugin-curator/     Memory health (dedup, contradiction resolution)
  plugin-telegram/    Telegram bot (grammY)
```

SQLite with WAL mode. Data stored at `~/.personal-ai/data/`.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for C4 diagrams, dataflows, data model, and full API reference.

## Development

```bash
pnpm verify               # typecheck + tests + coverage
pnpm harness:core-loop    # Ask → Watch → Digest → Correction scenarios
pnpm e2e                  # browser smoke tests
```

See [AGENTS.md](AGENTS.md) for the contributor workflow, architecture blocks, and coding patterns.

## Tech Stack

TypeScript strict · Node.js 20+ · pnpm · better-sqlite3 + FTS5 · Vercel AI SDK · Fastify · React + Vite + Tailwind + shadcn/ui · grammY · Commander.js · Vitest · Zod · Docker

## License

[MIT](LICENSE)

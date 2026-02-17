# pai — Personal AI

Local-first personal AI with plugin architecture. Memory, tasks, and LLM-powered prioritization — all stored in a single SQLite file on your machine.

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

## Usage

```bash
# Check LLM connectivity
pai health

# Memory — remembers facts + insights with semantic dedup
pai memory remember "I prefer TypeScript over JavaScript"
pai memory recall "language preference"
pai memory beliefs
pai memory episodes
pai memory history <beliefId>
pai memory context "coding preferences"

# Tasks
pai task add "Ship v0.1" --priority high --due 2026-03-01
pai task list --status open
pai task list --status done
pai task done <id-or-prefix>

# Goals
pai goal add "Launch personal AI"
pai goal list

# AI prioritization (uses LLM + memory context)
pai task ai-suggest
```

> Run `pai --help` for all available commands.

## Configuration

Set via environment variables or `.env` file. See `.env.example` for defaults.

| Variable | Default | Description |
|----------|---------|-------------|
| `PAI_DATA_DIR` | `~/.personal-ai` | SQLite database location |
| `PAI_LLM_PROVIDER` | `ollama` | `ollama` or `openai` |
| `PAI_LLM_MODEL` | `llama3.2` | Chat model name |
| `PAI_LLM_EMBED_MODEL` | `nomic-embed-text` | Embedding model name |
| `PAI_LLM_BASE_URL` | `http://127.0.0.1:11434` | Provider URL (use `https://api.ollama.com` for Ollama Cloud) |
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
pnpm run verify          # typecheck + tests
pnpm run ci              # verify + coverage
```

### ContinuOS runtime loop (optional)

Use `continuosctl` to run a tracked development cycle and collect reliability evidence.
This flow uses the default data directory resolution from `continuosctl`.

```bash
# 1) Check model/provider health
pnpm run runtime:health

# 2) Start a run (capture the id)
RUN_ID=$(continuosctl run start \
  --goal "Improve personal-ai reliability" \
  --scope product \
  --risk low \
  --success "pnpm run verify passes" \
  --json | jq -r '.id')

# 3) Execute project verification as a run step
SHELL_ACTIONS_ENABLED=true SHELL_ACTIONS_ALLOWLIST=pnpm \
continuosctl run step \
  --run-id "$RUN_ID" \
  --action shell \
  --command pnpm \
  --arg run --arg verify \
  --cwd "$PWD" \
  --json

# 4) Complete the run and inspect insights
continuosctl run step --run-id "$RUN_ID" --action complete --outcome success --json
pnpm run runtime:suggestions
pnpm run runtime:trends
```

`run step --action shell` is disabled by default. Set both `SHELL_ACTIONS_ENABLED=true` and `SHELL_ACTIONS_ALLOWLIST=pnpm` (or a stricter allowlist you control) when executing shell actions.

**Git hooks** (via Husky):
- `pre-commit` — lint-staged runs ESLint on staged `.ts` files
- `pre-push` — runs `pnpm run verify` (typecheck + tests)

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Write tests first (TDD — tests live in `packages/*/test/`)
4. Make your changes
5. Ensure `pnpm run ci` passes
6. Commit and push
7. Open a Pull Request

## License

[MIT](LICENSE)

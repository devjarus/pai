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

# Memory
pai memory remember "I prefer TypeScript over JavaScript"
pai memory recall "language preference"
pai memory beliefs
pai memory episodes

# Tasks
pai task add "Ship v0.1" --priority high --due 2026-03-01
pai task list
pai task done <id>

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
| `PAI_LLM_MODEL` | `llama3.2` | Model name |
| `PAI_LLM_BASE_URL` | `http://127.0.0.1:11434` | Provider URL |
| `PAI_LLM_API_KEY` | | API key (OpenAI only) |
| `PAI_PLUGINS` | `memory,tasks` | Comma-separated active plugins |

## Architecture

pnpm monorepo with 4 packages:

```
packages/
  core/           Config, Storage (SQLite + migrations), LLM Client (Vercel AI SDK)
  cli/            Commander.js entrypoint, plugin loading
  plugin-memory/  Episodes + Beliefs with FTS5 search, LLM belief extraction
  plugin-tasks/   Tasks + Goals with AI-powered prioritization
```

- **Database**: Single SQLite file with WAL mode. Each plugin owns its tables.
- **LLM**: Vercel AI SDK (`ai` + `@ai-sdk/openai` + `ai-sdk-ollama`) with token usage tracking.
- **Plugins**: Implement `Plugin` interface — provide `name`, `version`, `migrations[]`, and `commands(ctx)`.

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

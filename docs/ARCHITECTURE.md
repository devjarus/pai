# Architecture

## Design Principles

1. **Start minimal.** Two plugins, not twenty features.
2. **No restarts.** Extend what works, don't rewrite.
3. **One stack.** TypeScript only. No Python, no Docker, no separate processes.
4. **One database.** SQLite + FTS5. No Postgres, Redis, or vector DBs.
5. **One LLM client.** Ollama-first, OpenAI fallback. Shared across plugins.
6. **CLI-first.** Web UI is a future phase.
7. **Every plugin is optional.** Core + any single plugin = working system.

## Package Structure

```
packages/
  core/             Config, Storage, LLM Client, Plugin interface
  cli/              Commander.js entrypoint, plugin loading
  plugin-memory/    Episodes + Beliefs with FTS5 search
  plugin-tasks/     Tasks + Goals with AI prioritization
```

## Core

**Config** — reads from env vars or `.env`. Keys: `dataDir`, LLM provider/model/baseUrl/apiKey, active plugins list.

**Storage** — single SQLite database at `{dataDir}/personal-ai.db`. WAL mode, foreign keys enabled. Each plugin owns its tables via migrations tracked in `_migrations`.

**LLM Client** — Vercel AI SDK (`ai` + `@ai-sdk/openai` + `ai-sdk-ollama`). Returns `ChatResult` with text and token usage. `health()` checks provider availability.

**Logger** — structured NDJSON to stderr via `createLogger()`. Levels: `silent` (default), `error`, `warn`, `info`, `debug`. Controlled by `PAI_LOG_LEVEL` env var. Zero dependencies.

**Plugin Interface:**
```typescript
interface Plugin {
  name: string
  version: string
  migrations: Migration[]
  commands(ctx: PluginContext): Command[]
}

interface PluginContext {
  config: Config
  storage: Storage
  llm: LLMClient
  logger: Logger
}
```

No lifecycle hooks, no event system, no middleware. Plugins get context, return commands.

## Memory Plugin

- **Episodes** — append-only observations/actions/outcomes
- **Beliefs** — durable knowledge with confidence scores, linked to episode evidence
- **FTS5** full-text search over beliefs with sanitized queries (handles operators and special chars)
- **Confidence Decay** — 30-day half-life. Beliefs lose confidence over time if not reinforced. Computed at read time, no background jobs.
- **Contradiction Detection** — on `remember`, LLM checks if new belief contradicts existing beliefs. Contradicted beliefs are invalidated, replaced by the new one.
- **Change Tracking** — `belief_changes` table logs every create, reinforce, contradict, and fade event with timestamps and episode links.
- **Context Packing** — `getMemoryContext(query)` assembles relevant beliefs + recent episodes into a formatted string for LLM context injection. Exported for cross-plugin use.
- **LLM integration** — on `remember`, LLM extracts a belief statement. Matches against existing beliefs — reinforces if consistent, invalidates if contradicted, creates new if novel.

## Tasks Plugin

- **Tasks** — things to do with status, priority, optional due date and goal
- **Goals** — larger objectives that tasks roll up to
- **LLM integration** — `ai-suggest` feeds open tasks + recent memory to LLM for prioritization

## Data Model

```sql
-- Memory
episodes        (id, timestamp, context, action, outcome, tags_json)
beliefs         (id, statement, confidence, status, created_at, updated_at)
belief_episodes (belief_id, episode_id)
belief_changes  (id, belief_id, change_type, detail, episode_id, created_at)
beliefs_fts     (FTS5 virtual table on beliefs.statement)

-- Tasks
tasks       (id, title, description, status, priority, goal_id, due_date, created_at, completed_at)
goals       (id, title, description, status, created_at)
```

## Tech Stack

| Layer | Choice |
|-------|--------|
| Language | TypeScript (strict mode, ES2022) |
| Runtime | Node.js 20+ |
| Package manager | pnpm workspaces |
| Database | better-sqlite3 + FTS5 |
| LLM SDK | Vercel AI SDK (ai, @ai-sdk/openai, ai-sdk-ollama) |
| CLI | Commander.js |
| Testing | Vitest with v8 coverage |
| Validation | Zod |
| IDs | nanoid |

## Future Plugin Path

Add plugins without touching core:

- `plugin-research/` — crawl, index, RAG
- `plugin-finance/` — accounts, transactions
- `plugin-web-ui/` — serve a dashboard

## What We Explicitly Don't Build (Yet)

Web UI, Python, Docker, vector embeddings, MCP server, research/crawling, finance, health/habits, multi-agent orchestration, real-time streaming. The plugin architecture supports all of these as future additions.

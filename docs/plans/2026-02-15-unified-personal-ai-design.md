# Unified Personal AI — Design

## Problem

44 workspace projects all attempt the same thing: a local-first AI system that can research, remember, learn, and act. Each iteration restarts from scratch, picks a different framework, re-implements the same primitives, and grows unwieldy. None shipped.

## Design Principles (Learned from Failures)

1. **Start minimal.** Two plugins, not twenty features.
2. **No restarts.** Extend what works, don't rewrite.
3. **One stack.** TypeScript only. No Python, no Docker, no separate processes.
4. **One database.** SQLite + FTS5. No Postgres, Redis, ChromaDB, or Qdrant.
5. **One LLM client.** Ollama-first, OpenAI fallback. Shared across plugins.
6. **CLI-first.** Web UI is a future phase.
7. **Every plugin is optional.** Core + any single plugin = working system.

## Architecture

```
personal-ai/
  package.json              # pnpm workspaces
  tsconfig.base.json        # shared TypeScript config
  packages/
    core/                   # ~300 lines: config, storage, LLM client, plugin interface
    cli/                    # CLI entrypoint, loads plugins, wires commands
    plugin-memory/          # episodes + beliefs (from agent-memory-box patterns)
    plugin-tasks/           # tasks + goals (from pos-codex domain models)
```

### Core Package (~300 lines total)

**Config** (~50 lines)
- Reads from env or `.env` file
- Keys: `dataDir` (default `~/.personal-ai`), LLM provider/model/baseUrl/apiKey/fallbackMode, active plugins list

**Storage** (~100 lines)
- Single SQLite database at `{dataDir}/personal-ai.db`
- Each plugin owns its own tables via migrations
- Provides `query<T>()`, `run()`, and `migrate()` methods

**LLM Client** (~100 lines)
- Ollama-first with OpenAI fallback (same pattern as continuos `model/service.ts`)
- Two methods: `chat()` for generation, `embed()` for future vector search
- `health()` to check provider availability

**Plugin Interface** (~30 lines)
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
}
```

No lifecycle hooks, no event system, no middleware. Plugins get context, return commands.

### Memory Plugin

**Learned from:** agent-memory-box (belief evolution, confidence scoring, episode-based recording)

**Simplified to:**
- Episodes — append-only observations/actions/outcomes
- Beliefs — durable knowledge with confidence scores, linked to episode evidence
- FTS5 full-text search (no vector embeddings in v1)

**Tables:**
```sql
episodes (id TEXT PK, timestamp TEXT, context TEXT, action TEXT, outcome TEXT, tags_json TEXT)
beliefs (id TEXT PK, statement TEXT, confidence REAL, status TEXT, created_at TEXT, updated_at TEXT)
belief_episodes (belief_id TEXT, episode_id TEXT)
```

**CLI commands:**
```
pai memory remember <text>          # create episode, auto-extract belief via LLM
pai memory recall <query>           # FTS5 search over beliefs
pai memory beliefs                  # list active beliefs with confidence
pai memory episodes [--since <dur>] # list recent episodes
```

**LLM integration:** On `remember`, LLM extracts a belief statement. Matches against existing beliefs — reinforces if consistent, flags if contradictory.

### Tasks Plugin

**Learned from:** pos-codex (clean domain models with tasks/goals/milestones)

**Simplified to:**
- Tasks — things to do with status, priority, optional due date
- Goals — larger objectives that tasks roll up to
- No milestones, habits, health, or calendar (future plugins)

**Tables:**
```sql
tasks (id TEXT PK, title TEXT, description TEXT, status TEXT, priority TEXT, goal_id TEXT, due_date TEXT, created_at TEXT, completed_at TEXT)
goals (id TEXT PK, title TEXT, description TEXT, status TEXT, created_at TEXT)
```

**CLI commands:**
```
pai task add <title>                # add task
pai task list                       # list open tasks
pai task done <id>                  # mark complete
pai goal add <title>                # add goal
pai goal list                       # list goals with task progress
pai task ai-suggest                 # LLM suggests priorities from tasks + memory
```

**LLM integration:** `ai-suggest` feeds open tasks + recent memory episodes to LLM, asks "what should I work on next and why?" Simple prompt, no agents or chains.

## Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Language | TypeScript (strict) | Same as continuos, agent-memory-box, pos-codex |
| Runtime | Node.js 20+ | LTS, proven |
| Package manager | pnpm workspaces | Clean monorepo, fast installs |
| Database | better-sqlite3 + FTS5 | Single file, no server, full-text search built in |
| LLM (local) | Ollama | Free, local, privacy-first |
| LLM (cloud) | OpenAI-compatible API | Fallback when Ollama unavailable |
| CLI framework | Commander.js | Same as continuos, lightweight |
| Testing | Vitest | Same as continuos, fast |
| Validation | Zod | Same as continuos, type-safe |

## What We Explicitly Don't Build (Yet)

- Web UI / dashboard
- Python integration
- Docker containers
- Vector embeddings / semantic search
- MCP server interface
- Research / web crawling
- Finance tracking
- Health / habits tracking
- Multi-agent orchestration
- Real-time streaming

These are all future plugins or phases. The design supports them without needing them now.

## Future Plugin Path

When ready, add plugins without touching core:
- `plugin-research/` — crawl, index, RAG (from context-builder patterns)
- `plugin-finance/` — accounts, transactions (from personalOsv2 patterns)
- `plugin-continuos/` — wire in continuos runtime for orchestrated workflows
- `plugin-web-ui/` — serve a dashboard (from pos-codex UI patterns)

## Success Criteria

1. `pai memory remember` and `pai memory recall` work end-to-end with Ollama
2. `pai task add`, `pai task list`, `pai task done` work with SQLite persistence
3. `pai task ai-suggest` returns useful prioritization using memory context
4. Total codebase under 2000 lines (excluding tests)
5. Ships in under a week

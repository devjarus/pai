# Architecture

## What pai Is

Persistent AI memory layer for coding agents. Agents remember facts, build beliefs over time, and use them to make better decisions. Everything lives in a single SQLite file — no cloud, no external services required.

## Design Principles

1. **Memory-first.** The belief lifecycle is the core differentiator.
2. **Local-first.** Single SQLite file. No cloud dependency.
3. **Agent-native.** MCP server + CLI with `--json` and exit codes.
4. **One stack.** TypeScript only. No Python, Docker, or separate processes.
5. **Plugin architecture.** Core + any single plugin = working system.
6. **Start minimal.** Two plugins, not twenty features.

## Package Structure

```
packages/
  core/             Config, Storage, LLM Client (chat + embed), Logger, Plugin interface
  cli/              Commander.js CLI + MCP server (stdio transport)
  plugin-memory/    Belief lifecycle: episodes, beliefs, embeddings, semantic search, contradiction detection
  plugin-tasks/     Tasks + Goals with AI prioritization using memory context
```

---

## Core

### Config

Reads from env vars or `.env`. Keys: `dataDir`, LLM provider/model/embedModel/baseUrl/apiKey, active plugins list, log level.

Env vars: `PAI_DATA_DIR`, `PAI_LLM_PROVIDER`, `PAI_LLM_MODEL`, `PAI_LLM_EMBED_MODEL`, `PAI_LLM_BASE_URL`, `PAI_LLM_API_KEY`, `PAI_LLM_FALLBACK_MODE`, `PAI_PLUGINS`, `PAI_LOG_LEVEL`.

### Storage

Single SQLite database at `{dataDir}/personal-ai.db`. WAL mode, foreign keys enabled. Each plugin owns its tables via migrations tracked in `_migrations`.

### LLM Client

Vercel AI SDK (`ai` + `@ai-sdk/openai` + `ai-sdk-ollama`). Three capabilities:

- **`chat(messages, options)`** — Returns `ChatResult` with text and token usage. Used for belief extraction, contradiction detection, AI suggestions.
- **`embed(text)`** — Returns `EmbedResult` with a `number[]` embedding vector. Used for semantic similarity search and dedup. Default model: `nomic-embed-text` (Ollama) / `text-embedding-3-small` (OpenAI).
- **`health()`** — Checks provider availability.

Supports Ollama local (`http://127.0.0.1:11434`), Ollama Cloud (`https://api.ollama.com` with API key auth), and OpenAI.

### Logger

Structured NDJSON logging via `createLogger()` with dual output:

- **Stderr** — Controlled by `PAI_LOG_LEVEL`. Levels: `silent` (default), `error`, `warn`, `info`, `debug`.
- **File** — Always writes to `{dataDir}/pai.log` at `info` level. Size-based rotation at 5MB with 1 backup (`pai.log.1`).

### Plugin Interface

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
  json?: boolean            // --json flag for structured output
  exitCode?: number         // set to 2 for "no results"
  contextProvider?: (query: string) => Promise<string>  // cross-plugin memory injection
}
```

No lifecycle hooks, no event system, no middleware. Plugins get context, return commands.

---

## Memory Plugin

The core of pai. Manages the full belief lifecycle.

### Episodes

Append-only observations/actions/outcomes. Each `remember` call creates an episode first, then processes beliefs from it. Episodes have optional embeddings for semantic episode search.

### Beliefs

Durable knowledge with confidence scores. Each belief has:

- **`type`** — `fact` (preserves what user said) or `insight` (LLM-inferred generalization)
- **`confidence`** — 0.0-1.0. Stored as base confidence; all read paths apply 30-day half-life exponential decay via `effectiveConfidence()`. Displayed confidence decreases over time without background jobs.
- **`status`** — `active`, `invalidated`, `forgotten`, or `pruned`
- **`embedding`** — Vector stored in `belief_embeddings` table for semantic similarity

### Belief Lifecycle

```
create (0.6 confidence)
  → reinforce (boost confidence, reset decay timer)
  → contradict (invalidate old, create replacement)
  → decay (30-day half-life, automatic at read time)
  → prune (remove if effective confidence < threshold)
  → forget (manual soft-delete by user/agent)
```

### remember() Flow

1. Create episode from raw text, embed episode for semantic search
2. LLM extracts dual beliefs: a personal **fact** + an optional **insight**
3. For each extracted belief:
   - Embed the statement via `llm.embed()`
   - Find top 5 semantically similar active beliefs via cosine similarity
   - **Similarity > 0.85** — merge/reinforce existing belief (boost confidence, reset decay)
   - **Similarity 0.7-0.85** — LLM contradiction check; if contradicted, invalidate old + create new
   - **Similarity < 0.7** — create new belief with embedding stored

### Search

- **Semantic search** (primary) — Embed query, cosine similarity against all belief embeddings, threshold 0.3
- **FTS5 search** (fallback) — Full-text search with sanitized queries, OR semantics, stop word filtering

### Change Tracking

`belief_changes` table logs every create, reinforce, contradict, forget, prune event with timestamps and episode links. Queryable via `memory history <beliefId>`.

### Context Packing

`getMemoryContext(query)` assembles relevant beliefs (sorted by confidence, annotated with type) + recent episodes into formatted markdown for LLM context injection. Used by tasks plugin for AI suggestions.

### Memory Maintenance

- **`reflect`** — Scans for near-duplicate belief clusters and stale beliefs (low effective confidence)
- **`prune`** — Removes beliefs below a confidence threshold
- **`stats`** — Shows belief counts by status, episode count, average confidence
- **`export/import`** — Full memory backup and restore with dedup on import

### CLI Commands

```
pai memory remember <text>       Record observation, extract fact + insight beliefs
pai memory recall <query>        Semantic search (embedding) with FTS5 fallback
pai memory beliefs [--status]    List beliefs sorted by effective confidence
pai memory episodes [--limit]    List recent episodes
pai memory history <id>          Show belief change audit trail
pai memory context <query>       Preview memory context for LLM injection
pai memory forget <id>           Soft-delete a belief
pai memory prune [--threshold]   Remove low-confidence beliefs
pai memory reflect               Scan for duplicates and stale beliefs
pai memory stats                 Memory health summary
pai memory export [file]         Export all memory data to JSON
pai memory import <file>         Import memory data (skips duplicates)
```

---

## Tasks Plugin

Supporting plugin for tracking work items alongside memory.

### Tasks

Things to do with status (`open`/`done`), priority (`low`/`medium`/`high`), optional due date and goal link. Input validation on title and priority.

### Goals

Larger objectives that tasks roll up to.

### AI Suggestions

`ai-suggest` feeds open tasks + goals + memory context to LLM for prioritization advice. This is the cross-plugin integration point — memory informs task priority.

### CLI Commands

```
pai task add <title> [--priority] [--due] [--goal]
pai task list [--status]
pai task done <id>
pai task edit <id> [--title] [--priority] [--due]
pai task reopen <id>
pai task ai-suggest
pai goal add <title>
pai goal list
pai goal done <id>
```

---

## MCP Server

14-tool MCP server over stdio transport for native agent integration. Each tool wrapped in try/catch with consistent `ok(data)` / `err(error)` response helpers. Clean shutdown on SIGTERM/SIGINT for SQLite WAL flush.

**Memory tools:** `remember`, `recall`, `memory-context`, `beliefs`, `forget`, `memory-stats`
**Task tools:** `task-list`, `task-add`, `task-done`, `task-edit`, `task-reopen`
**Goal tools:** `goal-list`, `goal-add`, `goal-done`

---

## Data Model

```sql
-- Memory Plugin
episodes          (id, timestamp, context, action, outcome, tags_json)
episode_embeddings(episode_id PK, embedding TEXT)   -- JSON array of floats
beliefs           (id, statement, confidence, status, type, created_at, updated_at)
belief_episodes   (belief_id, episode_id)
belief_changes    (id, belief_id, change_type, detail, episode_id, created_at)
belief_embeddings (belief_id PK, embedding TEXT)     -- JSON array of floats
beliefs_fts       (FTS5 virtual table on beliefs.statement)

-- Tasks Plugin
tasks             (id, title, description, status, priority, goal_id, due_date, created_at, completed_at)
goals             (id, title, description, status, created_at)
```

## Tech Stack

| Layer | Choice |
|-------|--------|
| Language | TypeScript (strict mode, ES2022) |
| Runtime | Node.js 20+ |
| Package manager | pnpm workspaces |
| Database | better-sqlite3 + FTS5 |
| Embeddings | Stored as JSON in SQLite, cosine similarity in JS |
| LLM SDK | Vercel AI SDK (ai, @ai-sdk/openai, ai-sdk-ollama) |
| CLI | Commander.js |
| MCP | @modelcontextprotocol/sdk (stdio transport) |
| Testing | Vitest with v8 coverage |
| Validation | Zod |
| IDs | nanoid |

## Agent Integration

pai is designed as infrastructure for coding agents:

- **MCP server** — 14 tools for native integration with Claude Code, Cursor, etc.
- **CLI with `--json`** — Structured output for programmatic use
- **Exit codes** — 0 (success), 1 (error), 2 (no results) for branching
- **Prefix matching** — All IDs accept first 8 characters
- **Context packing** — `getMemoryContext()` formats beliefs + episodes for LLM prompt injection
- **Zero config** — Works out of the box with Ollama running locally

## Future Plugin Path

Add plugins without touching core:

- `plugin-research/` — crawl, index, RAG
- `plugin-web-ui/` — serve a dashboard

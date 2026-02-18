# Architecture

## Design Principles

1. **Start minimal.** Two plugins, not twenty features.
2. **No restarts.** Extend what works, don't rewrite.
3. **One stack.** TypeScript only. No Python, no Docker, no separate processes.
4. **One database.** SQLite + FTS5. No Postgres, Redis, or external vector DBs.
5. **One LLM client.** Ollama-first (local or cloud), OpenAI fallback. Shared across plugins.
6. **CLI-first.** Web UI is a future phase.
7. **Every plugin is optional.** Core + any single plugin = working system.

## Package Structure

```
packages/
  core/             Config, Storage, LLM Client (chat + embed), Logger, Plugin interface
  cli/              Commander.js entrypoint, plugin loading
  plugin-memory/    Episodes + Beliefs with embeddings and FTS5 search
  plugin-tasks/     Tasks + Goals with AI prioritization
```

---

## Core

### Config

Reads from env vars or `.env`. Keys: `dataDir`, LLM provider/model/embedModel/baseUrl/apiKey, active plugins list, log level.

Env vars: `PAI_DATA_DIR`, `PAI_LLM_PROVIDER`, `PAI_LLM_MODEL`, `PAI_LLM_EMBED_MODEL`, `PAI_LLM_BASE_URL`, `PAI_LLM_API_KEY`, `PAI_LLM_FALLBACK_MODE`, `PAI_PLUGINS`, `PAI_LOG_LEVEL`.

### Storage

Single SQLite database at `{dataDir}/personal-ai.db`. WAL mode, foreign keys enabled. Each plugin owns its tables via migrations tracked in `_migrations`.

### LLM Client

Vercel AI SDK (`ai` + `@ai-sdk/openai` + `ai-sdk-ollama`). Two capabilities:

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
}
```

No lifecycle hooks, no event system, no middleware. Plugins get context, return commands.

---

## Memory Plugin

### Episodes

Append-only observations/actions/outcomes. Each `remember` call creates an episode first, then processes beliefs from it.

### Beliefs

Durable knowledge with confidence scores. Each belief has:

- **`type`** — `fact` (preserves what user said) or `insight` (LLM-inferred generalization)
- **`confidence`** — 0.0–1.0. The database stores the *base* confidence (set at creation, boosted on reinforcement). All read paths apply a 30-day half-life exponential decay at query time via `effectiveConfidence()`. This means the displayed confidence decreases over time without background jobs or write-back. Raw DB values represent the peak confidence, not the current effective value.
- **`status`** — `active` or `invalidated`
- **Embedding** — 768-dim vector stored in `belief_embeddings` table for semantic similarity

### remember() Flow

1. Create episode from raw text
2. LLM extracts dual beliefs: a personal **fact** + an optional **insight** (JSON output)
3. For each extracted belief:
   - Embed the statement via `llm.embed()`
   - Find top 5 semantically similar beliefs via cosine similarity
   - **Similarity > 0.85** → merge/reinforce existing belief (boost confidence, reset decay)
   - **Similarity 0.5–0.85** → LLM contradiction check; if contradicted, invalidate old + create new
   - **Similarity < 0.5** → create new belief with embedding stored

### Search

- **Semantic search** (primary) — Embed query, cosine similarity against all belief embeddings, threshold 0.3
- **FTS5 search** (fallback) — Full-text search with sanitized queries, OR semantics, stop word filtering

### Change Tracking

`belief_changes` table logs every create, reinforce, contradict event with timestamps and episode links. Queryable via `memory history <beliefId>`.

### Context Packing

`getMemoryContext(query)` assembles relevant beliefs + recent episodes into a formatted markdown string for LLM context injection. Exported for cross-plugin use (used by tasks plugin).

### CLI Commands

```
pai memory remember <text>    Record observation, extract fact + insight beliefs
pai memory recall <query>     Semantic search (embedding) with FTS5 fallback
pai memory beliefs [--status] List beliefs sorted by effective confidence
pai memory episodes [--limit] List recent episodes
pai memory history <id>       Show belief change audit trail
pai memory context <query>    Preview memory context for LLM injection
```

---

## Tasks Plugin

### Tasks

Things to do with status (`open`/`done`), priority (`low`/`medium`/`high`), optional due date and goal link.

### Goals

Larger objectives that tasks roll up to.

### AI Suggestions

`ai-suggest` feeds open tasks + memory context to LLM for prioritization advice.

### CLI Commands

```
pai task add <title> [--priority] [--due] [--goal]
pai task list [--status] [--priority]
pai task done <id>
pai task ai-suggest
pai goal add <title>
pai goal list
```

---

## Data Model

```sql
-- Memory Plugin
episodes          (id, timestamp, context, action, outcome, tags_json)
beliefs           (id, statement, confidence, status, type, created_at, updated_at)
belief_episodes   (belief_id, episode_id)
belief_changes    (id, belief_id, change_type, detail, episode_id, created_at)
belief_embeddings (belief_id PK, embedding TEXT)  -- JSON array of floats
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
| Testing | Vitest with v8 coverage |
| Validation | Zod |
| IDs | nanoid |

## Future Plugin Path

Add plugins without touching core:

- `plugin-research/` — crawl, index, RAG
- `plugin-finance/` — accounts, transactions
- `plugin-web-ui/` — serve a dashboard

## What We Explicitly Don't Build (Yet)

Web UI, Python, Docker, external vector databases, MCP server, research/crawling, finance, health/habits, multi-agent orchestration, real-time streaming. The plugin architecture supports all of these as future additions.

# Architecture

## System Context (C4 Level 1)

```
┌──────────────────────────────────────────────────────────────────┐
│                          Users                                   │
│  Owner (web/telegram)    Family/Friends (telegram)    Agents     │
└───────┬──────────────────────┬────────────────────────┬──────────┘
        │                      │                        │
        ▼                      ▼                        ▼
┌──────────────┐    ┌──────────────────┐    ┌──────────────────────┐
│   Web UI     │    │  Telegram Bot    │    │  CLI / MCP Server    │
│  (React SPA) │    │    (grammY)      │    │  (Commander / stdio) │
└──────┬───────┘    └────────┬─────────┘    └──────────┬───────────┘
       │                     │                         │
       ▼                     ▼                         ▼
┌──────────────────────────────────────────────────────────────────┐
│                     Fastify API Server (:3141)                   │
│              REST + SSE streaming + static UI                    │
└──────────────────────────────┬───────────────────────────────────┘
                               │
       ┌───────────────────────┼───────────────────────┐
       ▼                       ▼                       ▼
┌─────────────┐     ┌──────────────────┐     ┌────────────────┐
│   Memory +  │     │  Agent Pipeline  │     │    Plugins     │
│  Knowledge  │     │  (tools, LLM,   │     │  (tasks, goals │
│  (beliefs,  │     │   streaming)     │     │   web search)  │
│  episodes,  │     │                  │     │                │
│  chunks)    │     │                  │     │                │
└──────┬──────┘     └────────┬─────────┘     └───────┬────────┘
       │                     │                       │
       └─────────────────────┼───────────────────────┘
                             ▼
                ┌────────────────────────┐
                │   SQLite (WAL mode)    │       ┌──────────────────┐
                │  ~/.personal-ai/data/  │       │ Ollama / OpenAI  │
                │   personal-ai.db       │       │ Anthropic/Google │
                └────────────────────────┘       └──────────────────┘
```

**Design principles:** KISS. SOLID. TDD. Plugin architecture. Unified retrieval (beliefs + knowledge with one embedding call).

---

## Container Diagram (C4 Level 2)

```
packages/
  core/               Config, Storage (auto-backup + transaction-wrapped migrations), LLM Client (humanizeError), Logger, Memory (classifyRelationship), Knowledge, Threads, Plugin interfaces
  cli/                Commander.js CLI + MCP server (stdio, 19 tools) + `pai init`
  plugin-tasks/       Tasks + Goals with AI prioritization
  plugin-assistant/   Personal Assistant agent — system prompt, AI SDK tools, afterResponse hook
  plugin-curator/     Memory Curator agent — health analysis, dedup, contradiction resolution
  plugin-telegram/    Telegram bot — grammY, standalone entry point, chat pipeline
  server/             Fastify API — REST + SSE + static UI serving
  ui/                 React + Vite + Tailwind + shadcn/ui SPA
```

---

## Chat Dataflow

### Web UI → Server

```
User types message
    │
    ▼
POST /api/chat { id, messages: [{ role, parts }], sessionId, agent }
    │
    ├── Parse message (supports AI SDK / legacy formats)
    ├── ensureThread(storage, { id: sessionId })
    │     Thread exists? → return it
    │     Missing? → createThread() → reply.header("X-Thread-Id", newId)
    │
    └── withThreadLock(threadId, async () => {
          │
          ├── listMessages(threadId, { limit: 20 })    ← load history
          │
          ├── Build system prompt:
          │     agent.systemPrompt
          │     + current date/time
          │     + identity ("You are talking to your owner via web UI")
          │
          ├── streamText({ model, system, messages, tools, stopWhen: stepCountIs(5) })
          │     │
          │     │  LLM autonomously calls tools (0-5 steps):
          │     │    memory_recall → semantic search + FTS5
          │     │    memory_remember → extract + deduplicate + store beliefs
          │     │    memory_forget → soft-delete belief
          │     │    web_search → Brave Search
          │     │    task_list / task_add / task_done
          │     │
          │     └── onFinish:
          │           ├── appendMessages(threadId, [user, toolSummaries, assistant])
          │           │     → INSERT INTO thread_messages (sequence-ordered)
          │           │     → sliding window: DELETE oldest if > 500
          │           │     → UPDATE threads (title, count, timestamp)
          │           │
          │           ├── afterResponse (fire-and-forget):
          │           │     → LLM extracts facts from user message
          │           │     → validates each against assistant response
          │           │     → remember() for confirmed facts
          │           │
          │           └── every 5th user turn → consolidateConversation()
          │                 → LLM summarizes last 10 messages
          │                 → creates episode + embedding
          │
          └── createUIMessageStream → SSE → Readable → reply.send()
        })
```

### Telegram → Bot

```
User sends message on Telegram
    │
    ├── grammY receives via long-polling
    ├── getOrCreateThread(chatId) → telegram_threads mapping → thread_id
    │
    └── runAgentChat({ threadId, message, sender })
          │
          ├── withThreadLock(threadId, async () => { ... })
          │     Same pipeline as web, except:
          │     - generateText() instead of streamText() (non-streaming)
          │     - Identity injection uses sender name/username from Telegram
          │     - Owner detection via config.telegram.ownerUsername
          │     - Tool status updates sent as chat actions ("typing...")
          │     - Raw tool call JSON stripped from response (Ollama quirk)
          │     - stepCountIs(3) instead of 5
          │
          └── Format response:
                → Markdown → Telegram HTML (<b>, <code>, <pre>, <a>)
                → Split at 4096-char limit
                → bot.api.sendMessage()
```

---

## Memory System

### Data Model

```
episodes                              beliefs
  id, timestamp, context,               id, statement, confidence, status,
  action, outcome, tags_json             type, importance, stability, subject,
    │                                    access_count, last_accessed,
    │                                    supersedes, superseded_by
    │                                      │
    └──── belief_episodes ─────────────────┘  (many-to-many provenance)
                                           │
                                   belief_embeddings    (float[] as JSON)
                                   belief_changes       (audit log)
                                   belief_links         (Zettelkasten graph)
                                   beliefs_fts          (FTS5, auto-synced via triggers)

episode_embeddings                 (float[] as JSON, for semantic episode search)
```

### Belief Properties

| Field | Description |
|-------|-------------|
| `type` | `factual`, `preference`, `procedural`, `architectural`, `insight`, `meta` |
| `confidence` | 0.0-1.0, decays over time: `conf × 0.5^(days / (30 × stability))` |
| `stability` | 1.0-5.0, increases +0.1 per retrieval (SM-2 inspired). Meta-beliefs start at 3.0 |
| `importance` | 1-10 integer, weights retrieval ranking |
| `status` | `active`, `invalidated`, `forgotten`, `pruned` |
| `subject` | Who the belief is about: `owner`, `alex`, `bob`, `general` |

### Belief Lifecycle

```
create (confidence 0.6)
  → reinforce (similarity > 0.85: boost confidence, reset decay)
  → contradict (similarity 0.7-0.85, LLM confirms conflict):
      weak evidence (< 3 episodes): invalidate old, create replacement
      strong evidence (≥ 3 episodes): weaken old (-0.2), both coexist
  → decay (automatic at read time, stability-adjusted half-life)
  → prune (effective confidence < threshold → status='pruned')
  → forget (manual soft-delete → status='forgotten')
  → synthesize (cluster related beliefs → meta-belief with stability 3.0)
```

### remember() — Writing Memories

```
Input: "Alex prefers Zustand over Redux"
    │
    ├── createEpisode → INSERT INTO episodes
    │     + llm.embed(text) → storeEpisodeEmbedding    (parallel)
    │
    └── extractBeliefs(llm, text)                       (parallel)
          │
          Returns: { fact, factType, importance, insight, subject }
          │
          ▼
        processNewBelief:
          │
          ├── llm.embed(statement) → embedding
          ├── findSimilarBeliefs(embedding, top 5) → cosine similarity
          │
          ├── > 0.85 similarity → REINFORCE existing belief
          │     confidence += 0.1, link to episode
          │
          ├── 0.7-0.85 → CLASSIFY RELATIONSHIP (LLM call → classifyRelationship())
          │     ├── REINFORCEMENT → boost existing belief (same as >0.85)
          │     ├── CONTRADICTION + ≥3 episodes → WEAKEN old (proportional: -min(0.2, 1/(count+1))), both coexist
          │     ├── CONTRADICTION + <3 episodes → INVALIDATE old, create replacement
          │     └── INDEPENDENT → fall through to CREATE
          │
          ├── 0.4-0.7 → CREATE new + link to neighbors (Zettelkasten, up to 3 links)
          │
          └── < 0.4 → CREATE new standalone
```

### Recall — Unified Retrieval

The `memory_recall` tool calls `retrieveContext()` — a unified retrieval API that searches beliefs AND knowledge with a single embedding call:

```
Query: "What does Alex like?"
    │
    ├── llm.embed(query) → queryEmbedding  ← ONE call, shared across beliefs + knowledge
    │
    ├── BELIEFS: semanticSearch(queryEmbedding, limit=8):
    │     For each active belief with embedding:
    │       score = 0.5 × cosine(query, belief)     ← semantic relevance
    │             + 0.2 × (importance / 10)          ← priority weight
    │             + 0.1 × recency                    ← exp decay from last_accessed
    │             + 0.05 × stability                 ← well-established bonus
    │             + 0.15 × subjectMatch              ← mentioned-person boost
    │     Filter: cosine ≥ 0.2
    │     Sort by score, take top 8
    │     │
    │     └── Graph traversal (top 3 results):
    │           query belief_links → fetch linked beliefs
    │           score = parent_score × 0.8
    │           append to results
    │
    ├── KNOWLEDGE: knowledgeSearch(query, limit=5, { queryEmbedding }):
    │     Phase 1: FTS5 prefilter → get up to limit*10 candidate chunks
    │     Phase 2: cosine re-rank candidates using shared embedding
    │     Fallback: full scan if FTS found nothing
    │     Fallback: FTS-only (score 0.5) if embedding fails
    │
    ├── EPISODES: findSimilarEpisodes(queryEmbedding, limit=5)
    │     cosine > 0.3 filter
    │
    ├── FTS5 fallback (if semantic returned nothing for beliefs):
    │     tokenize → remove stop words → beliefs_fts MATCH "w1" OR "w2"
    │
    └── Format: ## Relevant beliefs, ## Knowledge base, ## Recent observations
```

**Knowledge-Memory Bridge:** The assistant's system prompt instructs it to store key takeaways from knowledge searches as beliefs via `memory_remember`. This promotes frequently-useful facts to high-confidence beliefs for instant recall.

### afterResponse — Automatic Fact Extraction

Fires after every chat response (non-blocking):

```
User message (≥15 chars) + assistant response (≥10 chars)
    │
    ├── LLM extracts facts (max 3), attributed to correct person
    ├── Validation gates:
    │     ✓ Named subject (starts with capital)
    │     ✓ Structured (≥3 words)
    │     ✗ Not generic ("knowledge", "life", etc.)
    ├── LLM validates each against assistant response (CONFIRMED/REJECTED)
    └── remember() for confirmed facts → full dedup/contradiction pipeline
```

### Consolidation — Every 5 User Turns

```
COUNT user messages in thread % 5 === 0?
    │
    └── yes: listMessages(limit: 10)
              → LLM summarizes into 1-3 sentences
              → "NONE" if trivial → skip
              → createEpisode(context: "conversation-consolidation")
              → embed summary → storeEpisodeEmbedding
              → appears in future memory_recall results
```

### Maintenance

| Command | What it does |
|---------|-------------|
| `reflect` | Find near-duplicate pairs (cosine > 0.85) + stale beliefs |
| `prune` | Remove beliefs below confidence threshold |
| `synthesize` | Cluster beliefs (cosine > 0.6) → LLM meta-beliefs (stability 3.0) |
| `forget` | Soft-delete → status='forgotten' |
| `backfillSubjects` | LLM re-tags all "owner" beliefs with correct person names |
| `export/import` | Full backup/restore with dedup on import |

---

## Thread Persistence

### Schema (v2 — normalized)

```sql
users              (id, display_name, created_at)
threads            (id, title, agent_name, user_id FK, created_at, updated_at, message_count)
thread_messages    (id, thread_id FK, role, content, parts_json, created_at, sequence)
                    INDEX: (thread_id, sequence)
telegram_threads   (chat_id INTEGER PK, thread_id, username, created_at)
```

### Key Functions (`packages/core/src/threads.ts`)

| Function | Purpose |
|----------|---------|
| `ensureThread(storage, opts)` | Get or create thread (used by `/api/chat` for auto-create) |
| `listMessages(storage, threadId, { limit, before })` | Paginated, sequence-ordered |
| `appendMessages(storage, threadId, msgs, { maxMessages, titleCandidate })` | Bulk insert + sliding window + auto-title |
| `clearThread(storage, threadId)` | Delete messages, keep thread |
| `deleteThread(storage, threadId)` | Hard delete thread + messages |
| `withThreadLock(threadId, fn)` | Per-thread promise queue (serialize concurrent requests) |

---

## API Server

Fastify on port 3141, host 127.0.0.1.

### Routes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/agents` | List agents |
| `POST` | `/api/chat` | Chat (SSE streaming, AI SDK format) |
| `GET` | `/api/threads` | List threads |
| `POST` | `/api/threads` | Create thread |
| `GET` | `/api/threads/:id/messages` | Paginated messages (before= cursor) |
| `PATCH` | `/api/threads/:id` | Rename thread |
| `DELETE` | `/api/threads/:id` | Delete thread |
| `GET` | `/api/chat/history` | Legacy history |
| `DELETE` | `/api/chat/history` | Clear conversation |
| `GET` | `/api/beliefs` | List beliefs (filter: status, type) |
| `GET` | `/api/beliefs/:id` | Belief detail |
| `GET` | `/api/search?q=` | Semantic search |
| `GET` | `/api/stats` | Memory stats |
| `POST` | `/api/remember` | Store observation |
| `POST` | `/api/forget/:id` | Soft-delete belief |
| `POST` | `/api/memory/clear` | Clear all beliefs |
| `GET` | `/api/config` | Current config (keys sanitized) |
| `PUT` | `/api/config` | Update config → reinitialize() |
| `GET` | `/api/browse?path=` | Directory browser |

### Reinitialize Pattern

When config changes via Settings UI → `PUT /api/config`:
1. Keep old storage reference for in-flight requests
2. Reload config, create new storage/LLM/logger
3. Run all migrations on new database
4. `Object.assign(ctx, newCtx)` — all routes see new connections
5. Close old storage after 5s delay
6. Restart/stop Telegram bot based on new config

---

## Plugin System

```typescript
interface Plugin {
  name: string; version: string;
  migrations: Migration[];
  commands(ctx: PluginContext): Command[];
}

interface AgentPlugin extends Plugin {
  agent: {
    displayName: string;
    systemPrompt: string;
    capabilities?: string[];
    createTools?(ctx: AgentContext): Record<string, Tool>;
    afterResponse?(ctx: AgentContext, response: string): Promise<void>;
  };
}

interface AgentContext extends PluginContext {
  userMessage: string;
  conversationHistory: ChatMessage[];
  sender?: { displayName?: string; username?: string };
}
```

### Personal Assistant (`plugin-assistant`)

- System prompt instructs LLM to ALWAYS call `memory_recall` before answering
- Tools: `memory_recall` (unified retrieval), `memory_remember`, `memory_beliefs`, `memory_forget`, `web_search`, `knowledge_search`, `learn_from_url`, `task_list`, `task_add`, `task_done`
- `memory_recall` uses `retrieveContext()` — searches beliefs + knowledge in one embedding call
- Knowledge-memory bridge: system prompt instructs storing key knowledge takeaways as beliefs
- `afterResponse`: extracts facts → validates against response → stores via `remember()`
- Web search: Brave Search HTML endpoint, no API key required

### Memory Curator (`plugin-curator`)

- System prompt instructs analysis → present findings → wait for approval → fix
- Tools: `curate_memory` (read-only health analysis), `fix_issues` (merge/prune/resolve/synthesize), `list_beliefs`
- Never takes destructive actions without explicit user approval

### Tasks Plugin (`plugin-tasks`)

Tasks (status/priority/due date) + Goals. `ai-suggest` feeds tasks + memory to LLM for prioritization.

### Telegram Bot (`plugin-telegram`)

- grammY long-polling, standalone entry point
- `telegram_threads` maps chat_id → thread_id (reuses same thread/message tables)
- `runAgentChat()` — non-streaming (`generateText`), same tools as web
- Multi-user: sender identity injected, owner detected via `config.telegram.ownerUsername`
- Markdown → Telegram HTML conversion, 4096-char splitting

---

## Web UI

React SPA — Chat, Memory Explorer, Knowledge, Settings, Timeline.

| Page | Key features |
|------|-------------|
| **Chat** | AI SDK `useChat` + `DefaultChatTransport`, thread sidebar, tool cards, responsive mobile, token usage badge |
| **Memory** | Browse/search beliefs, type filter tabs, detail sidebar, clear all, empty state |
| **Knowledge** | Browse sources, view chunks, search knowledge base, learn from URLs, crawl sub-pages |
| **Settings** | LLM provider dropdown with auto-populated presets (Ollama/OpenAI/Anthropic/Google), model/key, data directory browser, Telegram config |
| **Timeline** | Chronological episodes + belief changes, empty state |

**Global error handling:** `ErrorBoundary` (catches React errors, refresh + copy details) and `OfflineBanner` (10s ping, amber banner, auto-dismiss on reconnect).

---

## MCP Server

19-tool MCP server over stdio. Tools: `remember`, `recall`, `memory-context`, `beliefs`, `forget`, `memory-stats`, `memory-synthesize`, `knowledge-learn`, `knowledge-search`, `knowledge-sources`, `knowledge-forget`, `task-list`, `task-add`, `task-done`, `task-edit`, `task-reopen`, `goal-list`, `goal-add`, `goal-done`.

---

## Data Model

```sql
-- Memory (core) — migrations v1-v10
episodes           (id, timestamp, context, action, outcome, tags_json)
episode_embeddings (episode_id PK, embedding TEXT)
beliefs            (id, statement, confidence, status, type,
                    importance, stability, subject,
                    access_count, last_accessed,
                    superseded_by, supersedes,
                    created_at, updated_at)
belief_embeddings  (belief_id PK, embedding TEXT)
belief_episodes    (belief_id, episode_id)
belief_changes     (id, belief_id, change_type, detail, episode_id, created_at)
belief_links       (belief_a, belief_b)
beliefs_fts        (FTS5 virtual table, auto-synced via triggers)

-- Knowledge (core) — migrations v1-v2
knowledge_sources  (id, url, title, fetched_at, chunk_count)
knowledge_chunks   (id, source_id FK, content, chunk_index, embedding TEXT, created_at)
knowledge_chunks_fts (FTS5 virtual table, auto-synced via triggers)

-- Threads (core) — migrations v1-v2
users              (id, display_name, created_at)
threads            (id, title, agent_name, user_id FK, created_at, updated_at, message_count)
thread_messages    (id, thread_id FK, role, content, parts_json, created_at, sequence)

-- Telegram — migration v1
telegram_threads   (chat_id INTEGER PK, thread_id, username, created_at)

-- Tasks — plugin migrations
tasks              (id, title, description, status, priority, goal_id, due_date, created_at, completed_at)
goals              (id, title, description, status, created_at)
```

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Language | TypeScript strict, ES2022, NodeNext |
| Runtime | Node.js 20+ |
| Packages | pnpm workspaces |
| Database | better-sqlite3 + FTS5 (single file, WAL mode) |
| Embeddings | JSON in SQLite, cosine similarity in JS |
| LLM | Vercel AI SDK (ai, @ai-sdk/openai, @ai-sdk/google, ai-sdk-ollama) |
| API Server | Fastify + CORS + static serving |
| Frontend | React + Vite + Tailwind CSS + shadcn/ui |
| Telegram | grammY |
| CLI | Commander.js |
| MCP | @modelcontextprotocol/sdk (stdio) |
| Testing | Vitest + v8 coverage |
| Validation | Zod |
| IDs | nanoid |
| Container | Docker (multi-stage Alpine build) |

---

## Docker Deployment

```
┌─────────────────────────────────────────┐
│              Host Machine               │
│                                         │
│  ┌──────────────┐   ┌───────────────┐   │
│  │  pai         │   │  ollama       │   │
│  │  :3141       │──▶│  :11434       │   │
│  │  /data vol   │   │  /models vol  │   │
│  └──────────────┘   └───────────────┘   │
│        │              (profile: local)   │
│        ▼                                │
│  ~/.personal-ai/data/                   │
└─────────────────────────────────────────┘
```

**Multi-stage Dockerfile:** Builder (Node 20 Alpine + pnpm + build tools) → Runtime (Alpine + dist + prod deps only). Target <400MB.

**docker-compose.yml:** Two services with Docker Compose profiles:
- `pai` — always starts, configurable via env vars (`PAI_LLM_PROVIDER`, `PAI_LLM_BASE_URL`, `PAI_LLM_API_KEY`)
- `ollama` — `profiles: [local]`, only starts with `--profile local`

**install.sh:** Interactive installer — checks Docker, asks local vs cloud, configures provider, saves `.env`, starts containers.

**CI:** `.github/workflows/docker.yml` builds and pushes to GHCR on `v*` tag push.

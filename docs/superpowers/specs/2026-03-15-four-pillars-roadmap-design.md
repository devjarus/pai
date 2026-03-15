# pai Four Pillars — Domain Restructure & Product Roadmap

**Date:** 2026-03-15
**Status:** Approved
**Vision:** "Your second brain that watches things for you"

---

## Problem Statement

pai is a capable self-hosted AI system with 13 packages, 65+ API routes, and strong internals. But:

1. **Knowledge doesn't compound** — research findings evaporate after briefs, uploaded content and memories live in silos, there's no research → KB pipeline
2. **Briefs lack depth** — recommendations are shallow, corrections don't stick, provenance is hard to trace
3. **Research is one-shot** — agents don't build on previous findings, no delta detection, no depth levels
4. **Follow-through is disconnected** — tasks/saved moves feel detached from briefs and programs
5. **Product language is confusing** — "Program," "Brief," "Belief," "Episode," "Saved Move," "Evidence" don't communicate instantly to new users

## Charter Amendments

This spec intentionally diverges from the current Product Charter and Architecture Boundaries in these ways:

1. **Tasks elevated to a top-level pillar.** The charter says pai "is not a standalone follow-through board." This restructure treats Tasks as subordinate to Digests and Watches — To-Dos only emerge from Digest recommendations or Watch follow-through. They are not a standalone task manager. The navigation prominence is justified because follow-through visibility is core to the "second brain" value prop. **Charter update required:** Amend anti-goals to clarify that To-Dos are a follow-through surface for Watches/Digests, not an independent task system.

2. **"Action/Saved Move" renamed to "To-Do."** The Primitives doc treats Actions as "optional, user-owned moves subordinate to Briefs." The rename preserves this subordination — To-Dos are always linked to a Digest or Watch. **Primitives update required:** Rename the Action primitive to To-Do, keep the subordination language.

3. **"Job" surfaced as "Activity."** Architecture Boundaries section 7 says "job" should stay internal. The rename to "Activity" with a collapsed sidebar entry is a compromise — power users need visibility into background work, but the concept is de-emphasized. **Boundaries update required:** Add "Activity" as an approved user-facing noun for background work visibility.

4. **Documentation updates per phase, not Phase 4.** AGENTS.md mandates updating docs in the same task that changes behavior. Each phase will update PRODUCT-CHARTER.md, PRIMITIVES.md, ARCHITECTURE.md, and ARCHITECTURE-BOUNDARIES.md for the nouns and behaviors it introduces. Phase 4's "update all docs" item becomes a final consistency pass only.

## Product Language Rename

Every user-facing noun is renamed for instant comprehension. Internal code types may keep technical names — the mapping happens at the API/UI boundary.

| Old (Internal) | New (User-Facing) | Why |
|---|---|---|
| Program | **Watch** | "I'm watching flight prices" — immediately clear |
| Brief / Briefing | **Digest** | "Your morning digest" — familiar concept |
| Belief | **Memory** | "It remembers I prefer window seats" |
| Episode | **Note** (internal only) | User never sees this term |
| Evidence | **Source** | "Based on 3 sources" |
| Knowledge Source | **Library item / Document** | "Add to your library" |
| Knowledge Chunk | **Snippet** (internal only) | User never sees this |
| Saved Move / Action | **To-Do** | Universal understanding |
| Goal | **Goal** | Already clear, keep |
| Thread | **Chat** | Already clear, keep |
| Swarm / Blackboard | Hidden (expandable) | Never user-facing by default, "Show agent work" for power users |
| Job | **Activity** | "3 activities running" |

## Architecture: Modular Monolith — Four Pillars + Shared Foundation

Single deployment, strict domain boundaries that could be split later.

```
┌─────────────────────────────────────────────────────────┐
│                    Delivery Surfaces                     │
│         Web UI  ·  Telegram  ·  CLI  ·  MCP             │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│                    API Gateway                           │
│              (Fastify, Auth, Rate Limit)                 │
└──┬──────────┬──────────┬──────────┬─────────────────────┘
   │          │          │          │
   ▼          ▼          ▼          ▼
┌──────┐  ┌──────┐  ┌───────┐  ┌──────┐
│Library│  │Watch │  │Digest │  │Tasks │
│Domain │  │Domain│  │Domain │  │Domain│
└──┬───┘  └──┬───┘  └──┬────┘  └──┬───┘
   │         │         │          │
   ▼         ▼         ▼          ▼
┌─────────────────────────────────────────────────────────┐
│              Shared Foundation                           │
│  Agent Harness · LLM Client · Storage · Telemetry       │
└─────────────────────────────────────────────────────────┘
```

### Domain Responsibilities

#### Library Domain (the gravity well — everything flows here)

- **Owns:** Memories (beliefs), Documents (knowledge sources/chunks), Research Findings, Snippets
- **Unified search:** One query searches across memories, documents, and findings
- **Ingestion pipelines:** Chat → Library, Research → Library, Upload → Library, URL → Library, Correction → Library
- **Compounding:** When a Digest is generated, its findings get distilled back as memories/sources
- **Current packages merged:** `core/memory` + `core/knowledge` + `plugin-curator`
- **New entity:** `ResearchFinding` — structured output from research that lives in Library with provenance

#### Watch Domain (monitoring + scheduling)

- **Owns:** Watch definitions, cadence/scheduling, domain detection, signal-change detection
- **Core job:** "Keep checking this thing and tell me when something changes or matters"
- **Current packages merged:** `plugin-schedules` + Programs runtime
- **New capabilities:** Signal-change detection (skip digest if nothing changed), Watch templates (price, news, competitor)

#### Digest Domain (outputs + recommendations)

- **Owns:** Digest generation, recommendation logic, provenance chains, correction handling
- **Pulls from:** Library (memories + documents + findings), Watch (what changed), Tasks (open to-dos)
- **Writes back to:** Library (corrections become memories, findings become sources)
- **Current packages merged:** `plugin-research` + briefing worker + inbox routes
- **New capabilities:** Quality scoring, feedback loop, auto-suggest to-dos

#### Tasks Domain (follow-through)

- **Owns:** To-dos, Goals, task lifecycle
- **Linked to:** Digests (to-do emerges from recommendation), Watches (to-do tracks follow-through)
- **Current package:** `plugin-tasks` (renamed + enhanced)
- **New capabilities:** Auto-suggest from Digests, completion triggers update Watch context

### Shared Foundation

- **Agent Harness** (new) — plan → execute → reflect → ingest pattern for all agents
- **LLM Client** — multi-provider, token budget, context windowing (as-is)
- **Storage** — SQLite WAL, migrations, FTS5 (as-is)
- **Telemetry** — span tracing, diagnostics (as-is)
- **Auth** — JWT, owner model (as-is)

## Package Restructure

```
packages/
├── core/                          # Shared Foundation (slimmed)
│   ├── src/
│   │   ├── llm.ts
│   │   ├── storage.ts
│   │   ├── telemetry.ts
│   │   ├── auth.ts
│   │   ├── artifacts.ts
│   │   ├── config.ts
│   │   ├── agent-harness/         # NEW
│   │   │   ├── planner.ts
│   │   │   ├── executor.ts
│   │   │   ├── reflector.ts
│   │   │   └── types.ts
│   │   └── logger.ts
│
├── library/                       # NEW DOMAIN
│   ├── src/
│   │   ├── memories/              # beliefs, episodes, decay, zettelkasten
│   │   ├── documents/             # knowledge sources, chunks, FTS5
│   │   ├── findings/              # NEW — structured research outputs
│   │   ├── curator/               # memory health, dedup, contradiction
│   │   ├── ingestion/             # pipelines: chat, research, upload, url, correction
│   │   ├── search.ts              # unified search across all three
│   │   └── index.ts
│
├── watches/                       # NEW DOMAIN
│   ├── src/
│   │   ├── watch.ts               # CRUD, lifecycle
│   │   ├── scheduler.ts           # cadence, due checks
│   │   ├── signals.ts             # NEW — change detection
│   │   ├── templates.ts           # NEW — common watch patterns
│   │   └── index.ts
│
├── digests/                       # NEW DOMAIN
│   ├── src/
│   │   ├── generator.ts           # digest composition
│   │   ├── research/              # domain agents (flight, stock, general)
│   │   ├── recommendations.ts     # recommendation logic
│   │   ├── provenance.ts          # source tracing
│   │   ├── corrections.ts         # feedback → Library writeback
│   │   ├── quality.ts             # NEW — digest scoring
│   │   └── index.ts
│
├── tasks/                         # RENAMED DOMAIN
│   ├── src/
│   │   ├── todos.ts
│   │   ├── goals.ts
│   │   ├── suggestions.ts         # NEW — auto-suggest from digests
│   │   ├── completion.ts          # NEW — done triggers → watch context
│   │   └── index.ts
│
├── server/                        # API Gateway (routes reorganized)
├── ui/                            # Pages renamed
├── cli/                           # Commands renamed
├── plugin-assistant/              # Tools point to new domains
├── plugin-swarm/                  # Outputs feed into Library
└── plugin-telegram/               # Language updated
```

### Migration Mapping

| Current | Destination | Action |
|---|---|---|
| `core/memory/*` | `library/memories/` | Move |
| `core/knowledge.ts` | `library/documents/` | Move |
| `plugin-curator` | `library/curator/` | Merge into library |
| `plugin-schedules` | `watches/` | Merge |
| Programs runtime (server) | `watches/` | Move |
| `plugin-research` | `digests/research/` | Move |
| Briefing worker | `digests/generator.ts` | Move |
| Inbox routes | `server/routes/digests/` | Move |
| `plugin-tasks` | `tasks/` | Rename + enhance |

## API Restructure

### Library (`/api/library`)

```
GET    /api/library/search?q=         # Unified search (memories + documents + findings)
GET    /api/library/memories           # was /api/beliefs
GET    /api/library/memories/:id       # was /api/beliefs/:id
POST   /api/library/memories           # was /api/remember
DELETE /api/library/memories/:id       # was /api/forget/:id
GET    /api/library/documents          # was /api/knowledge/sources
POST   /api/library/documents/url      # was /api/knowledge/learn
POST   /api/library/documents/upload   # was /api/knowledge/upload
DELETE /api/library/documents/:id      # was /api/knowledge/sources/:id
GET    /api/library/findings           # NEW
GET    /api/library/findings/:id       # NEW
GET    /api/library/stats              # was /api/stats
```

### Watches (`/api/watches`)

```
GET    /api/watches                    # was /api/programs
POST   /api/watches                    # was /api/programs
GET    /api/watches/:id                # was /api/programs/:id
PATCH  /api/watches/:id                # was /api/programs/:id
DELETE /api/watches/:id                # was /api/programs/:id
POST   /api/watches/:id/run            # trigger immediate research
GET    /api/watches/:id/history        # digest history for this watch
```

### Digests (`/api/digests`)

```
GET    /api/digests                    # was /api/inbox/all
GET    /api/digests/latest             # was /api/inbox
GET    /api/digests/:id                # was /api/inbox/:id
GET    /api/digests/:id/sources        # was /api/inbox/:id/provenance
POST   /api/digests/:id/correct        # NEW — correction → Library writeback
POST   /api/digests/:id/rate           # NEW — quality feedback
POST   /api/digests/refresh            # was /api/inbox/refresh
POST   /api/digests/:id/rerun          # was /api/inbox/:id/rerun
```

### Tasks (`/api/tasks`)

```
GET    /api/tasks                      # stays
POST   /api/tasks                      # stays
PATCH  /api/tasks/:id                  # stays
POST   /api/tasks/:id/done             # stays
DELETE /api/tasks/:id                  # stays
GET    /api/goals                      # stays
POST   /api/goals                      # stays
POST   /api/goals/:id/done             # stays
```

### Chat (`/api/chat`)

```
POST   /api/chat                       # stays (SSE streaming)
GET    /api/chats                      # was /api/threads
GET    /api/chats/:id/messages         # was /api/threads/:id/messages
DELETE /api/chats/:id                  # was /api/threads/:id
```

### Activities (`/api/activities`)

```
GET    /api/activities                 # was /api/jobs
GET    /api/activities/:id             # was /api/jobs/:id
GET    /api/activities/:id/agents      # was /api/jobs/:id/agents
POST   /api/activities/:id/cancel      # was /api/jobs/:id/cancel
```

### Admin (unchanged)

```
GET    /api/health
GET    /api/config
PUT    /api/config
GET    /api/auth/*
GET    /api/observability/*
```

### Migration Strategy

Old routes return `301` redirects to new paths for one major version. CLI and MCP tools updated to use new endpoints. UI switches immediately.

## UI Pages & Navigation

### Navigation

```
Sidebar:
  Home           — Dashboard: latest digest + open to-dos + active watches
  Chat           — stays
  Library        — merged Memory + Knowledge into one page
  Watches        — was Programs
  Digests        — was Inbox
  Tasks          — stays (renamed labels)
  Settings       — stays

  Power User (collapsed):
  Activities     — was Jobs
  Diagnostics    — was inside Settings
```

### Page Details

**Home (new)** — replaces landing/onboarding split
- Latest digest summary card
- Active watches with status indicators
- Open to-dos with quick-complete
- Library stats
- "What's on your mind?" chat entry

**Library (merged)** — replaces Memory + Knowledge
- Tabs: Memories / Documents / Findings
- Unified search bar at top
- Provenance shown per item (chat, research, upload, correction)

**Watches** — replaces Programs
- Card per watch: title, cadence, last/next run, status
- Natural language create: "What do you want to keep track of?"
- Detail: linked digests, findings, to-dos

**Digests** — replaces Inbox
- Feed of cards: date, type (daily/watch), summary
- Detail: full digest, sources panel, inline correction
- Quality rating

**Tasks** — mostly stays
- "Saved Move" → "To-Do"
- Links to originating Digest and Watch
- Suggested to-dos section

### Onboarding (simplified)
1. "Welcome to pai — your second brain that watches things for you"
2. LLM provider setup
3. "Tell me something about yourself" → first memory
4. "What would you like me to keep track of?" → first watch
5. Home dashboard

## Agent Harness

Every agent follows: **Plan → Execute → Reflect → Ingest**

**Plan:** Agent receives goal + Library context, writes step-by-step plan with budget (max tokens, max tool calls, max time).

**Execute:** Agent runs plan, calling tools, collecting structured results. Errors retried once per tool call.

**Reflect:** Agent evaluates output quality and completeness. Confidence < 0.5 triggers second pass or escalation.

**Ingest:** Structured findings → Library. Key facts → new Memories. Sources → linked Documents. All with provenance chain.

### Research Depth Levels

| Level | When | Depth |
|---|---|---|
| Quick scan | Daily digest, low-priority watch | 1 agent, 2-3 sources, summary |
| Standard | Active watch, user-triggered | 2-3 agents, 5-8 sources, structured findings |
| Deep dive | "Go deep" request, high-value watch | Full swarm (3-5 agents), 10+ sources, cross-reference |

### Research Compounding

- First run: broad scan, establish baseline
- Subsequent runs: delta-focused ("What changed?")
- Findings accumulate in Library
- Agent reads previous findings before planning

### Agent Roles

| Current | New Name | Role |
|---|---|---|
| plugin-assistant | Assistant | Chat agent, Library-backed context |
| plugin-research (generic) | Researcher | General web research |
| plugin-research (flight) | Flight Scout | Flight/travel domain |
| plugin-research (stock) | Market Scout | Stock/crypto domain |
| plugin-curator | Librarian | Memory health, dedup, contradictions |
| plugin-swarm | Team | Parallel agent coordinator |
| (new) | Digest Writer | Composes digests from findings + memories |

## Data Flow — How Knowledge Compounds

```
User asks question in Chat
  → Assistant answers using Library search
  → Conversation distilled into Library (memories)

User creates Watch ("track GPU prices")
  → Watch Domain schedules recurring research
  → Research agents run (plan → execute → reflect)
  → Findings ingested into Library as ResearchFindings
  → Digest Domain pulls findings + memories → generates Digest
  → User reads Digest, corrects recommendation
  → Correction flows back to Library (memory updated)
  → Next Digest is better

User uploads a PDF
  → Library ingests, chunks, embeds
  → Available to all Digests, Watches, Chat

User learns a URL
  → Library ingests with TTL
  → Research agents reference it
  → Digests cite it as Source
```

## Phased Roadmap

### Phase 1: Foundation — Library & Language (weeks 1-6)

**Goal:** Unified knowledge layer + product language rename.

1. Create `library` package — merge `core/memory` + `core/knowledge` + `plugin-curator`
2. Add `ResearchFinding` entity with schema, storage, embeddings
3. Build unified search across memories, documents, findings
4. Ingestion pipelines: research → Library, correction → Library, chat → Library
5. Rename all user-facing language (UI labels, API responses, CLI output, docs)
6. New API routes (`/api/library/*`) with 301 redirects from old paths
7. Merged Library UI page with three tabs + unified search
8. Agent harness module in core (`plan → execute → reflect → ingest`)

9. Update PRODUCT-CHARTER.md, PRIMITIVES.md, ARCHITECTURE.md, ARCHITECTURE-BOUNDARIES.md for Library + language changes

**Ships:** Users see "Library" instead of separate Memory/Knowledge. Search works across everything. Research findings persist and compound.

### Phase 2: Watches & Deeper Research (weeks 5-9)

**Goal:** Watches become first-class with smarter scheduling and deeper research.

1. Create `watches` package — merge `plugin-schedules` + programs runtime
2. Rename Programs → Watches in UI, API, CLI
3. Signal-change detection — skip digest if nothing meaningful changed
4. Research depth levels (quick/standard/deep)
5. Research builds on previous findings (delta-focused)
6. Watch templates (price watch, news watch, competitor watch)
7. Watch detail page showing linked digests + findings + to-dos
8. All research agents adopt agent harness pattern

**Ships:** Watches in plain language, deeper research each run, no spam digests.

### Phase 3: Digests & Feedback Loop (weeks 8-12)

**Goal:** Digests become sharp, traceable, and self-improving.

1. Create `digests` package — merge `plugin-research` + briefing worker + inbox
2. Rename Inbox → Digests in UI, API, CLI
3. Digest Writer agent with harness pattern
4. Source tracing UI — click any claim to see backing data
5. Inline correction → Library writeback
6. Digest quality rating
7. Feedback loop: ratings + corrections influence next digest
8. Auto-suggest to-dos from recommendations

**Ships:** Digests cite sources, corrections stick, quality improves over time.

### Phase 4: Tasks & Home Dashboard (weeks 11-14)

**Goal:** Follow-through connected, new users land somewhere useful.

1. Rename Saved Move/Action → To-Do
2. To-dos linked to Digest and Watch
3. Completion triggers update Watch context
4. Home dashboard: latest digest, active watches, open to-dos, library stats
5. Simplified onboarding flow
6. Updated CLI commands and MCP tools with new names + deprecation shims
7. Final docs consistency pass (each phase already updates docs incrementally)

**Ships:** Complete product experience. Watch → Research → Library → Digest → To-Do → Watch.

### Post-Launch Enhancements

- Watch marketplace (share/import templates)
- Telegram delivery with new language
- Library import/export (Notion, Readwise, Pocket)
- Digest scheduling preferences
- Multi-user support
- Mobile-responsive UI pass

### Timeline

```
Phase 1: Library & Language     ██████████████  weeks 1-6
Phase 2: Watches & Research       ████████████  weeks 5-9
Phase 3: Digests & Feedback         ██████████  weeks 8-12
Phase 4: Tasks & Dashboard            ████████  weeks 11-14
```

Phases overlap slightly — Watch work can start before Library is 100% complete since Library API stabilizes early.

## Database Migration Strategy

The existing SQLite database has tables for beliefs, episodes, knowledge, briefings, jobs, etc. This restructure does NOT rename tables — internal schema stays stable. Changes:

### Existing Tables (no rename, no migration needed)

| Table | Domain | Notes |
|---|---|---|
| `beliefs`, `belief_embeddings`, `belief_episodes`, `belief_changes`, `belief_links`, `beliefs_fts` | Library (memories) | No change — "belief" stays as internal schema name |
| `episodes`, `episode_embeddings` | Library (memories) | No change |
| `knowledge_sources`, `knowledge_chunks`, `knowledge_chunks_fts` | Library (documents) | No change |
| `briefings`, `brief_beliefs` | Digests | No change — "briefing" stays as internal schema name |
| `scheduled_jobs` | Watches | No change — "scheduled_job" stays internal |
| `background_jobs`, `research_jobs` | Digests (research) | No change |
| `swarm_jobs`, `swarm_agents`, `swarm_blackboard` | Shared (swarm) | No change |
| `tasks`, `goals` | Tasks | No change |
| `threads`, `thread_messages` | Chat | No change |
| `auth_owners`, `auth_refresh_tokens` | Auth | No change |
| `telemetry_spans`, `learning_watermarks`, `learning_runs` | Telemetry | No change |
| `artifacts` | Shared | No change |

### New Tables (Phase 1 migration)

```sql
-- ResearchFinding: structured output from research agents
research_findings (
  id TEXT PRIMARY KEY,
  watch_id TEXT REFERENCES scheduled_jobs(id),  -- linked Watch
  digest_id TEXT REFERENCES briefings(id),       -- linked Digest
  goal TEXT NOT NULL,                            -- research goal
  domain TEXT,                                   -- flight, stock, general, etc.
  summary TEXT NOT NULL,                         -- human-readable summary
  structured_data TEXT,                          -- JSON: domain-specific structured output
  confidence REAL DEFAULT 0.7,                   -- agent self-assessed confidence
  agent_name TEXT,                               -- which agent produced this
  depth_level TEXT DEFAULT 'standard',           -- quick, standard, deep
  previous_finding_id TEXT,                      -- links to prior finding for delta tracking
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
)

-- Embedding for semantic search across findings
research_finding_embeddings (
  finding_id TEXT PRIMARY KEY REFERENCES research_findings(id),
  embedding TEXT NOT NULL
)

-- FTS5 for text search
research_findings_fts (content from research_findings: summary)

-- Digest quality ratings
digest_ratings (
  id TEXT PRIMARY KEY,
  digest_id TEXT REFERENCES briefings(id),
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  feedback TEXT,
  created_at TEXT DEFAULT (datetime('now'))
)
```

### Principle

Internal table names are stable — the rename is a **presentation layer concern**. API responses and UI labels translate `belief` → "memory", `briefing` → "digest", `scheduled_job` → "watch". No data migration needed for existing users.

## Cross-Domain Orchestration

### Watch → Research → Library Flow

The Watch domain owns scheduling and triggers. The Digest domain owns research execution. The Library domain owns storage. They interact through **domain APIs, not shared storage.**

```
Watch.scheduler detects due Watch
  → calls Digests.runResearch(watchId, goal, depth, previousFindings)
    → Digest domain runs research agents via Agent Harness
    → Agents produce structured ResearchFindings
    → Digest domain calls Library.ingestFindings(findings)
    → Digest domain calls Library.extractMemories(findings)
    → Digest domain composes Digest from Library.search() results
  → Watch.scheduler records lastEvaluatedAt
```

### Correction Flow Ownership

- **Digest domain** owns the correction UI and API (`POST /api/digests/:id/correct`)
- **Digest domain** parses the correction, identifies affected claims
- **Digest domain** calls `Library.correctMemory(beliefId, correction)` for each affected memory
- **Library domain** owns the belief lifecycle: invalidation, replacement, supersession chain

Domains interact through exported TypeScript functions (same process), not HTTP. The boundary is the module interface, not a network boundary.

## MCP Tool Migration

### Tool Rename Mapping

| Current MCP Tool | New MCP Tool | Deprecation |
|---|---|---|
| `remember` | `library-remember` | Old name works for 2 minor versions, logs deprecation warning |
| `recall` | `library-search` | Same |
| `memory-context` | `library-context` | Same |
| `beliefs` | `library-memories` | Same |
| `forget` | `library-forget` | Same |
| `memory-stats` | `library-stats` | Same |
| `memory-synthesize` | `library-synthesize` | Same |
| `knowledge-learn` | `library-learn-url` | Same |
| `knowledge-search` | `library-search` (merged with recall) | Same |
| `knowledge-sources` | `library-documents` | Same |
| `knowledge-forget` | `library-forget-document` | Same |
| `task-list` | `tasks-list` | Same |
| `task-add` | `tasks-add` | Same |
| `task-done` | `tasks-done` | Same |
| `task-edit` | `tasks-edit` | Same |
| `task-reopen` | `tasks-reopen` | Same |
| `goal-list` | `goals-list` | Same |
| `goal-add` | `goals-add` | Same |
| `goal-done` | `goals-done` | Same |

**New tools added:**
- `watches-list` — list active watches
- `watches-create` — create a watch
- `digests-latest` — get latest digest
- `library-findings` — search research findings

### Deprecation Strategy

Old tool names continue to work for 2 minor versions after rename. They log a deprecation warning in the MCP response. After deprecation period, old names return an error with the new name in the message.

## Telegram Command Migration

| Current Command | New Command | Notes |
|---|---|---|
| `/briefs` | `/digests` | List recent digests |
| `/programs` | `/watches` | List active watches |
| `/action` | `/todo` | Create to-do |
| `/done` | `/done` | Complete to-do (stays) |
| `/correct` | `/correct` | Correct a digest claim (stays) |
| `/start` | `/start` | Onboarding (stays) |
| `/help` | `/help` | Help text updated |
| `/clear` | `/clear` | Clear chat (stays) |
| `/tasks` | `/tasks` | List to-dos (stays) |
| `/memories` | `/library` | Search library |
| `/jobs` | `/activities` | List background activities |
| `/research` | `/research` | Trigger research (stays) |

Push loop for daily/Watch digest delivery uses new language in message templates.

## ResearchFinding Entity Schema

```typescript
interface ResearchFinding {
  id: string;                    // nanoid
  watchId?: string;              // linked Watch (null for ad-hoc research)
  digestId?: string;             // linked Digest that consumed this finding
  goal: string;                  // research goal / question
  domain: 'general' | 'flight' | 'stock' | 'crypto' | string;
  summary: string;               // human-readable summary of findings
  structuredData?: {             // domain-specific structured output
    [key: string]: unknown;      // e.g., { prices: [...], cheapest: {...} } for flights
  };
  sources: Array<{              // external sources consulted
    url: string;
    title: string;
    fetchedAt: string;
    relevance: number;           // 0-1 how relevant this source was
  }>;
  confidence: number;            // 0-1 agent self-assessed confidence
  agentName: string;             // which agent produced this
  depthLevel: 'quick' | 'standard' | 'deep';
  previousFindingId?: string;    // links to prior finding for delta tracking
  delta?: {                      // what changed since previous finding
    changed: string[];           // human-readable list of changes
    significance: number;        // 0-1 how significant the changes are
  };
  createdAt: string;
  updatedAt: string;
}
```

**How it differs from existing entities:**
- Unlike a **Belief** (memory): a Finding is a snapshot of external research, not an internalized user preference or fact. Findings decay faster and are replaceable by newer findings.
- Unlike a **Knowledge Chunk**: a Finding is structured and agent-produced with provenance. Chunks are raw text extracted from documents.
- Findings can be **promoted to Memories** when the agent or user confirms a finding as durable knowledge.

## Agent Harness Implementation

The Agent Harness wraps Vercel AI SDK's `generateText`/`streamText` — it does not replace them.

```typescript
interface AgentHarness {
  // Wraps a standard AI SDK agent call with discipline
  run(options: {
    goal: string;
    context: LibrarySearchResult[];     // pre-loaded from Library
    previousFindings?: ResearchFinding[]; // for delta research
    budget: {
      maxTokens: number;
      maxToolCalls: number;
      maxDurationMs: number;
    };
    depth: 'quick' | 'standard' | 'deep';
    tools: Record<string, Tool>;
    model: LanguageModel;
  }): Promise<AgentResult>;
}

interface AgentResult {
  plan: string[];                // steps the agent planned
  findings: ResearchFinding[];   // structured outputs
  reflection: {
    confidence: number;          // 0-1 self-assessment
    completeness: string;        // what was/wasn't covered
    suggestSecondPass: boolean;  // agent recommends going deeper
  };
  usage: {
    tokensUsed: number;
    toolCallsUsed: number;
    durationMs: number;
  };
}
```

**Implementation:** Phase 1 builds the harness as a utility in `core/agent-harness/`. It's a wrapper function, not a framework. Existing agents are migrated incrementally — the assistant agent stays on raw AI SDK calls initially, research agents adopt the harness in Phase 2.

## Rollback & Feature Flag Strategy

Each phase ships behind a **route-level feature flag** in the config:

```json
{
  "features": {
    "libraryDomain": true,      // Phase 1: enables /api/library/* routes
    "watchesDomain": false,     // Phase 2: enables /api/watches/* routes
    "digestsDomain": false,     // Phase 3: enables /api/digests/* routes
    "homeDashboard": false      // Phase 4: enables new Home page
  }
}
```

- Old routes continue to work regardless of feature flags
- New routes only activate when the flag is on
- UI checks flags to show old or new navigation
- Flags are removed one version after the phase ships stable
- If a phase is delayed, the system works with any combination of flags

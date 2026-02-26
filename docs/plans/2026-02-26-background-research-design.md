# Background Agent + Research — Design

## Goal

Enable the Personal Assistant to delegate deep research tasks to a background sub-agent that runs autonomously, produces a structured report, and delivers it to the Inbox and originating chat thread.

## Architecture

Chat-triggered. User asks for research in chat → assistant calls `research_start` tool → background research agent runs multi-step search/read/synthesize loop → report delivered to Inbox + chat thread summary. Sets the pattern for future sub-agents (monitoring, digests).

## Data Model

### `research_jobs` table (plugin-research)

```sql
CREATE TABLE research_jobs (
  id TEXT PRIMARY KEY,
  thread_id TEXT,
  goal TEXT NOT NULL,
  status TEXT NOT NULL,        -- pending | running | done | failed
  budget_max_searches INTEGER DEFAULT 5,
  budget_max_pages INTEGER DEFAULT 3,
  searches_used INTEGER DEFAULT 0,
  pages_learned INTEGER DEFAULT 0,
  steps_log TEXT,              -- JSON array of step descriptions
  report TEXT,                 -- final report (markdown)
  briefing_id TEXT,            -- link to inbox briefing
  created_at TEXT NOT NULL,
  completed_at TEXT
);
```

### `briefings` table modification

Add `type TEXT DEFAULT 'daily'` column. Research reports stored with `type: 'research'`.

## Shared Background Job Tracker

Replace crawl-specific `activeCrawls` Map with generic in-memory tracker in core:

```typescript
interface BackgroundJob {
  id: string;
  type: "crawl" | "research";
  label: string;
  status: "running" | "done" | "error";
  progress: string;
  startedAt: string;
  error?: string;
  result?: string;
}

export const activeJobs = new Map<string, BackgroundJob>();
```

Existing crawl jobs migrate to this. `knowledge_status` tool renamed to `job_status`.

## Research Agent Plugin

**Package:** `packages/plugin-research`

**System prompt:** Instructs the agent to plan research steps, execute searches, read key pages, and produce a structured report with summary, key findings, and sources.

**Tools:**
- `web_search` — reused from plugin-assistant
- `learn_from_url` — fetch and read pages (reuse `fetchPageAsMarkdown`)
- `knowledge_search` — check existing knowledge before searching

No memory tools. Research agent produces a report and is done.

**Execution:** `generateText` with `stepCountIs(5)` for multi-step tool usage.

**Budget enforcement:** Tools track usage against job budget. Return "Budget exhausted — synthesize findings now" when limits hit.

## Integration Flow

1. User says "research X" in chat
2. Assistant calls `research_start` tool
3. Tool creates `research_jobs` row (pending), kicks off `runResearchInBackground()`, returns "I've started researching that. I'll post findings to your Inbox when done."
4. Background: sets status to running, calls `generateText` with research agent's prompt + tools + goal
5. Agent loops: plan → search → read pages → synthesize (budget-limited)
6. On completion: stores report, creates Inbox briefing (type: research), appends summary to originating chat thread, sets status to done
7. On failure: sets status to failed, posts error to chat thread

## UI Changes

- **Inbox:** Research briefings render with "Research Report" header, reuse existing card components. Distinguished by `type: 'research'`.
- **Chat:** Tool card for `research_start` shows "Research started" indicator. Results appear as normal assistant messages.
- **No new pages or navigation items.**

## Package Structure

**New:** `packages/plugin-research/`
- `src/index.ts` — Plugin definition, system prompt
- `src/research.ts` — `runResearchInBackground()`, budget-limited tools, report generation
- `test/research.test.ts` — Budget enforcement, report creation, job lifecycle

**Modified:**
- `packages/core` — Shared `BackgroundJob` type + `activeJobs` Map
- `packages/plugin-assistant` — Add `research_start` tool, migrate crawl to shared jobs, rename `knowledge_status` → `job_status`
- `packages/server` — Register plugin-research, add `type` to briefings migration
- `packages/ui` — Inbox handles research briefings, tool card for `research_start`

## Out of Scope (v1)

- Sandbox/container execution
- Headless browser
- Scheduled/recurring jobs
- Dedicated research UI page
- Progress polling UI

## Testing

- Research agent execution with mocked LLM + tools
- Budget enforcement (search/page limits)
- Report → briefing creation
- Thread reply on completion
- Job status tracking (shared tracker)
- Crawl migration to shared jobs (backward compat)

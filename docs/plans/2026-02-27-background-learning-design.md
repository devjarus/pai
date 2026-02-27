# Background Learning Worker — Design

## Goal

A passive, always-on background worker that continuously learns from user activity — chat threads, research reports, knowledge sources, and task completions — to grow memory autonomously without requiring explicit user interaction.

## Problem

The current `afterResponse` hook only extracts facts from individual chat messages in real-time. Signals that fall through:

- Cross-conversation patterns (user asks about the same topic across threads)
- Research report findings (reports sit in DB, key facts never become beliefs)
- Knowledge page insights (pages are learned but don't influence memory)
- Task completion patterns (system doesn't learn from what user accomplishes)
- Recurring questions and topic interests

## Architecture

Single function `runBackgroundLearning(ctx)` in the server package, alongside `generateBriefing`. Registered on a 2-hour `setInterval` timer in `server/src/index.ts`. No new package — server infrastructure.

**Approach: Hybrid** — cheap SQL signal gathering, one focused LLM call with concentrated context.

## Watermark Table

```sql
CREATE TABLE IF NOT EXISTS learning_watermarks (
  source TEXT PRIMARY KEY,
  last_processed_at TEXT NOT NULL
);
```

Sources: `threads`, `research`, `knowledge`, `tasks`.

First run initializes watermarks to "now minus 24 hours" for initial catch-up.

## Signal Gathering (Phase 1 — SQL only, no LLM)

1. **Chat threads** — `thread_messages` newer than `threads` watermark. Group by thread, last 20 user messages per thread, max 3 most recent threads.

2. **Research reports** — `research_jobs` with `status = 'done'` and `completed_at` newer than `research` watermark. Take `goal` + first 500 chars of `report`.

3. **Completed tasks** — `tasks` with `status = 'done'` and `completed_at` newer than `tasks` watermark. Title + priority.

4. **New knowledge** — `knowledge_sources` with `fetched_at` newer than `knowledge` watermark. Title + URL + first chunk content (200 chars).

**Early exit:** If all four signal lists are empty, update watermarks and return. No LLM call.

## LLM Extraction (Phase 2 — one call)

Single prompt with all gathered signals. Extracts:

- **Personal facts** — About the user or specific people
- **Topic interests** — Subjects user engages with repeatedly or deeply
- **Procedural patterns** — How user works, recurring workflows, preferred tools
- **Recurring questions** — Things asked about frequently across threads

Output: JSON array of `{ fact, factType, importance, subject }` — same shape as `extractBeliefs()` in core.

**Budget:** Max 15 facts per run.

## Belief Storage

Feed extracted facts into existing `remember(text, llm, storage)` from core. This provides:

- Semantic deduplication (no duplicate beliefs)
- Contradiction detection (handles conflicts)
- Episode creation with `context: "background-learning"` (audit trail)
- Embedding generation (searchable)

## Logging

All logging via `createLogger()`. No PII in any log message.

- **info:** Worker start/stop, signal counts (e.g., "12 messages across 2 threads"), facts extracted count, beliefs created/reinforced count, run duration in ms
- **debug:** Fact type breakdown (e.g., "2 topic_interest, 1 procedural"), watermark updates, LLM call duration
- **error:** LLM failures, JSON parse errors, DB errors
- **Never logged:** Message content, belief statements, usernames, thread titles, research goals, task titles, URLs — counts and IDs only

## Timer & Lifecycle

- Interval: 2 hours (7,200,000 ms)
- First run: 5 minutes after server start
- Registered in `server/src/index.ts` alongside briefing timer
- Cleaned up on graceful shutdown

## Error Handling

- LLM health check before calling. Skip if LLM is down.
- Entire run wrapped in try/catch. Log errors, don't crash.
- Watermarks only updated after successful processing per source.
- Unparseable LLM JSON: log and skip, no retry.

## Out of Scope (YAGNI)

- No UI page (logs only)
- No configurable schedule (hardcoded 2h)
- No per-source enable/disable
- No "force run now" API
- No cross-belief pattern mining
- No deep knowledge chunk analysis beyond titles

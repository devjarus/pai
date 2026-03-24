# Design Note: State-First Recurring Reports

**Date:** 2026-03-21
**Status:** Implemented (v1)

## Decision

Make digest generation driven by structured state deltas rather than raw JSON dumps + prose summaries of previous briefs. Each digest cycle now compounds on the last through computed diffs, not paraphrases.

## Why

The prior approach had three problems:

1. **Finding deltas never computed.** The schema had `delta` and `previous_finding_id` columns on `research_findings`, but they were never populated. Chained findings existed in name only.
2. **Previous briefs injected as prose.** `summarizePreviousBriefing()` turned structured sections into a flat string, losing the structured signals (what changed, what was recommended, what actions were taken).
3. **No signal hash on daily briefs.** Research briefs computed `signal_hash` via `buildBriefSignalHash()`, but daily briefs did not. There was no way to detect whether a daily digest's content materially changed between cycles.

## Changes

### 1. Finding delta computation (`packages/library`)

- Added `computeFindingDelta(previousSummary, currentSummary)` — deterministic sentence-level diff returning `{ changed: string[], significance: number }`.
- `ingestResearchResult()` now auto-computes the delta when `previousFindingId` is provided but `delta` is not. Callers can still pass an explicit delta to override.
- No LLM involved — uses sentence splitting + normalized string comparison.

### 2. Briefing state delta (`packages/server`)

- Added `BriefingDelta` interface capturing: new findings (with deltas), changed insights, new/corrected beliefs, completed actions.
- Added `buildBriefingDelta(storage, sinceTimestamp)` — queries all domains for changes since the last digest.
- The delta is formatted into a structured `--- STATE DELTA ---` section injected into the LLM prompt alongside (not replacing) the existing raw context. Raw state remains for grounding; the delta provides the "what changed" signal.
- `sinceTimestamp` is derived from the last daily briefing's `generated_at`, falling back to 24 hours ago.

### 3. Signal hash for daily briefs (`packages/server`)

- `generateBriefing()` now calls `buildBriefSignalHash(parsed, { source: "daily" })` after generating sections.
- Hash is stored in the existing `signal_hash` column via `UPDATE briefings SET sections = ?, status = 'ready', signal_hash = ?`.
- Same deterministic SHA-256 hash already used by research and swarm briefs.
- Enables future feature-flagged skip: if delta hash is unchanged, generation can be skipped.

## What We Did NOT Do (v1)

- **No task/action outcome tracking** — task feature is barely used.
- **No new tables or packages** — all changes wire existing schema.
- **No per-section feedback** — correction_hook remains the only feedback channel.
- **No LLM-computed deltas** — deterministic string diff is sufficient for v1.
- **No distillation/reflection jobs** — compounding already handled by the existing weekly insight worker.

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Delta prompt section bloats context | Capped at 15 findings, 10 insights, 10 beliefs |
| Sentence splitting too naive for complex prose | Normalized comparison handles whitespace/case; can upgrade to word-level diff later |
| `buildBriefingDelta` queries multiple tables | All queries are indexed and bounded; no full-table scans |

## Validation

1. Run a research cycle → verify `delta` populated on the finding row
2. Generate two daily digests → verify second includes `STATE DELTA` section
3. Check `signal_hash` populated on daily briefings via DB query
4. `pnpm verify` — all 1168 tests pass, 69 test files

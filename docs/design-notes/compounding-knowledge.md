# Design Note: Compounding Knowledge System

**Date:** 2026-03-21
**Status:** Implemented

## Decision

Build a compounding knowledge layer that synthesizes individual research findings into durable topic insights, separate from beliefs (which are about the user) and knowledge sources (which expire).

## Why

Individual research findings are snapshots — "BTC dropped 5% today." Over multiple cycles, these snapshots contain trends and patterns that are more valuable than any single finding. Without synthesis, the system forgets what it learned each cycle and starts fresh.

Beliefs are wrong for this — they're about the user's identity/preferences, not about topics. Knowledge sources expire (7-14 day TTL). Findings persist but aren't synthesized.

## Architecture

```
research_findings (per-run snapshots)
    ↓ weekly compounding worker
topic_insights (synthesized patterns across cycles)
    ↓ feeds into
daily digest (via knowledgeSearch)
weekly digest (directly)
Memory page UI (insights section)
```

### Storage: `topic_insights` table

| Column | Purpose |
|--------|---------|
| `watch_id` | Which watch produced this insight |
| `topic` | Human-readable topic name |
| `insight` | Synthesized understanding (under 40 words) |
| `confidence` | 0.7-0.95, increases with each compounding cycle |
| `cycle_count` | How many research cycles contributed |
| `sources_json` | Finding IDs that fed into this insight |

No TTL — insights persist as long as the watch is active. Deleted when watch is deleted.

### Quality Gates

1. **Minimum 3 findings** required before compounding runs for a watch
2. **Meta-filter** — regex rejects insights about search failures, tool limitations, data gaps
3. **Confidence floor** — insights below 0.5 confidence are discarded
4. **Length minimum** — insights under 5 words are discarded
5. **LLM prompt** explicitly forbids self-referential insights

### What the Quality Score Measures

| Dimension | Metric | Target |
|-----------|--------|--------|
| Memory utilization | % of beliefs ever accessed | >60% |
| Reinforcement rate | % of beliefs with confidence >0.6 | >30% |
| Feedback activity | Digest ratings + corrections | >20% |
| Knowledge growth | Insights + findings count | >30% |

## Trade-offs

- **No embeddings on insights** — searched by watch_id, not semantic. Could add later if cross-topic search is needed.
- **Weekly cadence** — could be daily, but weekly avoids noise from small deltas. The timer skips if no new beliefs were created.
- **Topic name from watch title** — not ideal (some watch titles are long questions). Could be LLM-derived but adds another call.
- **No reflection/distillation job yet** — the schema supports it (cycle_count, sources_json) but the worker just synthesizes, doesn't distill insights down further. Future work.

## Future

- Distillation: merge overlapping insights across watches (e.g., 3 H4 visa watches → 1 consolidated view)
- Cross-topic insights: "your crypto tracking and immigration timeline are both time-sensitive — prioritize"
- Insight decay: lower confidence when no new findings confirm the insight for 30+ days

# Memory Engine Comparison: PAI vs Super Memory

## Feature Comparison

| Feature | Super Memory | PAI | Status |
|---|---|---|---|
| Knowledge Extraction | LLM-based extraction with selective storage | `extractBeliefs()` — classifies as factual/preference/procedural/architectural, importance 1-10, subject identification | ✅ Have |
| Temporal Reasoning | Tracks how information changes over time | Timestamps + supersession chains, but no explicit "this was true then, not now" reasoning | ⚠️ Partial |
| Multi-session Reasoning | Pulls knowledge across past sessions | `retrieveContext()` — hybrid semantic + FTS search across all beliefs/episodes/knowledge | ✅ Have |
| Preferences & Actions | Tracks user preferences and actions | Typed beliefs (preference, factual, procedural, architectural) + episodes with actions/outcomes + `getCorePreferences()` | ✅ Have |
| Assistant Awareness | Tracks what the AI previously said for consistency | Thread history persisted, `afterResponse` sees both sides, but no cross-session commitment tracking | ⚠️ Partial |
| Hybrid Search | High-level memories with raw fallback | Embedding similarity + FTS fallback, unified beliefs + knowledge chunks + episodes | ✅ Have |
| Selective Forgetfulness | Selective about what to keep, avoids data dumping | Importance scoring, confidence decay via stability, `pruneBeliefs()`, curator agent | ✅ Have |
| Update Edges | Prior/newer versions with invalidation | `superseded_by`/`supersedes` links, `checkContradiction()`, history via `belief_changes` | ✅ Have |
| Prompt Caching | Static-first message ordering for 99% cache hits | Not implemented — messages built fresh each time | ❌ Missing |

## Gaps to Address

1. **Temporal Reasoning** — Add explicit time-aware queries (e.g., "what did I think about X last month?" vs now). Currently only implicit via supersession chains.

2. **Assistant Awareness** — Track assistant commitments/promises across sessions so it stays consistent (e.g., "I recommended Y last time" or "I said I'd follow up on Z").

3. **Prompt Caching** — Order message arrays with static content (system prompt, core preferences, stable memories) first and dynamic content (recent history, retrieved context) last to maximize LLM provider cache hits. Could significantly reduce latency and token costs.

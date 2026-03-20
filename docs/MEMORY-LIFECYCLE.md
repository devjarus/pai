# Memory Lifecycle

This document maps the full lifecycle of beliefs in the Personal AI memory system, from ingestion through decay and removal. All diagrams and thresholds are derived from the source code in `packages/core/src/memory/`.

## 1. Ingestion: raw and structured memory writes

`remember()` handles raw text observations. It creates an episode, extracts a structured belief via LLM, and runs deduplication/contradiction logic before persisting. Memory extraction from conversations is handled solely by the background learning worker (runs every 2 hours via `workers.ts`), not inline during chat responses.

`rememberStructured()` is the sibling path for callers that already have `{ statement, factType, importance, subject }` from an earlier extraction step. It still creates an episode and stores episode embeddings, but it skips `extractBeliefs()` and writes the structured claim directly through the same downstream belief-processing pipeline.

```mermaid
flowchart TD
    A["remember(text)"] --> B["createEpisode(action: text)"]
    B --> C["Promise.all (parallel)"]
    C --> D["llm.embed(text) -> storeEpisodeEmbedding()"]
    C --> E["extractBeliefs(llm, text)"]

    E --> E1["LLM chat: extract JSON array (up to 3 facts)\n[{fact, factType, importance, subject, relatedTo, temporal}]"]
    E1 --> E2["Strip markdown fences, parse JSON"]
    E2 --> E3["Validate factType in {factual, preference, procedural, architectural}"]
    E3 --> E4["Clamp importance 1-10, normalize subject to lowercase"]
    E4 --> E4a["Enrich statement:\n[related: entity] [when: ISO date]"]
    E4a --> E5["On parse failure: raw text as 'factual', importance=5, subject='owner'"]

    D --> F["For each extracted fact (up to 3):\nprocessNewBelief(fact, factType, episodeId, importance, subject)"]
    E --> F

    F --> F0["resolveSubjectAlias(storage, subject)\ne.g. 'suraj' → 'owner'"]
    F0 --> G["Try llm.embed(statement)"]
    G -->|Embedding failed| H["CREATE belief at confidence 0.6\nSkip dedup entirely"]
    G -->|Embedding OK| I["findSimilarBeliefs(embedding, limit=5)"]

    I --> J{Top similarity?}
    J -->|"> 0.85"| K["REINFORCE existing belief\n+0.1 confidence, reset updated_at\nLink episode to existing belief"]
    J -->|"0.70 - 0.85"| L["Check top 3 in grey zone"]
    J -->|"< 0.70 or no match"| M["CREATE new belief"]

    L --> L1{"Any of top 3\nREINFORCEMENT?"}
    L1 -->|Yes| K
    L1 -->|No| L2["checkContradiction(llm, statement, top 3)"]
    L2 --> N{Contradiction found?}
    N -->|No| M
    N -->|Yes| O["countSupportingEpisodes(oldBelief)"]

    O --> P{">= 3 episodes?"}
    P -->|Yes| Q["WEAKEN old belief\nconfidence -= 0.2 (min 0.1)\nCREATE new belief (coexist)\nLink supersession"]
    P -->|No| R["INVALIDATE old belief\nstatus = 'invalidated'\nCREATE new belief (replace)\nLink supersession"]

    M --> S["storeEmbedding(beliefId, embedding)"]
    S --> T["Link belief to episode"]
    T --> U["Find neighbors: similarity 0.40-0.85"]
    U --> V["linkBeliefs() to top 3 neighbors\n(Zettelkasten-style)"]

    style K fill:#2d6a2d,color:#fff
    style Q fill:#8b6914,color:#fff
    style R fill:#8b1a1a,color:#fff
    style M fill:#1a3d8b,color:#fff
    style H fill:#555,color:#fff

```

Structured producers enter after episode creation with normalized `{ statement, factType, importance, subject }` input. They reuse `processNewBelief()` and all contradiction/provenance rules, but they do not pay for a second extraction call.

### Subject alias resolution

`processNewBelief()` calls `resolveSubjectAlias(storage, subject)` at the start to normalize subject names before dedup. Aliases are stored in the `subject_aliases` table (e.g., `"suraj"` → `"owner"`). This ensures that beliefs about the same entity converge regardless of how the subject was originally phrased.

### `checkContradiction()` detail

The contradiction checker sends a batched prompt to the LLM with the top 3 candidate beliefs from the 0.70-0.85 similarity range. The LLM replies with a single belief index or `NONE`. Invalid responses (non-numeric, out of range) are treated as `NONE`.

```mermaid
flowchart LR
    A["checkContradiction(newStatement, existingBeliefs)"] --> B{existingBeliefs empty?}
    B -->|Yes| C["return null"]
    B -->|No| D["Build numbered list:\n1. 'belief A'\n2. 'belief B'"]
    D --> E["LLM chat (temperature=0):\n'Do any DIRECTLY contradict?\nReply: 1, 2, ... or NONE'"]
    E --> F{Response}
    F -->|"NONE"| C
    F -->|Valid index| G["return contradicted belief ID"]
    F -->|Invalid| H["Log warning, return null"]
```

## 2. Retrieval: `semanticSearch()` and `recall`

The recall path uses multi-factor scoring to rank beliefs, then traverses the Zettelkasten graph for linked neighbors.

```mermaid
flowchart TD
    A["recall(query)"] --> B["llm.embed(query)"]
    B -->|Embedding OK| C["semanticSearch(embedding, limit, queryText)"]
    B -->|Embedding failed| D["searchBeliefs(query) via FTS5 fallback"]

    C --> E["Load all active belief_embeddings"]
    E --> F["For each belief, compute multi-factor score"]

    F --> G["Score = 0.50 * cosine\n      + 0.20 * importance/10\n      + 0.10 * recency\n      + 0.05 * stability/5\n      + 0.15 * subjectMatch"]

    G --> I["Filter: cosine >= 0.20 threshold"]
    I --> J["Sort by score descending, take top N"]

    J --> K["Graph traversal: top-3 results"]
    K --> L["Batch query belief_links for top-3 IDs"]
    L --> M["Fetch linked beliefs (neighbors)\nScore = parent score * 0.8"]
    M --> N["Combine results + neighbors, limit to N"]

    N --> O["Batch-record access for all returned beliefs:\naccess_count++\nstability += 0.1 (capped at 5.0)\nlast_accessed = now"]

    style G fill:#1a3d8b,color:#fff
```

### Recency calculation

```
recency = exp(-0.023 * daysSinceAccess)
```

This gives an approximately 30-day half-life. A belief accessed today scores 1.0; one accessed 30 days ago scores approximately 0.5.

### Subject-aware boosting

When the query text contains a known subject name (e.g., "Alex"), beliefs tagged with that subject receive `subjectMatch = 1.0` (contributing +0.15 to the score). Beliefs about other subjects get 0.0.

## 3. Maintenance Operations

```mermaid
flowchart TD
    subgraph Reflect
        R1["reflect(storage)"] --> R2["Load up to 200 active beliefs\nwith embeddings"]
        R2 --> R3["Find duplicate pairs:\ncosine >= 0.85"]
        R2 --> R4["Find stale beliefs:\neffectiveConfidence < 0.10"]
        R3 --> R5["Report duplicate clusters"]
        R4 --> R6["Report stale beliefs"]
    end

    subgraph Merge
        MR1["mergeDuplicates(clusters)"] --> MR2["For each cluster:\nSort by effectiveConfidence"]
        MR2 --> MR3["Keep highest-confidence belief (winner)"]
        MR3 --> MR4["Transfer episodes from losers to winner"]
        MR4 --> MR5["Invalidate losers\nSet superseded_by -> winner"]
        MR5 --> MR6["Reinforce winner (+0.1 confidence)"]
    end

    subgraph Synthesize
        S1["synthesize(storage, llm)"] --> S2["reflect(similarityThreshold=0.60)"]
        S2 --> S3["For each cluster (up to 5):"]
        S3 --> S4["LLM extracts one general principle\nfrom related beliefs"]
        S4 --> S5["CREATE synthesized belief\nconfidence=0.8, stability=3.0"]
        S5 --> S6["Embed synthesized belief"]
        S6 --> S7["Link synthesized belief to all source beliefs"]
    end

    subgraph Prune
        P1["pruneBeliefs(threshold=0.05)\nRuns automatically every 24h via workers.ts"] --> P2["Load all active beliefs"]
        P2 --> P3["Filter: effectiveConfidence < threshold"]
        P3 --> P4["Set status='pruned' for each"]
        P4 --> P5["Log 'pruned' change"]
    end

    subgraph AutoDedup ["Scheduled Dedup (24h)"]
        AD1["reflect(similarityThreshold=0.85)"] --> AD2["Find duplicate clusters"]
        AD2 --> AD3["mergeDuplicates(clusters)"]
        AD3 --> AD4["Keep highest-confidence belief\nInvalidate duplicates"]
    end

    subgraph ProfileConsolidation ["Profile Consolidation (24h)"]
        PC1["Group owner preferences by theme\n(style, crypto, news, immigration, research)"] --> PC2["For themes with 3+ beliefs:\nLLM merges into one dense statement"]
        PC2 --> PC3["Create consolidated belief\n(high confidence, stability 3.0)"]
        PC3 --> PC4["Invalidate fragment beliefs"]
    end

    subgraph Decay
        DC1["effectiveConfidence(belief)"] --> DC2["confidence * 0.5^(days / halfLife)"]
        DC2 --> DC3["halfLife = 30 * stability"]
        DC3 --> DC4["stability=1.0 -> 30-day half-life\nstability=3.0 -> 90-day half-life\nstability=5.0 -> 150-day half-life"]
    end

    subgraph Forget
        F1["forgetBelief(beliefId)"] --> F2["Resolve ID (exact or prefix match)"]
        F2 --> F3["Set status='forgotten'\nLog 'forgotten' change"]
    end

    subgraph Consolidate
        C1["consolidateConversation(turns)"] --> C2{">= 4 turns?"}
        C2 -->|No| C3["return null"]
        C2 -->|Yes| C4["LLM summarizes conversation\n(1-3 sentences)"]
        C4 --> C5{Summary is 'NONE'?}
        C5 -->|Yes| C3
        C5 -->|No| C6["createEpisode(summary,\ncontext='conversation-consolidation')"]
        C6 --> C7["Embed and store episode embedding"]
    end
```

## 4. Similarity Thresholds

| Threshold | Value | Context | Behavior |
|-----------|-------|---------|----------|
| Reinforce (merge) | > 0.85 | `processNewBelief` | Incoming belief is merged into the existing one. Existing belief gets +0.1 confidence and reset `updated_at`. No new belief created. |
| Contradiction check | 0.70 - 0.85 | `processNewBelief` | Grey zone. The top 3 similar beliefs in this range are checked. If any is a reinforcement, reinforce. Otherwise the LLM is asked whether the new statement contradicts any of the top 3. If no contradiction, a new belief is created normally. |
| Zettelkasten linking | 0.40 - 0.85 | `processNewBelief` | After creating a new belief, neighbors in this range are linked via `belief_links` (max 3 links). |
| Duplicate detection | >= 0.85 | `reflect` | Used to identify near-duplicate clusters during reflection. |
| Thematic clustering | >= 0.60 | `synthesize` | Used to find thematic clusters for meta-belief synthesis. |
| Semantic search cutoff | >= 0.20 | `semanticSearch` | Cosine similarity floor. Beliefs below this threshold are excluded from search results regardless of other scoring factors. |
| Stale belief | < 0.10 | `reflect` | Beliefs with effective confidence below this are flagged as stale. |
| Prune default | < 0.05 | `pruneBeliefs` | Beliefs with effective confidence below this are set to `pruned` status. Runs automatically every 24h via `workers.ts`. Configurable via `--threshold` when run manually. |
| Contradiction candidates | 0.40 - 0.85 | `findContradictions` | Range used by the curator plugin to find potential contradiction pairs for batch LLM analysis. |
| Episode similarity | > 0.30 | `getMemoryContext`, `retrieveContext` | Episodes must exceed this cosine threshold to be included in context output. |

## 5. Belief Statuses and Transitions

| Status | Description | How it's entered | Can transition to |
|--------|-------------|------------------|-------------------|
| `active` | Live belief, participates in search and context | Default status on creation via `createBelief()` | `invalidated`, `forgotten`, `pruned` |
| `invalidated` | Contradicted or merged away | Contradiction with < 3 supporting episodes, or merged as a duplicate loser | (terminal) |
| `forgotten` | User-initiated soft delete | `forgetBelief()` / `pai memory forget <id>` | (terminal) |
| `pruned` | Decayed below confidence threshold | `pruneBeliefs()` when `effectiveConfidence < threshold` | (terminal) |

```mermaid
stateDiagram-v2
    [*] --> active : createBelief()
    active --> invalidated : Contradiction (< 3 episodes)\nor mergeDuplicates()
    active --> forgotten : User runs 'memory forget'
    active --> pruned : effectiveConfidence < threshold
    active --> active : Reinforced (+0.1 confidence)\nor Weakened (-0.2 confidence)

    note right of invalidated : Terminal. Preserved for\naudit trail and supersession links.
    note right of forgotten : Terminal. Preserves audit trail.
    note right of pruned : Terminal. Removed by decay.
```

## 6. Belief Properties

| Property | Default | Updated by | Description |
|----------|---------|------------|-------------|
| `confidence` | 0.6 | Reinforce (+0.1, cap 1.0), Weaken (-0.2, min 0.1) | Base confidence before decay. |
| `stability` | 1.0 | Access (+0.1, cap 5.0), Synthesize (set to 3.0 for synthesized) | Multiplier for decay half-life. `halfLife = 30 * stability` days. |
| `importance` | 1-10 (from LLM) | Set at creation | LLM-assigned importance. 1-3 trivial, 4-6 useful, 7-9 core, 10 critical. Normalized to 0-1 for scoring. |
| `type` | From LLM extraction | Set at creation | One of: `factual`, `preference`, `procedural`, `architectural`. |
| `subject` | `"owner"` | Set at creation, `backfillSubjects()` | Who the belief is about. Lowercase name or `"owner"`. |
| `origin` | `inferred` | Set at creation/correction/write path | Trust source for the belief: `user-said`, `document`, `web`, `inferred`, or `synthesized`. |
| `freshness_at` | null | Creation, reinforcement, correction, edit | Explicit freshness timestamp separate from `updated_at`, used for trust display and provenance-aware consumers. |
| `correction_state` | `active` | Correction and invalidation flows | Tracks trust lifecycle beyond status: `active`, `confirmed`, `corrected`, `invalidated`. |
| `sensitive` | false | Creation heuristics or explicit write path | Flags beliefs that may contain sensitive inferred material so product surfaces can treat them as lower-trust until confirmed. |
| `access_count` | 0 | `semanticSearch()` batch access recording | Number of times the belief was returned in search results. |
| `last_accessed` | null | `semanticSearch()` batch access recording | Timestamp of last retrieval. Used for recency scoring. |
| `superseded_by` | null | `linkSupersession()` | Points to the newer belief that replaced this one. |
| `supersedes` | null | `linkSupersession()` | Points to the older belief this one replaced. |

## 7. Briefing Surfacing Rules

Not every stored belief is eligible to appear in a Brief.

Brief generation now applies an additional trust and relevance filter before a belief can become a `memory_assumption` or appear in raw brief context:

- only `active` beliefs are eligible
- `sensitive` beliefs are excluded from Brief generation
- beliefs with `correction_state` of `corrected` or `invalidated` are excluded
- only `preference`, `factual`, and `procedural` beliefs are eligible for briefing context
- owner-scoped preferences and procedural beliefs can surface when they are generally useful to how the owner wants updates delivered
- factual beliefs must match the current decision focus
- third-party beliefs only surface when the current Program / Action / Goal / knowledge focus explicitly mentions that subject

The current decision focus is built from active Programs, open tracked follow-through, legacy goals when present, and learned knowledge titles. This keeps the memory system broad while making the Brief surface narrow and trust-safe.

## 8. Provenance

- `belief_episodes` remains the many-to-many link between beliefs and episodes.
- `belief_provenance` adds source-kind links for user chat episodes, learned documents, web-backed research, generated briefs, and other artifacts.
- Corrections create a replacement belief, invalidate the old one, link supersession, and add provenance for the correction episode so later briefs can suppress the old assumption immediately.

## 9. Decay Formula

Effective confidence decays exponentially over time:

```
effectiveConfidence = confidence * 0.5 ^ (daysSinceUpdate / (30 * stability))
```

Examples:
- **stability = 1.0** (default): Half-life of 30 days. After 30 days, a belief at confidence 0.6 decays to 0.3.
- **stability = 3.0** (synthesized beliefs): Half-life of 90 days. Much slower decay for synthesized knowledge.
- **stability = 5.0** (max, reached after 40 accesses): Half-life of 150 days.

Each time a belief is retrieved via `semanticSearch()`, its stability increases by 0.1 (capped at 5.0), following SM-2 spaced repetition principles. Frequently accessed beliefs naturally resist decay.

## 10. Conversation Consolidation

Every conversation chunk (when >= 4 turns) can be consolidated into a summary episode via `consolidateConversation()`. This runs as part of the chat pipeline (triggered every 5th chat turn by the server).

The consolidation flow:
1. Format conversation turns into `User: ... / Assistant: ...` text
2. LLM summarizes into 1-3 sentences (or replies `NONE` for trivial chat)
3. Create an episode with `context = "conversation-consolidation"`
4. Embed the summary for future semantic episode search

Consolidated episodes do **not** create beliefs. They serve as searchable episodic memory that can surface in `getMemoryContext()` and `retrieveContext()`.

## 11. Data Model

```
episodes              1---*  belief_episodes  *---1  beliefs
  |                                                    |
  +-- episode_embeddings                               +-- belief_embeddings
                                                       +-- belief_changes
                                                       +-- belief_links (self-join, Zettelkasten)
                                                       +-- supersedes / superseded_by (self-ref)

subject_aliases  (alias → canonical subject mapping, used by resolveSubjectAlias)
```

All tables live in a single SQLite database (`{dataDir}/personal-ai.db`) with WAL mode and foreign keys enabled. Migrations are tracked in the `_migrations` table.

## Source Files

- `packages/core/src/memory/remember.ts` -- `remember()`, `extractBeliefs()`, `checkContradiction()`, `processNewBelief()`
- `packages/core/src/memory/memory.ts` -- All CRUD, search, reflect, synthesize, merge, prune, decay, export/import
- `packages/core/src/memory/consolidate.ts` -- `consolidateConversation()`
- `packages/core/src/memory/index.ts` -- CLI commands and public API re-exports

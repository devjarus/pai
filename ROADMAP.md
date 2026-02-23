# Roadmap — Central Mind Platform (Product + Architecture)

This roadmap defines the long‑term product direction and the technical architecture needed to scale a local‑first “central mind” across memory, knowledge, and agents.

## North Star
A personal operating system for knowledge and action:
- **Memory** stores stable personal truths and preferences.
- **Knowledge** stores external, verifiable sources.
- **Agents** act in context using shared memory + knowledge.
- **Reasoning** merges both with provenance, confidence, and identity awareness.

Users should feel: “It remembers what matters about me, explains why, and uses verified knowledge to get things done.”

---

## Product Strategy (Long‑Term)

### 1) Identity‑Aware Mind
- Every memory is attached to a **subject** (owner, person, team).
- No cross‑pollution between subjects.
- UI should visibly surface “about: X”.

### 2) Memory vs Knowledge Separation
- Memory = personal truths and preferences.
- Knowledge = external sources and learned pages.
- Retrieval merges both, but **never auto‑promotes knowledge into memory** without user confirmation.

### 3) Multi‑Agent Inside One Mind
- Specialist agents share the same memory core.
- Each agent has clear capability boundaries and safety rules.

### 4) Trust & Provenance
- Every answer includes sources:
  - **Belief** (confidence, subject, last updated)
  - **Knowledge source** (URL + title)

---

## Architecture Direction

### A) Shared Graph Layer (Core)
Introduce a unified graph connecting:
- Beliefs
- Knowledge chunks
- Concepts
- Tasks
- Agents

Edges:
- belief ↔ concept
- chunk ↔ concept
- task ↔ belief
- task ↔ chunk

This becomes the shared reasoning substrate.

### B) Unified Retrieval API
Add `retrieveContext(query)` that:
1. Queries **memory** (belief embeddings + metadata).
2. Queries **knowledge** (chunk embeddings + metadata).
3. Merges and ranks by confidence, provenance, recency.
4. Returns a unified context pack for agents.

### C) Scalable Vector Storage (Local‑First)
- Short term: SQLite + FTS prefilter + cosine.
- Mid term: optional local vector store (sqlite-vec or LanceDB).
- Long term: optional server vector DB (Qdrant/pgvector) for scale.

### D) Safety & Corrections
- Curator agent handles destructive memory changes.
- All changes audited in belief changes / knowledge source history.

---

## Roadmap by Phase

### Phase 1 (0–3 months)
**Goal:** unify reasoning and improve search quality without changing storage engine.

- ~~Build `retrieveContext(query)` in core.~~ **Done**
- Add concept tags to beliefs and knowledge chunks.
- ~~Add FTS prefilter to knowledge search to avoid O(N) scanning.~~ **Done**
- Surface Curator agent + Memory Health in UI.
- Add provenance block in responses (beliefs + knowledge sources).

**Success criteria:**
- Knowledge queries stay fast with 10k+ chunks.
- UI shows memory health and provenance.

---

### Phase 2 (3–9 months)
**Goal:** scale local search, improve reliability, and expand agent capabilities.

- Add optional local vector store (LanceDB or sqlite‑vec).
- Add confidence calibration based on source reliability.
- Add planner agent for task decomposition.
- Add background maintenance (prune stale, re-embed, dedupe).

**Success criteria:**
- Retrieval latency < 300ms for 50k chunks.
- Planner agent consistently produces actionable task trees.

---

### Phase 3 (9–18 months)
**Goal:** multi‑user/multi‑workspace support + operational maturity.

- Introduce explicit user/workspace scoping for memory + knowledge.
- Add permissions/sandboxing for agents.
- Add automated memory revalidation (decay + recheck).
- Optional remote sync or federated storage.

**Success criteria:**
- Safe multi‑user memory isolation.
- Scalable knowledge base with workspace boundaries.

---

## High‑Impact Differentiators

1. **Memory Ledger**
   - Full audit history for each belief.
   - Explainable “why this is remembered.”

2. **Provenance‑First Answers**
   - Responses cite memory and knowledge sources explicitly.

3. **Multi‑Agent Coordination**
   - Agents share memory but remain specialized.

---

## Immediate Next Actions
1. ~~Implement unified `retrieveContext` pipeline.~~ **Done**
2. Add concept tagging and cross‑links.
3. ~~Add knowledge FTS prefilter.~~ **Done**
4. Surface Curator + provenance in UI.


# Core Platform

The core platform is the product backend. It owns durable state and all business rules that must remain valid whether agents are healthy or not.

## Ownership

- **API / BFF**
  - Route registration
  - HTTP auth/session policy
  - Request shaping for web, Telegram, and CLI surfaces
- **Runtime / Config / Auth / Storage**
  - Storage initialization and migrations
  - Config load/save
  - LLM client setup
  - Logger and process lifecycle
- **Memory**
  - Belief lifecycle
  - Episode capture
  - Provenance
  - Correction/invalidation rules
- **Knowledge**
  - Document indexing
  - Findings/insights persistence
  - Retrieval/search
  - Ingestion pipelines
- **Watches**
  - Watch definitions and scheduling state
  - Delta context for follow-up runs
  - Watch evaluation history
- **Digests**
  - Brief generation
  - Recommendation construction
  - Compounding and evidence checks
  - Digest corrections and ratings
- **Tasks / Actions**
  - Task lifecycle
  - Digest-linked actions
  - Completion state
- **Background Orchestration**
  - Worker cadence
  - Dispatch and retries
  - Cleanup loops
  - Background learning
- **Quality / Observability**
  - Telemetry
  - Product events
  - Quality score computation
  - Operator-facing system health
- **Channel Adapters**
  - Telegram/CLI transport logic
  - Formatting and delivery
  - No ownership of business rules

## Non-Negotiable Rule

If a rule changes what gets stored, recommended, corrected, scheduled, or surfaced to the user, that rule belongs to the core platform.

Agents may propose or synthesize, but the core platform decides:

- what state is canonical
- how corrections apply
- what counts as evidence
- what quality means
- what gets delivered to users

## Current Practical Boundary

Today the codebase still contains mixed package naming from earlier phases. Until packages are reshaped, contributors should treat block ownership as the source of truth and package names as implementation detail.

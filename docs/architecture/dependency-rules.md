# Dependency Rules

These rules exist to keep the architecture stable while the repo is still package-shaped around earlier phases.

## Rule 1: Core Platform Does Not Depend On Agent Plane Logic

Core platform blocks may invoke agents as plugins or tools, but product rules must not require agent code to be correct.

Examples:

- Digest correction semantics belong in the platform, not the curator.
- Watch eligibility and compounding rules belong in the platform, not the research agent.
- Quality scoring belongs in the platform, not in agent self-assessment.

## Rule 2: Agents Depend On Platform Services

Agent code should consume block interfaces, typically through the agent harness:

- `memory`
- `knowledge`
- `watches`
- `digests`
- `tasks`
- `telemetry`

Avoid introducing new direct storage access inside agents when a platform service already exists or should exist.

## Rule 3: Channel Adapters Stay Thin

Telegram, CLI, and future integrations may:

- authenticate
- format
- translate transport semantics
- call platform APIs
- invoke agents

They should not own core domain behavior.

## Rule 4: Background Orchestration Coordinates, It Does Not Own Domain Rules

Worker loops decide **when** work runs.
Domain blocks decide **what** the work means.

Examples:

- worker loop schedules learning
- memory/knowledge logic decides what gets stored
- worker loop schedules digest generation
- digest logic decides evidence and recommendations

## Rule 5: Quality Measures Product Outcomes, Not Agent Vanity

Quality and product metrics should remain anchored to:

- provenance
- evidence
- reliability
- user outcomes

Agent confidence or self-reflection can be logged, but it must not replace product-grounded quality measures.

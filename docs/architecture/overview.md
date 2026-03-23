# Architecture Overview

The backend is organized into two planes:

- **Core Platform**: owns product state, business rules, orchestration, and quality.
- **Agent Plane**: proposes, analyzes, researches, and synthesizes through explicit platform interfaces.

This split is intentional. The product should keep working when an agent is disabled, swapped, or degraded. Agents help the product; they do not own it.

## Core Platform Blocks

- **API / BFF**: route registration, auth, HTTP/SSE request orchestration.
- **Runtime / Config / Auth / Storage**: server bootstrap, config, LLM setup, logging, storage lifecycle.
- **Memory**: beliefs, episodes, provenance, correction lifecycle.
- **Knowledge**: documents, findings, insights, ingestion, search.
- **Watches**: watch definitions, scheduling state, delta context, watch evaluations.
- **Digests**: briefing generation, compounding, digest correction and ratings.
- **Tasks / Actions**: to-dos, digest-linked actions, completion lifecycle.
- **Background Orchestration**: worker loop, dispatch, periodic cleanup, background learning.
- **Quality / Observability**: telemetry, product metrics, quality scorecard, operator health.
- **Channel Adapters**: Telegram and CLI/MCP integrations that stay thin over platform logic.

## Agent Plane Blocks

- **Assistant Agent**: interactive ask/chat orchestration.
- **Curator Agent**: memory cleanup, contradiction review, consolidation.
- **Research Agent**: watch/research execution and report synthesis.
- **Swarm Agent**: multi-agent decomposition and synthesis.

## Current Package Mapping

| Block | Current packages/files |
| --- | --- |
| API / BFF | `packages/server`, `packages/server/src/routes/*` |
| Runtime / Config / Auth / Storage | `packages/core`, `packages/server/src/index.ts` |
| Memory | `packages/core/src/memory/*` |
| Knowledge | `packages/library` |
| Watches | `packages/watches`, `packages/plugin-schedules` |
| Digests | `packages/server/src/briefing.ts`, `packages/server/src/compounding.ts`, `packages/server/src/routes/digests.ts` |
| Tasks / Actions | `packages/plugin-tasks`, `packages/server/src/routes/tasks.ts` |
| Background Orchestration | `packages/server/src/workers.ts`, `packages/server/src/background-dispatcher.ts`, `packages/server/src/learning.ts` |
| Quality / Observability | `packages/server/src/quality.ts`, `packages/server/src/routes/observability.ts`, `packages/server/src/routes/product-metrics.ts` |
| Channel Adapters | `packages/plugin-telegram`, `packages/cli` |
| Agent Plane | `packages/plugin-assistant`, `packages/plugin-curator`, `packages/plugin-research`, `packages/plugin-swarm` |

## Migration Rule

Refactor by **ownership first, files second**:

1. Document the owning block.
2. Add or tighten service boundaries.
3. Move files only after dependencies are explicit.

That keeps architecture changes incremental and testable instead of turning them into a large package rewrite.

# Agent Plane

The agent plane is intentionally separate from the product backend.

Agents can:

- plan
- research
- synthesize
- propose actions
- suggest corrections

Agents cannot own product state or core business rules.

## Blocks

- **Assistant Agent**
  - conversational ask flow
  - tool selection
  - user follow-up handling
- **Curator Agent**
  - memory cleanup
  - contradiction inspection
  - consolidation suggestions
- **Research Agent**
  - watch/report execution
  - external information gathering
  - research synthesis
- **Swarm Agent**
  - sub-agent decomposition
  - parallel research/specialist work
  - synthesis of multi-agent outputs

## Agent Harness

Agents should interact with the rest of the system through the harness in `packages/core/src/agent-harness/`.

The harness provides:

- agent identity
- preloaded context
- previous findings for delta work
- explicit platform-service access
- budget tracking
- usage/reflection reporting

The important architectural rule is not the helper itself. The rule is:

> Agents should depend on declared platform services, not on scattered storage helpers or direct ownership of domain rules.

## First-Class Platform Blocks Available To Agents

- `memory`
- `knowledge`
- `watches`
- `digests`
- `tasks`
- `telemetry`

An agent may use one or more of those blocks, but it should declare them through the harness and keep its execution logic constrained to those interfaces.

## Current Adoption

The research agent now uses the harness with declared platform blocks and preloaded watch/task context. Other agents can migrate incrementally to the same contract.

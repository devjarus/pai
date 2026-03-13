# Architecture Boundaries

This document sets the working boundaries for product-facing changes and infrastructure changes in `pai`.

## 1. Programs And Briefs Are Product Objects

Programs and Briefs are the primary product objects.

- Program = ongoing decision or watch
- Brief = decision-ready output for that program

Changes should strengthen those objects rather than adding parallel top-level concepts.

## 2. Threads Are Interaction Containers

Threads exist to hold chat interaction history.

They are useful infrastructure, but they are not the primary product object. Do not design the product as if the thread is the main source of value.

Implication:

- thread changes should not silently redefine Program or Brief behavior
- UI and backend work should not force users to think in threads first

## 3. Chat Is A Control Surface

Chat is important, but it is not the whole product.

Chat should be used to:

- create or refine Programs
- ask follow-up questions about Briefs
- capture corrections
- request one-off analysis that may turn into recurring work

Chat should not be treated as the only place product value lives. Durable value should survive in Programs, Briefs, Actions, Beliefs, and Evidence.

## 4. Memory Governance Is First-Class

Memory governance is not an internal nice-to-have. It is a first-class subsystem.

Changes touching memory must preserve or improve:

- provenance
- origin classification
- inferred vs observed distinction
- correction handling
- contradiction handling
- visibility into why a recommendation used a belief

If a change improves backend memory sophistication but makes provenance or correction less visible, it is not an improvement.

## 5. Browser And Sandbox Are Optional Enrichments

Browser automation and sandbox execution are useful enrichments, not required correctness dependencies.

Implication:

- core loop correctness must remain coherent when browser or sandbox is unavailable
- degraded mode must still support sensible Program, Brief, and correction behavior
- do not make core validation depend on optional enrichments being online

## 6. Primary vs Secondary Tool Philosophy

Primary product surfaces:

- Home or Brief feed
- Programs
- Ask
- Memory Trust

Secondary or supporting surfaces:

- source management
- jobs and run history
- diagnostics
- CLI and MCP
- Telegram as companion delivery and response surface

Internal backend nouns should stay internal unless a decision log explicitly promotes one.

## 7. Implementation Noun Leakage

Do not reintroduce internal nouns as product-facing nouns without an explicit decision log.

Examples that should stay internal by default:

- swarm
- job
- queue
- blackboard
- schedule

Preferred user-facing nouns:

- Program
- Brief
- Action
- Memory
- Evidence

## 8. Boundary Test For New Work

Before adding a new concept or surface, ask:

1. Does this strengthen the Ask -> Program -> Brief -> Correction/Action loop?
2. Does this preserve the Program and Brief object model?
3. Does this improve trust, provenance, or recurring follow-through?
4. Can this remain coherent when optional enrichments are unavailable?

If the answer is no, the default is to defer.

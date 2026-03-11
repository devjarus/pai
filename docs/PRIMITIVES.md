# Primitives

This document defines the portable primitives that agents, scripts, and humans should use when coordinating work in this repository.

## Program

Purpose:
- The product object for an ongoing decision or commitment.

Who uses it:
- product code, UI, background jobs, agents, and validation scenarios

What it should contain:
- the recurring question or commitment
- user preferences and constraints relevant to the decision
- cadence or trigger rules
- latest brief, open actions, and recent corrections

What it must not become:
- a generic bucket for every background process
- a synonym for raw schedules or job rows

## Brief

Purpose:
- The decision-ready artifact delivered to the user.

Who uses it:
- UI, Telegram delivery, report rendering, and validation harness

What it should contain:
- recommendation
- what changed
- evidence
- memory assumptions
- next actions
- correction hooks

What it must not become:
- a raw execution log
- a dump of research notes without a recommendation

## Action

Purpose:
- A follow-through item that emerges from a brief or program.

Who uses it:
- users, UI surfaces, background follow-through, and future automation

What it should contain:
- clear next step
- origin brief or program
- status and timing

What it must not become:
- a parallel task-management product with its own strategy

## Belief

Purpose:
- Durable memory about the user, the system state, or a stable inferred fact.

Who uses it:
- memory subsystem, assistant pipeline, brief generation, trust UX

What it should contain:
- statement
- type
- confidence and stability
- provenance and origin
- correction state

What it must not become:
- an untraceable cache entry
- a place to hide unverifiable assumptions

## Evidence

Purpose:
- The external or observed support for a belief, brief, or recommendation.

Who uses it:
- brief generation, memory governance, knowledge retrieval, validation harness

What it should contain:
- source reference
- freshness context
- relationship to the claim it supports

What it must not become:
- a vague citation placeholder
- a substitute for memory provenance

## TaskContract

Purpose:
- The scope contract for a coding task.

Who uses it:
- any coding agent doing multi-step work

What it should contain:
- objective
- in-scope and out-of-scope boundaries
- success criteria
- required validations
- risks and escalation conditions

What it must not become:
- a long narrative project plan
- a retrospective written after the fact

## ValidationRule

Purpose:
- A concrete rule that determines whether a change is blocked, warned, or acceptable.

Who uses it:
- harness scripts, definition-of-done docs, evidence packs

What it should contain:
- condition
- severity
- how the rule is checked

What it must not become:
- an aspirational guideline with no enforcement path

## ValidationReport

Purpose:
- Structured output from a validation or harness run.

Who uses it:
- coding agents, reviewers, CI, and future automation

What it should contain:
- run type
- generated time
- pass/warn/fail status
- checks performed
- blockers and warnings
- referenced artifacts

What it must not become:
- a binary success claim without supporting detail

## EvidencePack

Purpose:
- Human-readable proof of what changed and what was checked.

Who uses it:
- agents, reviewers, and future maintainers

What it should contain:
- summary of change
- files changed
- validations run
- results and failures
- remaining uncertainty
- confidence and next step

What it must not become:
- marketing copy
- a replacement for running validations

## DecisionLog

Purpose:
- Short record of why a repo-level architectural or product decision was made.

Who uses it:
- agents, reviewers, maintainers

What it should contain:
- decision
- why
- tradeoffs
- implications

What it must not become:
- a full design document
- a place for unresolved brainstorming

## Escalation

Purpose:
- Explicit stop-and-ask condition when uncertainty becomes risky.

Who uses it:
- any agent working under partial information

What it should contain:
- what is unclear
- why it blocks safe progress
- what decision is needed

What it must not become:
- a default escape hatch for routine ambiguity
- a substitute for doing the obvious next validation step

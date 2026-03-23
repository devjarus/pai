# Agent Plane Checklist

## Use This Checklist When

Use this checklist for assistant, curator, research, or swarm-agent behavior changes.

## Before Coding

- Identify the agent block being changed.
- Identify which core-platform blocks the agent needs.
- Prefer declared service boundaries over direct storage access.
- Decide whether the change is runtime behavior, prompt shape, or tool wiring.

## Boundaries

- Agents propose, analyze, and synthesize.
- Agents do not own product state or core business rules.
- Prefer the agent harness/service interfaces over scattered domain helpers.
- Keep agent self-assessment separate from product quality.

## Required Validation

- Run targeted agent tests.
- Run `pnpm verify`.
- Run `pnpm harness:core-loop` if the change affects watch creation, digest generation, correction handling, or action follow-through.
- Run `pnpm harness:regressions` if agent harness docs or checklists change.

## Evidence To Capture

- Which platform blocks the agent now depends on.
- Any budget, tool-call, or reflection behavior added or changed.
- The observable product effect, not just the agent’s internal reasoning.
- Any prompt or tool tradeoff that can affect reliability.

## Escalate When

- The agent begins to own product rules or persistence decisions.
- The change requires a new cross-block contract.
- The change improves agent convenience but weakens deterministic product behavior.
- The dependency between the agent and a platform block is unclear.

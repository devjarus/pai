# Core Platform Checklist

## Use This Checklist When

Use this checklist for changes to API, memory, knowledge, watches, digests, tasks/actions, worker orchestration, or quality/observability.

## Before Coding

- Confirm the owning core-platform block.
- Confirm whether the change alters durable state, business rules, or an external contract.
- State the target behavior or metric being improved.
- Identify the smallest change that can prove the improvement.

## Keep True

- Core platform owns state and business rules.
- Do not move ownership of product rules into agent code or channel adapters.
- Prefer deterministic logic for corrections, evidence rules, and quality calculations.

## Validation

- Run targeted tests for the touched domain.
- Run `pnpm verify`.
- Run `pnpm harness:core-loop` if the Ask → Watch → Digest → Correction loop is affected.
- Run `pnpm harness:regressions` if harness docs, checklists, or templates are changed.

## Stop And Reassess

- A change needs a new persistence shape or migration.
- The change weakens trust or reliability to improve engagement.
- The ownership boundary between blocks is unclear.
- The change would force core platform rules into an agent or adapter.

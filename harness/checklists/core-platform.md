# Core Platform Checklist

## Use This Checklist When

Use this checklist for changes to API, memory, knowledge, watches, digests, tasks/actions, worker orchestration, or quality/observability.

## Before Coding

- Confirm the owning core-platform block.
- Confirm whether the change alters durable state or business rules.
- State the target quality metric or behavior being improved.
- Confirm whether a migration, API contract change, or user-facing behavior change is involved.

## Boundaries

- Core platform owns state and business rules.
- Do not move ownership of product rules into agent code or channel adapters.
- Prefer deterministic logic for corrections, evidence rules, and quality calculations.
- If the change crosses blocks, document the dependency explicitly.

## Required Validation

- Run `pnpm verify`.
- Run targeted tests for the touched domain.
- Run `pnpm harness:core-loop` if the Ask → Watch → Digest → Correction loop is affected.
- Run `pnpm harness:regressions` if harness docs, checklists, or templates are changed.

## Evidence To Capture

- Before/after API or behavior summary.
- Files changed and owning block.
- Metric movement if the change is quality-driven.
- Any residual risks or unsupported cases.

## Escalate When

- A change needs a new persistence shape or migration.
- The change weakens trust or reliability to improve engagement.
- The ownership boundary between blocks is unclear.
- The change would force core platform rules into an agent or adapter.

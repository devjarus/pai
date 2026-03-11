# Definition Of Done

This document defines what counts as complete work in `pai` for any coding agent.

## Completion Rules

Work is only done when all of the following are true:

- scope stayed within the task contract or the contract was updated before scope changed
- relevant validations were actually run
- an evidence pack exists for multi-step work or behavior-changing work
- regressions were considered using the relevant checklist and harness command
- reactive restore work names the failure signal, restore condition, and prevention step
- uncertainty is stated honestly
- no success claim is made without proof

## Blocking Failures

Any one of these means the task is not done:

- the change violates the stated scope without a contract update
- required validations were not run
- a required validation failed
- a core-loop, memory, or UI behavior change shipped without an evidence pack
- blocker-level uncertainty remains unaddressed
- the task claims success without logs, output, or other verifiable evidence
- a behavior change introduces product-noun drift against the current product charter

## Warn-Only Issues

These do not automatically block completion, but they must be reported:

- a helpful but non-critical validation could not be run
- a scaffold harness path was exercised instead of a real runtime path
- a non-core document or template is still coarse and needs iteration
- external dependencies prevented a full manual check but the core proof path still ran

Warn-only issues must appear in the evidence pack and final handoff.

## Validation Expectations

At minimum, select the validations that match the work:

- `pnpm test` or targeted package tests for code changes
- `pnpm lint` when linted sources are touched
- `pnpm typecheck` when types or build wiring are affected
- `pnpm harness:core-loop` for Program, Brief, correction, provenance, or recurring follow-through changes
- `pnpm harness:regressions` for repo-level harness integrity or cross-cutting changes

## Reactive Restore Work

Reactive work includes CI failures, coverage regressions, flaky tests, broken builds, or other side-loop fixes that are triggered by an existing guardrail rather than a new feature request.

Reactive work is only done when all of the following are true:

- the failing signal is named concretely
- the restore condition is explicit
- the failing gate was rerun after the fix when possible
- the evidence pack states the root cause, not just the symptom
- a prevention step was added or the absence of one is stated as an explicit residual risk

Reactive fixes should end by promoting the discovered invariant into a durable guard when possible:

- a test
- a harness assertion
- a checklist rule
- a documented accepted risk

## Evidence Requirements

Evidence must be specific enough that another maintainer can understand what was checked.

Acceptable evidence includes:

- command output
- generated validation reports
- updated evidence packs
- file references for the implemented change
- for reactive work: the failing signal, proof of restore, and prevention added

Unacceptable evidence includes:

- "should work"
- "looks fine"
- "did not test but it is probably okay"

## Escalation Rule

Escalate instead of claiming completion when:

- product intent is ambiguous and a wrong choice would alter the core loop
- the required validation path does not exist yet and the scaffold result is not enough
- a dependency or environment issue prevents checking a blocker condition
- the requested change conflicts with a documented boundary or decision log

## Review Standard

The standard is not "no obvious bug found." The standard is "the change stayed in scope, respected product boundaries, passed the required checks, and any remaining risk is explicit."

# Definition Of Done

This document defines what counts as complete work in `pai` for any coding agent.

## Completion Rules

Work is only done when all of the following are true:

- scope stayed within the task contract or the contract was updated before scope changed
- relevant validations were actually run
- an evidence pack exists for multi-step work or behavior-changing work
- regressions were considered using the relevant checklist and harness command
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

## Evidence Requirements

Evidence must be specific enough that another maintainer can understand what was checked.

Acceptable evidence includes:

- command output
- generated validation reports
- updated evidence packs
- file references for the implemented change

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

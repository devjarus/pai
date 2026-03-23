# Digests Checklist

## Use This Checklist When

Use this checklist for digest generation, recommendations, correction carry-forward, digest actions, digest ratings, or digest UI/API contracts.

## Before Coding

- Confirm whether the change affects daily digests, research digests, or both.
- Identify the intended user-visible change in recommendation, evidence, assumptions, or next actions.
- Identify any impact on correction carry-forward or digest-linked actions.

## Boundaries

- Digest rules belong to the core platform.
- Evidence requirements and compounding rules must stay deterministic.
- Digest interaction events should feed quality metrics, not just UI state.
- Avoid adding opaque recommendation behavior that cannot be traced.

## Required Validation

- Run targeted digest route/generation tests.
- Run `pnpm verify`.
- Run `pnpm harness:core-loop`.
- Validate any quality score movement if digest interactions or outcomes changed.

## Evidence To Capture

- Before/after digest behavior summary.
- Example of changed recommendation/evidence behavior.
- Whether correction carry-forward or recommendation acceptance changed.
- Any user-facing copy or contract changes.

## Escalate When

- The change weakens evidence quality to improve brevity or engagement.
- The next digest may still reuse corrected/invalidated assumptions.
- The recommendation behavior cannot be verified with tests or harness output.
- Digest events are added without a clear metric purpose.

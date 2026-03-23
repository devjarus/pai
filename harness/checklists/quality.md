# Quality Checklist

## Use This Checklist When

Use this checklist for quality metrics, product metrics, observability, or any change explicitly driven by a score or KPI.

## Before Coding

- Identify the weakest sufficiently sampled metric or domain.
- Write the hypothesis for why the metric is weak.
- Define the guardrails that must not regress.
- Confirm whether the metric is product-grounded or only internal telemetry.

## Boundaries

- Optimize domain metrics, not just the top-line score.
- Do not optimize metrics with insufficient sample.
- Do not trade trust or reliability away for engagement.
- Keep agent self-reflection separate from product quality.

## Required Validation

- Run targeted tests for the metric logic.
- Run `pnpm verify`.
- Run `pnpm harness:core-loop` if the change affects the core decision loop.
- Capture the quality payload before and after when possible.

## Evidence To Capture

- The metric or domain targeted.
- Before/after payload or representative values.
- Sample size and whether the metric is sufficiently sampled.
- Guardrails that stayed flat or improved.

## Escalate When

- A metric can be improved by gaming instrumentation rather than improving behavior.
- Sample size is too low to justify the change.
- The proposed metric is not tied to a real user or product outcome.
- The overall score rises while trust or reliability meaningfully worsen.

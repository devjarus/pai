# Reactive Fix Checklist

Use this when work is triggered by CI failures, coverage drift, flaky tests, broken builds, or other restore-the-guardrail side loops.

- [ ] The failing signal is named concretely, including the job, command, or guard that failed.
- [ ] The restore condition is explicit before code changes begin.
- [ ] The smallest credible reproduction or failing gate was identified.
- [ ] The fix stays scoped to restoring the broken invariant plus any necessary prevention step.
- [ ] The root cause is stated, not just the visible symptom.
- [ ] The failing gate was rerun after the fix when possible.
- [ ] A durable prevention step was added, or the evidence pack explains why none was appropriate.
- [ ] Any residual risk is explicit instead of implied.

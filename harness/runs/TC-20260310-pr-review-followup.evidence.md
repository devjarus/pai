# Evidence Pack

## Summary Of Change

- Fix PR review follow-up items for doc portability and roadmap framing.
- Keep the long-form roadmap but mark it as a reference document rather than the operational handbook.

## Files Changed

- AGENTS.md
- docs/TECH-VISION-ROADMAP.md
- harness/runs/TC-20260310-pr-review-followup.yaml
- harness/runs/TC-20260310-pr-review-followup.evidence.md

## Validations Run

- command: pnpm harness:regressions
  result: pass
  notes: Scaffold regression harness passed and updated harness/reports/latest-regressions.json. It validates doc/template/schema presence and wiring, not runtime behavior.

## Harness Scenarios Touched

- scenario id: core-loop-change-checklist
  why: The changes touch the repo’s core product guidance and operator entrypoint docs.

## Results

- `AGENTS.md` now uses repo-relative markdown links instead of contributor-specific absolute filesystem paths.
- `docs/TECH-VISION-ROADMAP.md` now declares itself as the long-form strategic reference, with operational guidance delegated to the smaller canonical docs.
- Review disposition:
  The absolute-path portability issue was fixed directly.
  The roadmap-length concern was addressed by clarifying document role instead of trimming strategy content in this PR.
  The harness-script import concern did not require a code change in this follow-up; the current scripts already resolve repo files through shared root helpers, so the review note remains a reasonable future maintainability watch item.

## Failures

- none

## Remaining Uncertainty

- Whether the reviewer wants the roadmap trimmed later rather than only labeled more explicitly as reference material.

## Confidence

- high
- The concrete portability issue is fixed, the roadmap framing is clearer, and the remaining concern is editorial rather than correctness-related.

## Next Best Step

- Push the follow-up commit to the PR branch and, if needed, reply to the review explaining why the roadmap was kept as reference material.

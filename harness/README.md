# Harness

Automated validation for the pai core loop. Agents **must** run all three gates before claiming work is done.

## Gates

```bash
pnpm verify              # Typecheck + unit tests + coverage
pnpm harness:core-loop   # Ask → Watch → Digest → Correction scenarios
pnpm e2e                 # Browser-level smoke tests (setup, auth, settings, chat)
```

`pnpm harness:regressions` — repo hygiene (committed secrets, hardcoded IDs, doc/script wiring). Run if you change harness scripts or architecture docs.

## What the core-loop validates

Scenarios in `harness/scenarios/` test the full loop:
- Program creation from user ask
- Memory capture (preferences, constraints, questions)
- Briefing generation with required sections
- Belief correction with provenance
- Corrected beliefs reflected in next briefing
- Linked action follow-through

## When to run what

| Change touches | Run |
|----------------|-----|
| Any code | `pnpm verify` |
| Core loop (watches, digests, memory, research) | `+ pnpm harness:core-loop` |
| UI behavior | `+ pnpm e2e` |
| Harness scripts or architecture docs | `+ pnpm harness:regressions` |

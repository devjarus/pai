# Harness

The harness is the contributor and coding-agent workflow layer for `pai`.

Its job is to make changes safer and more consistent without turning every task into paperwork.

Keep the workflow simple:

- identify the owning architecture block
- define the target change and guardrails
- make the smallest change that can prove value
- run the right verification

## Workflow

1. Read `docs/architecture/overview.md` and identify the owning block.
2. Choose the matching checklist from `harness/checklists/`.
3. State the target behavior or metric and the main thing that must not regress.
4. Make the change.
5. Run the required commands for the affected block.
6. If the task is large, risky, or spans multiple steps, capture a short task contract and evidence pack.

## Checklists

- `harness/checklists/core-platform.md`
- `harness/checklists/agent-plane.md`
- `harness/checklists/digests.md`
- `harness/checklists/quality.md`

Use one checklist for the owning block. Use more than one only when the change clearly crosses blocks.

## Templates

- `harness/templates/task-contract.yaml`
- `harness/templates/evidence-pack.md`

These are optional for small, obvious changes.

Use them when:
- the task is risky
- the task spans multiple files or turns
- the tradeoffs need to be explicit
- the validation story is not obvious

## Verification

- Always run `pnpm verify`.
- Run `pnpm harness:core-loop` if Ask → Watch → Digest → Correction behavior changes.
- Run `pnpm harness:regressions` if you change workflow docs, harness scripts, or templates.
- If UI behavior changed, run a browser check (`pnpm e2e` or a focused manual smoke test).

`pnpm harness:regressions` validates the coding-agent harness assets themselves: architecture docs, checklists, templates, and script wiring.
It also checks basic repo hygiene so committed secrets, tracked config files, and hardcoded Linear defaults in runtime source fail fast.

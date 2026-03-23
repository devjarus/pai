# Harness

The harness is the contributor and coding-agent workflow layer for `pai`.

It exists to make non-trivial changes follow the same structure:

- identify the owning architecture block
- stay within dependency rules
- choose the matching checklist
- capture a task contract and evidence pack
- run the required verification

## Workflow

1. Read `docs/architecture/overview.md` and identify the owning block.
2. Choose one or more matching checklists from `harness/checklists/`.
3. Start from `harness/templates/task-contract.yaml`.
4. Capture proof using `harness/templates/evidence-pack.md`.
5. Run the required commands for the affected block.
6. If the change touches the core product loop, also run `pnpm harness:core-loop`.

## Checklists

- `harness/checklists/core-platform.md`
- `harness/checklists/agent-plane.md`
- `harness/checklists/digests.md`
- `harness/checklists/quality.md`

Use at least one checklist for every non-trivial task. Use more than one when a change crosses blocks.

## Templates

- `harness/templates/task-contract.yaml`
- `harness/templates/evidence-pack.md`

The task contract defines the intended change before editing. The evidence pack records what actually happened.

## Verification

- `pnpm verify`
- `pnpm harness:regressions`
- `pnpm harness:core-loop` for core-loop behavior changes

`pnpm harness:regressions` validates the coding-agent harness assets themselves: architecture docs, checklists, templates, and script wiring.

# Product Charter

## What `pai` Is Now

`pai` is a self-hosted AI that keeps track of ongoing decisions and digests the user with their preferences in mind.

The current product is not trying to win by being the broadest personal AI surface. It is trying to win by doing four things reliably:

- remembering durable user preferences, constraints, and corrections
- following ongoing decisions in the background
- producing decision-ready digests instead of raw research dumps
- improving the next digest when the user corrects the system

## What `pai` Is Not

`pai` is not currently:

- a full personal AI OS
- a generic research workbench
- a general-purpose task manager
- a standalone follow-through board
- an autonomous end-to-end action-taking agent
- a product where every surface gets equal emphasis

## Core Loop

The current product loop is:

1. Ask
2. `Keep watching this` or implicit Watch creation
3. Digest
4. Correction or To-Do
5. Next digest improves

The loop is the product. Breadth is allowed only if it makes this loop more trustworthy, more continuous, or more useful.

## First ICP

Current first ICP:

- technical individual users
- information-dense work and daily life
- repeated monitoring or re-checking tasks
- high value on context continuity and remembered constraints
- willing to self-host or tolerate setup friction in exchange for control

Good examples:

- engineers tracking launches, tooling decisions, or vendor choices
- founders or product leaders tracking projects, markets, or hiring signals
- privacy-conscious power users tracking travel, buying, pricing, or planning decisions over time

## Product Nouns

Primary product nouns:

- Watch
- Digest
- To-Do (user-facing: follow-through for Watches and Digests)
- Memory
- Source

Secondary or internal nouns that should not lead the product:

- Thread
- Job
- Schedule
- Swarm
- Blackboard

## Anti-Goals

The current anti-goals are deliberate:

- do not add new surface areas just to demonstrate capability breadth
- do not make Telegram, CLI, MCP, research, and swarm equally prominent
- do not turn memory trust into a power-user-only backend feature
- do not let chat become the only place where the product value lives
- do not expose internal execution nouns as if they were user value
- do not let To-Dos become a standalone task system; they exist as follow-through for Watches and Digests

## Current 90-Day Focus

For the current operating window, focus on:

- making Watches and Digests the dominant product loop
- treating persisted follow-through as optional To-Do state, not default backlog
- improving memory provenance, correction handling, and trust visibility
- keeping recommendation-first digest quality high
- clarifying mobile and Telegram as companion surfaces, not full control planes
- reducing product-surface symmetry and implementation-noun leakage

## Breadth Freeze Rule

Breadth is frozen unless the change clearly strengthens the core loop.

A proposed feature or integration must answer at least one of these questions with evidence:

- Does it improve Watch continuity?
- Does it improve digest quality or actionability?
- Does it improve memory provenance, correction handling, or trust?
- Does it improve recommendation-to-To-Do follow-through?

If the answer is no, the default decision is to defer it.

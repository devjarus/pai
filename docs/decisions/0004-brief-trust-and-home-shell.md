# 0004 Brief Trust And Home Shell

## Decision

Treat Home as the loop surface, not the archive surface, and only allow trust-safe, context-relevant beliefs to appear in Brief generation.

## Why

Two product failures showed up in real usage:

- Ask-created Programs were easy to create but easy to lose in the shell.
- Briefs could surface active beliefs that were technically stored but irrelevant or socially risky for the current decision.

That combination makes the product feel inconsistent even when the underlying data model is working.

## Tradeoff

- Home gives less immediate space to historical brief backlog.
- Briefing memory selection becomes stricter and can hide some true but low-relevance beliefs.
- The stricter filter improves continuity, trust, and decision quality.

## Implications

- Home should lead with active Programs, open follow-through, and the latest Brief, with archive content below.
- Chat completion must refresh Home, Programs, follow-through, and Memory-facing queries together so Ask-created work becomes visible immediately.
- Brief generation should only consider beliefs that are:
  - active
  - non-sensitive
  - not corrected or invalidated
  - relevant to the current Program / Action / Goal / knowledge focus
- Third-party beliefs should not surface in a Brief unless the current watch explicitly names that subject.

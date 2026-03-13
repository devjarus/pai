# 0007: Follow-Through Boundary

Date: 2026-03-12

## Status

Superseded by [0008: Saved Move Language](./0008-saved-move-language.md) for naming

## Context

Real usage exposed a gap in the follow-through model:

- Program cards could create generic tracked steps that often just rephrased the Program
- the persisted object felt like a hidden todo list rather than a product-strengthening loop primitive
- Telegram, setup, and web copy still taught multiple conflicting nouns for the same concept

The valuable behavior was not "have more tasks." The valuable behavior was "remember the one manual move the user explicitly wants pai to revisit later."

## Decision

Keep the internal `Action` / `task` storage model for compatibility, but present persisted follow-through as a lighter saved-move layer rather than a generic task board.

- Programs remain watches; they should not create generic tracked steps from the Program card.
- Repeated `Keep watching` attempts should reuse the existing Program for the same thread or equivalent recurring watch instead of implying that a second watch was created.
- Briefs remain the primary place where recommendation becomes visible.
- A recommendation should only become a saved move when the user explicitly asks pai to keep that move alive.
- The `/tasks` route remains for compatibility, but the surface is secondary and should not become a primary standalone product noun.

## Consequences

- The product story becomes `Program -> Brief -> Correction or saved move -> better next Brief`.
- Program detail should steer the user toward the latest Brief, not toward manufacturing a duplicate todo.
- Telegram and setup copy should use the same lighter follow-through language so companion surfaces do not reintroduce the older model.
- Internal automation or quality-improvement work must not be mixed into user-facing saved moves.

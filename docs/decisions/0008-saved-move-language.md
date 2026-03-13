# 0008: Saved Move Language

Date: 2026-03-12

## Status

Accepted

## Context

Real product usage showed that `Commitment` was the wrong user-facing label for persisted follow-through:

- it sounded too heavy for an optional move the user may or may not act on
- it implied a promise before the user had necessarily decided
- it kept the follow-through layer feeling like a renamed todo list instead of recommendation carry-forward

The behavior is still useful. The naming was not.

## Decision

Keep the underlying `Action` / `task` storage model, but present persisted follow-through to users as a `Saved Move`.

- Briefs should show `Recommended move` or `Recommended moves`.
- Persisting one should be labeled `Save move`.
- The secondary `/tasks` surface should be labeled `Saved Moves`.
- Companion surfaces such as Telegram should use the same language.

## Consequences

- The product story becomes `Program -> Brief -> Correction or saved move -> better next Brief`.
- The follow-through layer reads as lighter and more optional.
- The system still supports future reminders, approvals, and execution, but the current UX no longer overstates the user's level of commitment.

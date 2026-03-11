# 0002 Programs Implicit

## Decision

Treat Programs as the primary system object, but prefer implicit creation from chat or follow-up flows instead of forcing a heavy upfront creation form.

## Why

Users naturally start with "help me with this" or "keep watching this," not "create a Program." The system model can stay strong without making the user carry the abstraction too early.

## Tradeoff

- onboarding becomes more natural
- implementation must connect chat, recurring follow-through, and Program persistence cleanly

## Implications

- Ask should offer `Keep watching this`
- Program creation must stay lightweight
- templates are helpers, not the main product mental model

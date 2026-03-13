# 0006: Telegram Companion Delivery

Date: 2026-03-12

## Status

Accepted

## Context

Telegram had fallen behind the main product loop. Long inline HTML responses were brittle, research and swarm pushes still behaved like report previews instead of decision updates, and the Telegram package still carried legacy briefing assumptions even after the unified brief contract landed.

That created three problems:

- recommendation was no longer visually first on Telegram
- dense outputs often degraded because Telegram HTML is stricter than the web surface
- the companion surface felt like a legacy transport instead of the same `Program -> Brief -> Correction or follow-through` product

## Decision

Treat Telegram as a companion surface, not a report renderer.

- Daily and Program-linked brief messages should be concise, recommendation-first digests.
- Research and swarm pushes should send a short gist message first, then any visuals, then a PDF attachment for the durable full report.
- Long or structurally complex chat responses should send a short inline digest and a PDF attachment instead of trying to deliver the entire body as Telegram HTML.
- Legacy commands like `/jobs`, `/research`, and `/schedules` may remain as compatibility paths, but they should not define the primary Telegram menu or help surface.

## Consequences

- Telegram stays aligned with the main product model even when the full artifact is large.
- Users get a stable document they can open later without depending on Telegram HTML rendering quality.
- Formatter tests now validate the unified brief contract instead of legacy briefing sections.
- The standalone Telegram runtime must migrate schedule tables so Program targeting works without requiring the full web server entrypoint to run first.

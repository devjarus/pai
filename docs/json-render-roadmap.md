# JSON Render Research UX Roadmap

This roadmap expands structured result rendering beyond Jobs and Inbox so research-style answers can also feel rich inside normal chat, while still keeping code-generated image artifacts as a reliable fallback.

## Goals

- Use `json-render` as the primary presentation layer for research and analysis results.
- Keep PNG/JPG/WebP artifacts as downloadable/shareable fallbacks.
- Reuse one presentation model across Inbox, Jobs, chat tool cards, and direct assistant replies.
- Prefer small, reliable component vocabularies over unconstrained generative layouts.

## Phase 1 - Chat-first structured rendering

Status: implemented in this change.

- Parse `json` and `jsonrender` fenced blocks inside assistant chat replies.
- Render valid `jsonrender` specs inline in normal chat instead of showing raw spec JSON.
- Upgrade the `run_code` tool card to reuse the shared result renderer for generated image artifacts.
- Keep non-image artifacts visible as downloadable files.
- Encourage the assistant to emit `jsonrender` blocks when it produces visual analyses in web chat.

## Phase 2 - Shared attachments and richer media

Status: planned.

- Extend the shared result contract with first-class attachments, not only inline visuals.
- Surface the same attachment model in Inbox, Jobs, chat tool cards, and Telegram where appropriate.
- Rename user-facing "Charts" affordances to "Visuals" where the content can be charts, screenshots, or generated figures.
- Support richer captions, provenance, and artifact metadata from `visuals.json`.

## Phase 3 - Generalized visual generation

Status: planned.

- Move research-side chart generation from stock-only logic into a shared domain visual generation layer.
- Reuse the same artifact + manifest pipeline for stock, crypto, comparison, quantified news, and other visual research tasks.
- Prefer PNG for sharp inline readability while optionally generating JPG when the calling surface wants a lightweight attachment.

## Phase 4 - Native chart components

Status: partially implemented.

- Introduced first-pass native `LineChart`, `BarChart`, and `DonutChart` components implemented with lightweight SVG rendering.
- Updated chat/research/swarm prompt guidance so quantitative results can prefer native charts when reliable numeric data exists.
- Keep the current SVG approach dependency-light while we learn which chart patterns deserve deeper investment.
- Add a small native charting dependency later only if the SVG approach proves too limiting.
- Keep artifact images as fallback for export, sharing, and surfaces that cannot execute richer chart code.

## Phase 5 - Structured assistant message transport

Status: planned.

- Move structured presentation data out of raw assistant text where possible.
- Persist structured message parts alongside text so copy/export/thread previews stay clean even when a reply contains a visual card.
- Let chat history replay rich assistant responses without depending on markdown fence parsing alone.

## Guardrails

- Never depend on `json-render` alone for critical visuals; always preserve an artifact fallback path.
- Keep the catalog constrained and well-described so the model produces stable specs.
- Favor shared renderers over per-domain bespoke chat cards unless a domain clearly needs a premium custom component.

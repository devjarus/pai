# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Google AI provider** — Added Google Gemini support via `@ai-sdk/google`. Supports chat, embeddings (text-embedding-004), and health checks.
- **Provider presets in Settings** — Selecting a provider in the UI auto-fills base URL, model, and embed model with sensible defaults for Ollama, OpenAI, Anthropic, and Google AI.
- **Token usage display** — Chat messages now show a subtle token badge (input/output tokens) at the bottom of completed assistant messages.

### Changed

- LLM client now returns human-readable error messages for common failures: invalid API key, unreachable endpoint, model not found, rate limiting, and quota issues.
- Embedding provider selection now supports Google AI (`text-embedding-004`) in addition to Ollama and OpenAI.

## [0.2.0] - 2026-02-22

### Added

- **Agent platform** — Fastify REST API server with SSE streaming chat, thread persistence, and static UI serving. AI SDK integration with `createUIMessageStream` for native tool-calling and streaming.
- **Web UI** — React + Vite + Tailwind CSS + shadcn/ui SPA with five pages: Chat (SSE streaming, markdown rendering, tool cards), Memory Explorer, Knowledge, Settings, and Timeline.
- **Personal Assistant agent** — Agent plugin with persistent memory, Brave web search, knowledge base, and task management. Extracts learnings into memory after each response.
- **Telegram bot** — grammY-based Telegram interface reusing the same agent chat pipeline. Thread persistence, auto-split long messages, markdown-to-HTML conversion.
- **Memory Curator agent** — Analyzes memory health (duplicates, stale beliefs, contradictions) and fixes issues with user approval. Batched contradiction scanning for performance.
- **Knowledge base** — Learn from web pages with content extraction, chunking, FTS5 prefilter + cosine re-ranking. Background crawling with sub-page discovery, rate limiting, and Jina Reader fallback for JS-rendered pages.
- **Tool card components** — Rich UI cards for all 15 assistant tools and 3 curator tools: memory (recall, remember, beliefs, forget), tasks (list, add, done), web search, knowledge (search, sources, learn, forget, status), and curator (curate, fix, list beliefs).
- **CLI improvements** — `pai init` for interactive project setup, knowledge commands (`learn`, `search`, `list`, `forget`), MCP server with 19 tools.
- **Memory improvements** — Subject-aware recall with insight deprioritization, conversation consolidation, memory file import/export, preflight validation to prevent hallucination storage.
- **Security hardening** — Path traversal protection, restricted default host binding, auth token support, public mode guard, PII logging prevention.

### Changed

- Rewrote chat route from manual SSE to AI SDK `createUIMessageStream` for proper tool-calling protocol.
- Memory recall now uses multi-factor scoring (cosine similarity + importance + recency) with reduced recency bias.
- Contradiction scanning is opt-in in curator for performance (batched into single LLM call).
- Knowledge retrieval uses FTS5 prefilter then cosine re-ranking for speed at scale.
- Updated AGENTS.md with UI conventions for tool cards and changelog maintenance.

### Fixed

- Tool call summaries no longer leak into chat responses.
- Memory Explorer shows all beliefs and scrolls correctly.
- Thread message normalization for consistent chat persistence.
- Failed crawl banners now have dismiss buttons; sidebar overflow fixed.
- Thinking indicator shown while waiting for LLM response.

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Tasks page** — Dedicated Tasks tab in the web UI with two sub-tabs: Tasks and Goals. Full CRUD (add, edit, delete, complete, reopen) with priority badges, due date tracking, goal linking, and progress bars. REST API endpoints for `/api/tasks` and `/api/goals`.
- **Google AI provider** — Google Gemini support via `@ai-sdk/google`. Supports chat, embeddings (text-embedding-004), and health checks.
- **Provider presets in Settings** — Selecting a provider auto-fills base URL, model, and embed model with sensible defaults for Ollama, OpenAI, Anthropic, and Google AI.
- **Token usage display** — Chat messages show a subtle token badge (input/output tokens) on completed assistant messages.
- **Docker support** — Multi-stage Dockerfile (Node 20 Alpine, <400MB), docker-compose.yml with optional Ollama sidecar via profiles, and `install.sh` interactive installer for Mac/Linux.
- **Docker publish CI** — GitHub Actions workflow builds and pushes images to GHCR on `v*` tag push.
- **Grey zone relationship classifier** — `classifyRelationship()` replaces binary contradiction detection in the 0.70–0.85 similarity band with 3-way classification: REINFORCEMENT, CONTRADICTION, or INDEPENDENT.
- **Proportional evidence weighing** — Well-supported beliefs (3+ episodes) are weakened proportionally instead of invalidated on contradiction.
- **ErrorBoundary** — React error boundary with refresh and copy-error-details buttons.
- **OfflineBanner** — Detects server unreachability (10s ping, 2 consecutive failures), shows amber banner, auto-dismisses on reconnect.
- **Empty states** — Improved empty states for Memory Explorer and Timeline pages with guidance text.
- **Memory lifecycle documentation** — `docs/MEMORY-LIFECYCLE.md` with mermaid diagrams, all thresholds, decay formula, and retrieval scoring.
- **Recall benchmark** — `packages/core/test/bench/recall-benchmark.ts` seeds 500 beliefs, runs 100 queries, reports p50/p95/p99 latencies.
- **Contradiction edge case tests** — 24 test cases covering grey zone scenarios, evidence weighing, band boundaries, and prompt parsing.

### Fixed

- **Railway: threads disappearing** — Fixed Docker entrypoint to run as root initially, fix volume file permissions, then drop to non-root `pai` user. Added startup warning when no persistent volume is detected.
- **Railway: false "Server is offline" banner** — Increased health check timeout (5s→15s) and require 2 consecutive failures before showing the offline banner.
- **Agent repeating memory recall** — Rewrote assistant system prompt to use judgement instead of mandatory tool-calling on every message. Removed tool call history re-injection that triggered repeat calls. Reduced step count (5→3).

### Changed

- LLM client returns human-readable error messages (`humanizeError()`) for common failures: invalid API key, unreachable endpoint, model not found, rate limiting, and quota issues.
- Client-side API errors are also humanized (SQLITE errors, HTTP status codes, network failures).
- Embedding provider selection now supports Google AI (`text-embedding-004`) in addition to Ollama and OpenAI.
- Database migrations are now transaction-wrapped (BEGIN/COMMIT/ROLLBACK per migration).
- Automatic database backup (`backupDatabase()` with WAL checkpoint) before running pending migrations.
- Docker Compose uses profiles — Ollama is in the `local` profile and only starts with `--profile local`.

### Security

- **Security headers** — `@fastify/helmet` adds CSP, X-Frame-Options, X-Content-Type-Options, HSTS, Referrer-Policy.
- **Rate limiting** — `@fastify/rate-limit` enforces 100 req/min global, 20/min for chat, 10/min for knowledge learning, 30/min for remember.
- **Timing-safe token comparison** — Sensitive comparisons use `crypto.timingSafeEqual` to prevent timing attacks.
- **Trust proxy** — Fastify `trustProxy` enabled on PaaS (Railway/Render) for correct client IP in rate limiting.
- **Input validation** — Max text length on `/api/remember` (10KB), URL validation and max length on `/api/knowledge/learn` (2KB).
- **CORS for cloud domains** — Auto-allows Railway domains (`*.up.railway.app`), custom domain via `PAI_CORS_ORIGIN`.
- **Docker non-root user** — Container runs as `node` user instead of root.
- **Healthcheck fix** — Docker healthcheck uses `/api/health` (public endpoint) instead of `/api/config` (requires auth).
- **Request logging** — All API requests logged with method, path, status, IP, and response time.
- **Railway support** — `railway.toml` for one-click Railway deployment with health check and Dockerfile builder.

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
- **Security hardening** — Path traversal protection, restricted default host binding, PII logging prevention.

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

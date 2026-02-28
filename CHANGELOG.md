# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Worker extraction** — Extracted 4 inline `setInterval`/`setTimeout` background workers from the 700-line server `index.ts` into a reusable `WorkerLoop` class (`packages/server/src/workers.ts`). Briefing generator (6h), schedule runner (60s), and background learning (2h/5min delay) are now encapsulated with `start()`/`stop()`/`updateContext()`. Migrations extracted to `packages/server/src/migrations.ts`. Telegram research push loop moved to `packages/plugin-telegram/src/push.ts` where it belongs. Added `pai worker` CLI command for standalone worker execution and `packages/server/src/worker.ts` entry point.

### Added

- **assistant-ui migration** — Replaced custom Chat.tsx (~1000 lines) with assistant-ui primitives (`<Thread />`, `<Composer />`, `makeAssistantToolUI`). Chat page reduced to ~200 lines. Uses `useExternalStoreRuntime` with existing `DefaultChatTransport` — zero server changes.
- **TanStack Query migration** — Replaced manual `useState + useEffect + fetch` patterns across all 9 pages with `@tanstack/react-query` hooks. Automatic cache invalidation, optimistic updates, and polling for jobs/schedules. New hooks directory: `src/hooks/use-*.ts`.
- **Background learning worker** — Passive always-on worker that extracts knowledge from user activity every 2 hours (5-minute initial delay). Gathers signals from chat threads, research reports, completed tasks, and knowledge sources using SQL watermarks, makes one focused LLM call to extract facts, and stores via `remember()`.
- **Jobs page** — New UI page for tracking background jobs (crawl + research). Shows job status, progress, and results. API: `GET /api/jobs`, `GET /api/jobs/:id`, `POST /api/jobs/clear`.
- **Unified inbox feed** — `GET /api/inbox/all` returns all briefing types (daily + research) chronologically with `generating` boolean. `GET /api/inbox/research` for research-only filtering. Briefings table now has a `type` column (migration v2) distinguishing "daily" vs "research".
- **Inbox detail view** — `/inbox/:id` page with full briefing content and "Start Chat" button that creates a thread and auto-sends research context.
- **Clear all threads** — `POST /api/threads/clear` endpoint and `clearAllThreads()` in core. Trash icon in Chat sidebar header for quick access.
- **Clear inbox and clear jobs** — `POST /api/inbox/clear` clears all briefings, `POST /api/jobs/clear` clears completed jobs.
- **Shared MarkdownContent component** — Reusable rich markdown renderer (`packages/ui/src/components/MarkdownContent.tsx`) with remarkGfm, code blocks with copy button, styled headings/tables/links. Used by ChatMessage and Inbox.
- **Inbox briefing page** — AI-generated daily briefing as the app home screen (`/`). Collects open tasks, goals, memory stats, beliefs, and knowledge sources, then generates a structured briefing with 4 sections: greeting, task focus, memory insights, and suggestions. Background timer auto-generates every 6 hours. Manual refresh with polling. Clear all briefings. Animated card-based UI with staggered fade-in. Cards link to relevant pages.
- **Clear all tasks** — Bulk delete all tasks with confirmation dialog. `POST /api/tasks/clear` endpoint + UI button.
- **E2E testing** — Playwright browser tests with mock LLM server (Ollama/OpenAI-compatible). 4 test specs: setup wizard, auth, settings, chat. Global setup spawns real PAI server + mock LLM. Runs on Node 22 in CI.
- **CI workflow** — GitHub Actions on push/PR to main. Matrix: Node 20 + 22. Runs typecheck, unit tests, coverage thresholds (80% statements/functions/lines, 70% branches), ESLint, security audit, and E2E tests (Node 22 only).
- **Server hardening** — Global error handler (hides stack in prod, returns request ID), request ID tracing (`x-request-id` header), Helmet security headers (CSP), rate limiting (100/min global, stricter on expensive endpoints), CORS whitelist (localhost + private ranges + Railway), content-type validation (CSRF protection), request logging (method, path, status, IP, response time), PaaS detection with storage retry (10 retries on cloud), volume persistence check, health endpoint caching (30s), graceful shutdown (SIGTERM/SIGINT).
- **Owner-only auth** — Email + password authentication with bcrypt hashing, JWT access tokens (15min) in httpOnly cookies, refresh tokens (7d), and setup wizard on first boot. Replaces the old shared `PAI_AUTH_TOKEN` system. Auth is enforced on cloud/Docker deployments (`0.0.0.0`) and bypassed on localhost (`127.0.0.1`).
- **Password reset via env var** — Set `PAI_RESET_PASSWORD=newpassword` and restart to reset the owner password. Login page shows "Forgot password?" with step-by-step instructions.
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

- **E2E rate limit exhaustion** — Global rate limit (100/min) was being exhausted by SPA page loads across E2E specs, causing chat test 429 errors. Increased global limit to 300/min (appropriate for single-user app), health to 60/min, login to 20/min.
- **Config save crash** — Wrapped `reinitialize()` in try-catch to prevent server crash on config save failures. UI now surfaces meaningful error messages via JSON error extraction.
- **Telegram briefing broadcast** — Fixed daily briefings being sent to all Telegram threads instead of only the owner's thread.
- **Chat E2E test reliability** — Updated test to use `keyboard.type()` + click send button for reliable interaction with assistant-ui's `ComposerPrimitive.Input`.
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

- **Owner-only auth with JWT** — bcrypt password hashing (cost 12), HMAC-SHA256 signed JWTs, httpOnly/Secure/SameSite=Lax cookies. Setup endpoint locked after first owner is created.
- **Token leak prevention** — JWT access tokens are only set as httpOnly cookies, never returned in API response bodies.
- **Auto-refresh on 401** — Client fetch wrapper transparently refreshes expired access tokens and retries the request. Concurrent refresh attempts are coalesced.
- **Auth rate limiting** — Login endpoint limited to 20 req/min per IP, refresh to 10 req/min, preventing brute-force attacks.
- **Localhost auth bypass** — Auth enforced only when binding to `0.0.0.0` (cloud/Docker). Local development on `127.0.0.1` requires no authentication.
- **CSRF protection** — JSON content-type required on all state-changing requests, preventing form-based CSRF.
- **Security headers** — `@fastify/helmet` adds CSP, X-Frame-Options, X-Content-Type-Options, HSTS, Referrer-Policy.
- **Rate limiting** — `@fastify/rate-limit` enforces 300 req/min global, 20/min for chat, 10/min for knowledge learning, 30/min for remember.
- **Trust proxy** — Fastify `trustProxy` enabled on PaaS (Railway/Render) for correct client IP in rate limiting.
- **Input validation** — Max text length on `/api/remember` (10KB), URL validation and max length on `/api/knowledge/learn` (2KB).
- **CORS for cloud domains** — Auto-allows Railway domains (`*.up.railway.app`), custom domain via `PAI_CORS_ORIGIN`.
- **Docker non-root user** — Container runs as `node` user instead of root.
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

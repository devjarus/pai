# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`/jobs` command** — View recent research and swarm job status directly from Telegram with status emojis and relative timestamps
- **`/research` command** — Start research directly from Telegram with `/research <query>` shortcut
- **Memory Curator delegation** — Telegram assistant can now delegate to the Memory Curator sub-agent for memory health analysis and fixes

### Changed

- **Telegram tool step limit** — Increased from 3 to 8 to match the web UI, enabling complex multi-tool queries
- **Swarm result delivery** — Push loop now handles both `research-*` and `swarm-*` briefing IDs, with distinct emoji labels (🔬 research, 🐝 swarm)

### Fixed

- **Swarm results not delivered** — Push loop only handled `research-*` briefing IDs, silently dropping `swarm-*` reports
- **Group chat research/swarm delivery** — Same root cause as above; both prefixes now resolve to originating chat
- **Debug toggle not persisting** — `loadConfig()` didn't read `debugResearch`, `workers`, or `knowledge` fields from config file, losing them on server restart
- **Telegram HTML injection** — User content in bot command responses (goals, titles, labels) is now escaped to prevent HTML injection via `escapeHTML()`
- **Docker missing plugin-swarm** — Dockerfile now includes `plugin-swarm` package in both build and runtime stages

### Added

- **Adaptive context window management** — Message history loading now adjusts based on model's actual context window size via TokenLens model registry (supports 337+ models). Small models (4K context) load fewer messages; large models (200K+) load more. Token-based budget enforcement ensures history never overflows the context window. For Ollama or unrecognized models, set `llm.contextWindow` in Settings or `PAI_CONTEXT_WINDOW` env var to override the default (8K).
- **Provider-specific context management** — Anthropic auto-compaction and tool-use clearing at 85% context usage, OpenAI auto-truncation. Passed via `providerOptions` on all `streamText`/`generateText` calls.

### Changed

- Chat and Telegram no longer hard-code 20-message history limit; context budget is computed per model with 50% allocated to history, clamped to 4–100 messages.

### Added

- **Knowledge TTL** — Sources can have a `max_age_days` (per-source or global default of 90 days). Background worker auto-deletes expired sources every 24 hours. Per-source TTL editable via `PATCH /api/knowledge/sources/:id`.
- **Freshness-weighted knowledge search** — Newer sources rank higher via decay factor (365-day half-life, 0.5x floor). Configurable via `knowledge.freshnessDecayDays`.
- **`workers.knowledgeCleanup` config toggle** — Enable/disable auto-cleanup of expired knowledge sources in Settings.
- **Learning run history** — Background learning now persists each run's outcome, signal counts, extracted facts, and duration to a `learning_runs` table. `GET /api/learning/runs` endpoint returns recent run history.
- **Learning history UI** — Settings page shows a collapsible "View history" section under Background Workers with last 10 learning runs. Each run shows status badge, signal summary, duration, and expandable extracted facts.
- **Startup recovery for stale learning runs** — On server restart, in-progress learning runs from a previous crash are marked as error with "Server restarted" message.
- **Shutdown abort signal for learning** — `WorkerLoop.stop()` aborts in-flight learning runs cleanly via `AbortSignal`, preventing operations against a closing database.
- **Concurrent learning run guard** — Prevents overlapping learning executions when timers race.
- **Startup stale job recovery** — On server restart, running background/research/swarm jobs from a previous crash are automatically marked as failed with "Server restarted — job interrupted" error. Stale swarm agents are also cascaded to failed.
- **Shutdown job cancellation** — Graceful shutdown marks all running jobs as cancelled before closing the database, preventing stuck jobs on intentional stops.
- **Sandbox execution logging** — `runInSandbox()` now accepts an optional logger and emits structured logs: execution start (language, code length, timeout), completion (exit code, stdout/stderr length, file count, duration), connection errors, and HTTP errors.
- **Swarm agent observability** — Jobs page now shows individual sub-agent cards with role, task, status, tools, steps used, duration, and expandable results/errors. Agents auto-refetch while job is active. Sorted by status: running first, then done, failed, pending.
- **Sandbox artifact persistence** — Swarm `run_code` tool now persists sandbox output files as artifacts via `storeArtifact()`. Artifacts section in Jobs detail sidebar shows files with MIME-type icons, human-readable sizes, inline image previews, and download links.
- **Enhanced blackboard rendering** — Code execution blackboard entries (`[code_execution]`) render with language badge, exit code badge (green/red), syntax-highlighted code block, collapsible stdout/stderr, and clickable artifact links.
- **Job artifacts API hooks** — New `useJobAgents()` and `useJobArtifacts()` TanStack Query hooks with corresponding `getJobAgents()` and `getJobArtifacts()` API functions.

### Changed

- **Server shutdown** — Uses structured NDJSON logger instead of `console.log` for shutdown messages.

### Fixed

- **Swarm sandbox auto-detection** — Swarm `run_code` tool now uses `resolveSandboxUrl()` for Railway/Docker auto-detection instead of reading `process.env.PAI_SANDBOX_URL` directly.
- **Swarm domain badges** — Swarm jobs in the job list now show domain badges (flight, stock, crypto, etc.) instead of always being blank. Fixed hardcoded `resultType: null` in swarm job list mapping.

- **Sub-agent swarm system** (`plugin-swarm`) — New plugin that decomposes complex tasks into 2-5 parallel sub-agents with specialized roles (researcher, coder, analyst). Sub-agents communicate via a shared SQLite blackboard and operate with budget-limited tools. An orchestrator plans subtasks via LLM, executes them in parallel with `Promise.allSettled`, then synthesizes results into a unified report delivered to the Inbox. Graceful degradation: falls back to single-agent execution if planning fails. New `swarm_start` tool in the assistant. Jobs page shows swarm jobs with agent progress and synthesis detail. New API endpoints: `GET /api/jobs/:id/agents`, `GET /api/jobs/:id/blackboard`.

- **Domain-specific research agents** — Research jobs now detect flight and stock queries automatically (via `detectResearchDomain()`) and use domain-specific LLM prompts that produce structured JSON results instead of plain markdown. Flight research returns `FlightReport` (scored options with prices, durations, booking links). Stock research returns `StockReport` (verdict, confidence, metrics, catalysts, risks, sources). General research unchanged. New `resultType` field on `BackgroundJob` and `ResearchJob`.
- **Flight results UI card** (`ToolFlightResults`) — Rich card in Inbox detail view showing ranked flight options with airline, times, duration, baggage, refund policy, score, and booking CTAs. Collapsible with route header. Markdown report rendered below.
- **Stock report UI card** (`ToolStockReport`) — Rich card with verdict badge (Strong Buy/Buy/Hold/Sell), confidence %, key metrics grid, catalysts, risks, sources with external links, and chart rendering.
- **Sandbox code execution** — Docker sidecar (`sandbox/`) running Python 3.12 + Node.js 20 for isolated code execution. HTTP API on port 8888. Includes matplotlib, pandas, numpy, plotly, yfinance. `run_code` tool in the assistant (gated by `PAI_SANDBOX_URL`). Output files saved as artifacts.
- **Artifact storage** — SQLite-backed binary blob storage for charts and output files. `GET /api/artifacts/:id` serves artifacts with correct MIME types. `GET /api/jobs/:jobId/artifacts` lists artifacts per job.
- **Stock chart generation** — When sandbox is available, stock research automatically generates dark-themed matplotlib price+volume charts, stored as artifacts and referenced in the report.
- **Inbox rerun** — `POST /api/inbox/:id/rerun` re-runs a research report with the same goal and domain type. "Rerun" button in Inbox detail view.
- **Jobs domain badges** — Jobs page shows "flight" or "stock" badges next to research jobs.
- **Typed research schemas** (`packages/core/src/research-schemas.ts`) — `FlightQuery`, `FlightOption`, `FlightReport`, `StockMetrics`, `StockReport`, `ResearchResult` types shared across core, plugins, and UI.
- **Docker sandbox service** — `docker compose --profile sandbox up -d` starts the sandbox sidecar. Opt-in via profile, 512MB memory limit, 1 CPU.

### Changed

- **Unified research & swarm system** — Swarm is now domain-aware: supports flight, stock, crypto, news, comparison, and general research types via required `type` parameter. Sub-agents use domain-specific prompts. Results rendered via `@json-render/react` dynamic UI — no raw JSON shown to users. Inbox shows domain badges. Jobs page shows swarm blackboard entries. Debug toggle in Settings for power users.
- **SearXNG web search** — Replaced Brave Search HTML scraping (broken by 429 rate limits) with self-hosted SearXNG JSON API. No rate limits, supports search categories (general, news, IT, images, videos, social media, files). SearXNG runs as a Docker sidecar (~50-100MB RAM). URL auto-detected in Docker/Railway or set via `PAI_SEARCH_URL`.
- **Worker extraction** — Extracted 4 inline `setInterval`/`setTimeout` background workers from the 700-line server `index.ts` into a reusable `WorkerLoop` class (`packages/server/src/workers.ts`). Briefing generator (6h), schedule runner (60s), and background learning (2h/5min delay) are now encapsulated with `start()`/`stop()`/`updateContext()`. Migrations extracted to `packages/server/src/migrations.ts`. Telegram research push loop moved to `packages/plugin-telegram/src/push.ts` where it belongs. Added `pai worker` CLI command for standalone worker execution and `packages/server/src/worker.ts` entry point.

### Added

- **Timezone localization** — All date/time formatting (system prompts, briefings, research reports, Telegram) now respects a configurable IANA timezone (e.g. `Asia/Kolkata`). Set via Settings UI, `PAI_TIMEZONE` env var, or `config.json`. Defaults to server timezone when unset.
- **Research report knowledge learning** — Completed research reports are automatically stored in the knowledge base so future research runs can build on previous findings instead of starting from scratch. Research prompt updated to check existing knowledge first and focus on new information.
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

- **Research domain misclassification** — `detectResearchDomain()` regex matched "and to the" as airport codes. Fixed by making `type` required on both `research_start` and `swarm_start` tools.
- **Raw JSON in UI** — Flight/stock results showed raw JSON when parsing failed. All rendering now goes through `ResultRenderer` with fallback chain.
- **Sandbox URL auto-detection** — `resolveSandboxUrl()` now auto-detects Railway and Docker environments, matching the pattern used by `resolveSearchUrl()`.
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

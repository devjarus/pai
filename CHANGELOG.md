# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- **Digest deterministic floor is finding-delta grounded** — Daily digests now build the fallback brief from research finding deltas (with source URLs, ranked by significance/authority), corrected beliefs, and completed actions instead of self-referential program/memory meta-text. Quiet days emit an honest "No material change since last brief" recommendation, and the LLM step is instructed to rewrite/tighten that grounded floor rather than invent filler.

### Fixed
- **Railway sandbox deploy crash-loop** — The sandbox image now creates `/.dockerenv` so PinchTab enables Chromium `--no-sandbox` on Railway/containerd (which often omit that marker). `PORT` defaults to `8888` for Railway healthchecks, `start.sh` keeps the code-execution API up if PinchTab/Chrome dies (with restart backoff), `sandbox/railway.toml` is restored, and Compose `PAI_SANDBOX_URL` points at `:8888` again. GHCR sandbox image rebuild is published from the fix branch (`:latest` and `:sha-<commit>`).
- **Web search no longer returns empty on `time_range=day`** — When SearXNG news/general engines return no hits for a narrow day filter (common for Bing/Google News), `webSearch` now widens to `week` and then unfiltered instead of silently returning nothing.

### Added
- **Capability-driven chat welcome prompts** — The four starter suggestions on a new chat now each exercise a distinct capability (live web search, deep research, recurring watches, product feedback to the pai developers) so first-time users are immediately exposed to what pai can do.

### Fixed
- **Research findings no longer store LLM preamble as summary** — The brief-content filter now also rejects narrating lead-ins ("Based on my research…", "Here are the fresh developments:", "I've gathered…", "Compiling findings…") and short list-intro lines ending in a colon. Research finding-storage also reuses this filter before falling back to the first report line, so findings carry the first real substantive sentence instead of a preamble. Prevents daily digests from flagging the pipeline as stalled when the underlying reports are fine.
- **Memory page scroll on mobile** — The Memories page now scrolls as a single column on mobile so the header and filter chips scroll away with the list, instead of occupying a fixed slice of the viewport and leaving the belief cards with nearly no scroll area. Desktop keeps the sticky-header + inner-grid-scroll layout.

### Added
- **Delete digests from home feed** — Each digest on the home page now has a delete button (on hover) that removes the brief with a confirmation dialog. Backed by a new `DELETE /api/digests/:id` endpoint and an optimistic-update React Query mutation.
- **Image attachment support in chat** — JPG, PNG, GIF, and WebP images can now be uploaded in chat and are passed as multimodal image parts to the LLM. Knowledge page also accepts image uploads.

### Fixed
- **Watch/brief placeholder text suppression** — Brief generation and watch summary parsing now filter meta placeholder lines (e.g. “Let me compile…” / “I need explicit direction…”) so recommendations and “what changed” use substantive findings instead of self-referential filler.
- **Research truncation warning leakage in digests** — Brief extraction now also suppresses truncation-diagnostic/meta lines (e.g. “Output truncation blocks delivery”, “pull raw research logs”, token-limit warnings) so recommendation cards show actual findings instead of pipeline troubleshooting text.
- **Duplicate watch brief spam suppression** — Research and swarm watch runs now skip creating a new briefing when the computed signal hash matches the last delivered briefing, preventing identical day-after-day repeats when nothing materially changed.
- **Settings edit no longer clears API tokens** — Saving settings when the LLM API key, Linear API key, or Telegram token was provided via environment variables no longer silently drops those secrets from the config file. Preservation now falls back to the in-memory config (which includes env-var-sourced values).
- **Scheduled research retries with exponential backoff** — Rate-limited research and swarm jobs now retry up to 3 times with exponential backoff (30s → 60s → 120s) instead of silently failing after 2 immediate retries. Swarm jobs now also retry on transient errors.
- **Recurring job failures now surface to retry logic** — Research and swarm background runners now rethrow terminal execution errors after marking job state, so the dispatcher can apply transient retry/backoff and failure notifications for scheduled runs instead of treating failed runs as successful completions.
- **Thread titles update when topic changes** — Thread titles now regenerate via LLM every 5 user turns (down from 10), starting at turn 3 (down from 5), using the last 10 messages with a prompt that focuses on the current topic rather than the original message.
- **Telemetry captures HTTP error messages** — API error responses now include the actual error message in telemetry spans instead of "Unknown error". Auth refresh 401s (expected token expiry) are no longer recorded as errors.
- **Failed background jobs notify users** — When research or swarm jobs permanently fail (after retries exhausted), a failure message is posted to the job's thread with the task name, error, and attempt count. No more silent failures.
- **Research briefs no longer pad with stale news** — Research prompts now explicitly require publication date checking, penalize old articles, and allow "no significant updates" instead of forcing content. The "always something new — dig harder" instruction that caused stale padding has been replaced with honest freshness guidance.
- **Activity page in main navigation** — The Jobs/Activity page is now always accessible from the sidebar and mobile tab bar (previously hidden behind a spinner that only appeared when jobs were active). Shows a blue pulse indicator when background jobs are running.

### Added
- **State-first recurring reports** — Digests now compute structured state deltas (new findings with diffs, changed insights, new/corrected beliefs, completed actions) instead of prompt-stuffing raw JSON. Each cycle compounds on the last through computed diffs.
- **Finding delta computation** — `ingestResearchResult()` auto-computes a deterministic sentence-level delta when a previous finding is linked, populating the existing `delta` column.
- **Signal hash for daily briefs** — Daily digests now compute and store `signal_hash` (SHA-256) like research briefs, enabling change detection across cycles.
- **Conversational and automatic Linear intake** — Settings now support a Linear API key, default team/project, and an `Auto-log recurring failures` toggle. The assistant can turn a short feature/bug conversation into a Linear issue with a native `linear_issue_create` tool, and the worker cleanup loop can now open one deduplicated Linear issue automatically when the same telemetry failure fingerprint crosses a recurring-error threshold.

### Fixed
- **Linear project lookup compatibility** — The Linear integration now uses `Project.slugId` instead of the deprecated `slug` field, matching the current GraphQL API and preventing issue creation from failing during project resolution.
- **Watch research for GitHub/HN/Reddit** — Research agent now uses `web_search` + `read_page` directly for trending sources instead of depending on a broken RSSHub instance. Removed all RSS/RSSHub code.
- **Raw JSON report rendering** — News and research reports that the LLM returned as raw JSON (without code fences) now render as formatted markdown instead of dumping raw JSON to the screen.
- **Background learning watermark safety** — Learning runs now advance source watermarks to the latest processed row timestamp instead of wall-clock `now`, preventing mid-run thread/research/task/finding rows from being skipped permanently.
- **Digest correction lineage** — Corrections triggered from a Digest now preserve the originating Digest link and add provenance on the replacement belief, so future compounding and audits can trace exactly which Digest prompted the correction.
- **Research evidence calibration** — Research finding ingestion now extracts external sources from structured output and markdown reports, and finding confidence is calibrated from real source coverage plus actual search/page activity instead of stale budget heuristics.
- **Research novelty calibration** — Follow-up research runs now penalize repeated-source, low-delta findings, persist explicit delta data to the finding chain, and prevent low-confidence repeated cycles from compounding into durable insights.
- **Research source-authority calibration** — Finding sources now carry authority tiers, research confidence rewards authoritative and primary evidence over forum/aggregator repetition, and the general research prompt explicitly prefers official sources when available.
- **Learning cursor safety** — Background learning now batches source rows oldest-first with stable rowid cursors, preventing high-volume backlogs and same-timestamp rows from being skipped across runs.
- **Quality metric alignment** — Learning quality now counts finding/digest-driven runs, compounding coverage only measures active watches with credible findings, and sparse datasets no longer receive free high-confidence quality credit.

### Changed
- **Telegram group proactive cadence** — Passive group chime-ins now default to at most one proactive message per group per UTC day (instead of frequent minute-scale nudges), and active groups can receive one daily interesting-topic starter even when memory relevance is low.
- **Coding-agent harness scaffold** — Added `harness/README.md`, block-specific checklists, task/evidence templates, and a new `pnpm harness:regressions` validator so contributors and coding agents can follow the architecture-block workflow consistently.
- **Harness workflow simplified** — AGENTS and harness guidance now center on owner block, guardrails, minimal change, and correct validation. Task/evidence templates are now optional for larger or riskier work instead of implied paperwork for every scoped fix.
- **Repo hygiene regression guard** — `pnpm harness:regressions` now also scans tracked files for committed secret-like credentials, tracked config/env files, and hardcoded Linear default team/project literals in runtime source.
- **Agent-plane harness boundary** — The core agent harness now carries explicit agent identity, declared core-platform block access, preloaded context/previous findings, budget status, and telemetry hooks. The research agent now uses that contract with knowledge/watch/task context instead of treating the harness as a thin wrapper.
- **Architecture block docs** — Added `docs/architecture/*` pages to document the Core Platform vs Agent Plane split and the dependency rules for future refactors.
- **Research plugin split** — `research.ts` (1700 lines) split into 6 focused modules: types, repository, prompts, tools, charts, and orchestration. Extracted shared `mapRow` helper to eliminate 4x duplicated row mapping.
- **Assistant plugin split** — `index.ts` (347 lines) split into system prompt, auto-memory extraction, and plugin wiring.
- **Shared datetime utilities** — Consolidated 14 duplicate `timeAgo`/`formatDate`/`formatInterval` functions across 11 UI files into `lib/datetime.ts`.
- **Unified Library API** — All memory and knowledge routes consolidated under `/api/library/*`. Deleted legacy `/api/beliefs`, `/api/remember`, `/api/forget`, `/api/knowledge/*` route files. UI retargeted to canonical paths.
- **Memory quality improvements** — Removed insight belief generation (universally unused platitudes), widened dedup check from top-1 to top-3 candidates, added subject alias table for identity resolution, added scheduled belief pruning, filtered codebase-related beliefs from learning worker, removed per-message auto-memory extraction (background learning worker handles it — cuts ~8 LLM calls per chat message).
- **Rating feedback loop** — Digest ratings now structurally affect belief scoring. Beliefs from poorly-rated digests (1-2 stars) get -5 to -10 penalty in future digests. Beliefs from well-rated digests (4-5 stars) get +4 to +8 bonus.
- **Entity-aware memory extraction** — `extractBeliefs()` and background learning now extract `relatedTo` (entity connection) and `temporal` (ISO date) context, stored as `[related: X]` and `[when: Y]` tags in belief statements.
- **Scheduled belief dedup** — 24h automatic merging of near-duplicate beliefs (cosine > 0.85) via `reflect()` + `mergeDuplicates()`.
- **Active jobs banner** — Home page sidebar shows a compact indicator when research/swarm jobs are running or queued, linking to `/jobs` for details.
- **Multi-fact extraction** — `extractBeliefs()` now extracts up to 3 facts per input instead of 1. "I work at Stripe and prefer TypeScript" captures both facts.
- **Better subject matching** — Recall strips possessives ("Alex's" → "alex") and resolves aliases from `subject_aliases` table for boosting.
- **Time-of-day digest scheduling** — New `workers.briefingTime` config (e.g. "08:00") sends one digest per day at a specific time instead of every-6h interval.
- **Digest knowledge feedback loop** — Digest conclusions (recommendation, what-changed, next-actions) stored as 14-day TTL knowledge. Next digest searches knowledge base for relevant prior context via `knowledgeSearch()`. Capped at 5 digest + 10 research knowledge entries.
- **Profile consolidation** — Scheduled 24h worker merges scattered preference beliefs into dense profile statements via LLM. 18 "concise" variants become 1 comprehensive preference. Profile summary card on Memory page.
- **Quick-follow topics** — One-tap Watch creation: `POST /api/watches/follow` takes a topic, creates a Watch with defaults, triggers first research immediately. Available from Watches page UI and chat.
- **Global activity indicator** — Spinning icon in sidebar (desktop) and mobile tab bar when jobs are running. Visible from any page, links to /jobs.
- **Unified Watch terminology** — All user-facing strings say "Watch" instead of "Program". Chat tool responses, system prompt, help text updated.
- **Quality scoring upgraded** — `/api/library/quality` now reports recent loop health using ratio-based metrics for learning reliability, memory utilization/provenance, feedback activity, and evidence-backed compounding coverage instead of simple lifetime counts.
- **Finding evidence quality metrics** — `/api/library/quality` now tracks finding source coverage and whether high-confidence findings are actually backed by multiple sources, and memory reinforcement no longer treats repeated reads as reinforcement.
- **Finding novelty metrics** — `/api/library/quality` now reports chained-finding novelty coverage and how many high-confidence findings are actually novel enough to justify their score.
- **Finding authority metrics** — `/api/library/quality` now reports authoritative and primary source coverage, plus how many high-confidence findings are backed by authoritative sources instead of only raw URL diversity.
- **Quality scorecard v2** — `/api/library/quality` now exposes sample-aware domain scores for Trust, Loop Efficacy, Reliability, and User Value. User Value now scores real outcomes including digest-linked action completion, correction carry-forward into the next digest, trusted decision loops from opened digests, and explicit recommendation acceptance on daily digests. Web digest opens now count on the main `/api/digests/:id` path instead of only the legacy inbox route, and daily recommendations can be marked accepted directly from the digest UI through an idempotent `/api/digests/:id/accept` action. The Home sidebar surfaces those domains directly instead of collapsing everything into a single opaque bar.
- **Compounding evidence gate** — Weekly compounding now requires each persisted topic insight to cite at least two supporting findings and uses similarity-based matching to update existing insights instead of accumulating near-duplicates.
- **Learning noise filter** — Background learning now drops duplicate and low-signal “activity” facts before writing beliefs, while still keeping extracted-fact counts in run history for diagnostics.

### Fixed
- **Research job retry on abort** — "This operation was aborted" from LLM providers is now treated as a transient error, triggering automatic retry (up to 2 times) instead of permanent failure.
- **Knowledge accumulation cap** — Digest knowledge capped at 5 entries, research at 10. Prevents unbounded growth between TTL cleanup runs.
- **Research synthesis fallback** — When web search returns empty results, synthesis pass now uses previous findings from Library instead of producing "no report generated."
- **Clean digest titles** — Strips LLM preamble ("Based on my research...") and enrichment context from research report titles.
- **Config save/load** — Fixed post-reinitialize config reset (workers, knowledge, URLs reverted to defaults). Exposed `timezone`, `webSearchEnabled`, `briefingTime` to Settings UI.
- **Document delete crash** — Fixed `.filter is not a function` error on document removal (wrong query key scope in optimistic update).
- **Idle worker optimization** — Dedup and profile consolidation skip when no new beliefs exist. Zero LLM calls when idle.

- **Product language rename:** Program → Watch, Brief → Digest, Belief → Memory, Action → To-Do
- **Library domain:** Unified `/api/library/*` API combining memories, documents, and research findings
- **Merged Library page:** Single page with Memories, Documents, Findings tabs and unified search
- **CLI renamed:** `pai library` commands replace `pai memory` and `pai knowledge` (old commands deprecated)
- **MCP tools renamed:** `library-*` tools replace `remember`, `recall`, `knowledge-*` (old names deprecated)
- **Agent harness:** Plan → Execute → Reflect pattern scaffolded in core
- **Feature flags:** Config-driven phased rollout for domain restructure
- **Telegram renamed:** Commands updated to `/digests`, `/watches`, `/library`, `/todo`
- **Watches domain:** New `@personal-ai/watches` package wrapping Programs with templates, depth levels, and delta research
- **Research depth:** Quick/Standard/Deep levels control agent effort per Watch
- **Delta research:** Research agents build on previous findings stored in Library — no more repeating old results
- **Watch templates:** Preset configurations for Price, News, Competitor, Availability watches
- **Watch API:** `/api/watches/*` routes with template creation, manual trigger, and depth-aware dispatch
- **Agent harness wired:** Research agents now use plan/execute/reflect tracking with confidence scoring
- **Watches UI:** Template creation flow, Watch detail with findings tab, manual run trigger
- **Digests API:** `/api/digests/*` routes with correction writeback, quality rating, and suggested to-dos
- **Digest rating:** 1-5 star rating with optional feedback on each digest
- **Inline correction:** Correct memory assumptions directly from digest detail → flows back to Library
- **Feedback loop:** Low digest ratings and user feedback influence next generation prompt
- **Auto-suggest to-dos:** Digest recommendations surface as actionable to-do suggestions
- **Digests UI:** Rating widget, correction dialog, suggested to-dos section in digest detail
- **Home dashboard:** New landing page with latest digest summary, active watches, open to-dos, library stats, and quick ask
- **Simplified onboarding:** 4-step flow — welcome, LLM setup, first memory, first watch
- **To-Do source links:** Each to-do shows which Watch or Digest it came from with clickable links
- **Navigation update:** Home as default landing, Digests as dedicated nav item, 6-item sidebar

### Added

- **Brief provenance trail** — Daily brief detail views now show a "Why this brief?" collapsible panel that traces the full provenance chain: which sources, beliefs, corrections, and evidence shaped the recommendation. Memory assumption cards display inline origin badges (you said, web, document, inferred). New `brief_beliefs` junction table links briefs to the exact beliefs selected during generation, and corrections track which brief prompted them. New `GET /api/inbox/:id/provenance` endpoint assembles the full chain.
- **Roadmap runtime v1** — Added Program authored/runtime state (`objective`, `phase`, `deliveryMode`, `sourceRefs`, `latestBriefId`, `lastDeliveredAt`, `lastEvaluatedAt`, `lastSignalHash`), Program detail/history APIs, belief trust metadata (`origin`, `freshness_at`, `correction_state`, `sensitive`), explicit `belief_provenance` links, `product_events` analytics storage, `/api/product-metrics/overview`, and executable `travel-watch` / `buying-watch` core-loop harness coverage alongside `work-watch`.
- **Programs v1 surface** — Added a first-class Programs API and UI built as a thin wrapper over scheduled jobs, including create/edit/pause/resume/delete flows and roadmap-aligned navigation to `Programs` and `Ask`.
- **Agent-agnostic implementation harness** — Added a repo-native agent harness with a thin coordinating `AGENTS.md`, product and boundary docs, short decision logs, task/evidence templates, validation checklists, core-loop scenarios, practical JSON schemas, and runnable `harness:core-loop` / `harness:regressions` scripts for portable agent discipline.
- **Cerebras provider support** — Added first-class Cerebras support across the core LLM client, config validation, CLI setup, settings/onboarding flows, health checks, and context budgeting. Cerebras uses the official `@ai-sdk/cerebras` provider with local embedding fallback.
- **Per-instance diagnostics** — Added a local observability system that records LLM, embed, tool, HTTP, and worker spans in SQLite. New owner-facing diagnostics panel lives in Settings with Overview, Processes, Threads, Jobs, and Errors tabs for token, latency, and failure visibility.
- **LLM traffic shaping controls** — Added instance-level queue controls in Settings for max LLM concurrency, background start gap, startup delay, and swarm agent concurrency. Jobs and diagnostics now expose queue position, wait reason, queue wait metrics, and live lane depth.
- **Swarm-friendly traffic defaults** — Default LLM traffic shaping now allows up to 5 concurrent swarm sub-agents with one reserved interactive slot, so a single swarm can investigate in parallel without fully blocking chat responsiveness.
- **Inline structured chat visuals** — Web chat now renders valid `jsonrender` blocks inline inside assistant replies, and `run_code` tool cards reuse the shared result renderer for generated image artifacts while keeping downloadable file fallbacks.
- **Native json-render charts** — Added first-pass `LineChart`, `BarChart`, and `DonutChart` components so structured research results can render real in-app charts when quantitative data exists, while still keeping artifact images as fallback.

### Changed

- **Guided first Program in onboarding** — Setup and Onboarding now create a Program from the "what do you check every few days?" field, so new users get their first daily brief without needing to discover Programs separately. Post-onboarding navigates to Home (Inbox) instead of Ask.
- **Research retry on transient failures** — Research jobs that fail due to transient LLM errors (connection refused, timeouts, rate limits) are automatically re-queued up to 2 times instead of permanently failing.
- **Research builds on previous findings** — Scheduled Program research now injects the previous brief's recommendation summary and date into the research goal, so the LLM focuses on what's NEW instead of repeating old findings. Research report knowledge sources auto-expire after 7 days to prevent stale data accumulation.
- **Structured memory write path** — Background learning and assistant auto-memory now preserve extracted `{statement, factType, importance, subject}` metadata and write through a dedicated `rememberStructured()` path instead of re-running memory extraction on the same fact.
- **Watch dedupe clarity** — Repeated `Keep watching` attempts now reuse the existing Program for the same thread or equivalent recurring watch, the Programs API distinguishes created vs reused results, and Ask/Inbox surfaces stop implying a second watch was created when pai is already watching it.
- **Saved move language refresh** — User-facing follow-through copy now uses `Recommended move`, `Save move`, and `Saved Moves` instead of `Commitment`, so the secondary `/tasks` surface reads as lighter recommendation carry-forward instead of a heavy promise or todo board.
- **Commitment model cutover** — Programs no longer offer generic Program-side tracked-step creation, Brief recommendations remain inline by default, saved moves are explicit and user-owned, and the secondary `/tasks` surface now presents those persisted moves as `Saved Moves` across web, chat tool cards, landing/setup copy, and Telegram command/help text.
- **Telegram companion delivery** — Telegram now prefers concise recommendation-first brief digests over long inline report dumps, complex chat replies auto-attach PDFs instead of fragile HTML documents, research/swarm pushes attach PDF reports with visuals, and the standalone bot migrates schedule tables so `/programs` and brief push targeting work consistently.
- **Loop-first Home shell** — Home now leads with active Programs, open Actions, and the latest Brief before the historical brief archive, so Ask-created watches and follow-through are visible even when there is no fresh brief yet.
- **Follow-through boundary reset** — The `/tasks` surface now behaves as a secondary saved-move ledger instead of a generic todo board. Program-linked follow-through no longer defaults to a rephrased `review` step, Briefs present `Recommended Moves` inline, duplicate open linked steps are suppressed for the same Program or Brief, and Telegram/setup copy now follows the same product boundary.
- **Trust-safe briefing memory selection** — Daily brief generation now filters memory assumptions and raw belief context to active, non-sensitive, context-relevant beliefs only. Irrelevant personal/social beliefs are suppressed unless the current watch explicitly names that subject.
- **Ask-driven loop refresh** — When a chat run finishes, the web client now refreshes Programs, Actions, Inbox, and Beliefs together instead of only Threads, so tool-created Programs become visible across the shell without waiting for manual navigation or a polling lag.
- **Unified brief contract across recurring outputs** — Research and swarm runs now persist the same recommendation-first brief shape used by daily briefs, Program-linked runs can suppress unchanged user-visible briefs via signal hashing, and Telegram consumes daily/program/research/swarm briefs as one companion delivery surface with quick reply, correction, and action flows.
- **Product positioning cutover** — Landing page, onboarding/setup copy, README metadata, and mobile navigation now present `pai` as a recurring decision agent centered on Home, Programs, Ask, Memory, and Settings instead of a broad equal-weight platform surface.
- **Ask is program-first** — Assistant recurring-work tools and prompt copy now create, list, and delete Programs in chat instead of exposing schedules as the primary user-facing recurring abstraction. Existing schedule tool cards remain supported for older thread history.
- **Explicit Keep watching path** — Ask threads and Inbox detail views now expose a visible `Keep watching this` action that creates Programs directly, and Ask-originated Programs preserve their source thread id through the public web API for continuity.
- **Brief trust loop write-through** — Daily briefing detail now exposes the exact beliefs behind a brief, and users can correct one inline to invalidate the old belief, create a replacement, and feed future briefs with the corrected memory instead of prompt-only feedback.
- **Actions linked to Briefs and Programs** — Brief next steps and Program follow-through can now create durable linked actions, Programs show their attached actions directly, and the Tasks screen preserves the originating Brief or Program context instead of flattening follow-through into detached to-dos.
- **Action-aware briefs** — Daily brief generation now treats linked Program and Brief actions as first-class follow-through context, so open actions can change the recommendation, completed actions become change signals, and repeated next steps are suppressed instead of being reissued blindly.
- **Recommendation-first Briefs v2** — Daily brief generation now produces recommendation, what changed, evidence, memory assumptions, next actions, and correction hooks, with Inbox compatibility for both the new brief shape and legacy stored briefings.
- **Executable core-loop proof** — `harness:core-loop` now runs a real runtime scenario for `work-watch`: it creates a Program, generates a structured brief, applies a correction, regenerates the brief, and asserts stale assumptions are suppressed.
- **End-to-end telemetry coverage** — Chat, Telegram, background learning, briefings, research, swarm execution, memory extraction, and knowledge embeddings now emit standardized process-level telemetry. Assistant thread messages also persist compact usage summaries for diagnostics without exposing raw metrics in normal user-facing flows.
- **Background dispatch smoothing** — Research, swarm, and daily briefing generation now enqueue into a single background dispatcher instead of starting immediately. Restarts requeue unfinished research/swarm/briefing work as `pending`, scheduled jobs dedupe by schedule, manual work is prioritized ahead of scheduled and maintenance work, and swarm agent execution is staggered to avoid bursting the LLM server.
- **Cerebras default model** — Setup wizard, Settings presets, and `pai init` now default Cerebras to `gpt-oss-120b` instead of `zai-glm-4.7` so fresh configurations land on a model that works with the currently tested account access path.
- **Memory insight persistence** — `remember()` now persists extracted insight beliefs alongside the primary fact belief, so insight-type memories populate during normal usage instead of only via manual creation paths.
- **Recall type balancing** — Semantic recall now caps `insight`/`meta` entries to about one-third of the requested limit when concrete fact/preference/procedural/architectural matches exist, preventing high-level beliefs from crowding out actionable memories.
- **Research/swarm chart fallback in Inbox + Jobs** — Report detail endpoints now fall back to artifact-derived visuals when persisted briefing metadata contains an empty `visuals` array, restoring chart rendering for existing research and swarm reports in both Inbox and Jobs views.

### Security

- **Telegram report privacy** — Removed Telegraph-based public article publishing from the Telegram bot. Research and analysis reports are now delivered as protected Telegram messages, images, and attached HTML report documents instead of public-by-link pages.
- **SVG XSS prevention** — Removed `image/svg+xml` from inline display whitelist for artifacts. SVGs are now force-downloaded, preventing stored XSS via embedded JavaScript. Added CSP `sandbox` header as defense-in-depth for SVG/HTML artifacts.
- **SQL injection hardening** — Added table name allowlist validation to `resolveIdPrefix()` to prevent SQL injection via table name interpolation.
- **Login brute-force protection** — Reduced auth login rate limit from 20/min to 5/min. Added 3/min rate limit on setup endpoint.
- **SSRF redirect bypass fix** — Page fetcher now manually follows redirects (up to 5) and re-validates each redirect target against the SSRF blocklist, preventing attackers from redirecting to internal IPs.
- **Expanded SSRF blocklist** — Added `0.0.0.0`, `[::0]`, `[::]`, full `127.x.x.x` loopback range, and `metadata.internal` to the blocked hosts list.
- **CSRF protection for DELETE** — DELETE requests now validate Origin/Referer headers to prevent cross-origin state-changing requests.
- **Sandbox authentication** — Code execution sandbox now supports optional shared-secret authentication via `PAI_SANDBOX_SECRET` environment variable.

### Changed

- **Analysis execution mode** — Schedules, Inbox reruns, and assistant-created recurring jobs now distinguish between lightweight `research` runs and deeper `analysis` runs. Analysis schedules dispatch through the swarm pipeline, preserve execution mode on rerun, and receive sandbox/browser/dataDir context so scheduled visual reports can use code execution, browser tools, and artifacts.
- **Shared report presentation pipeline** — Research and swarm jobs now persist a normalized presentation payload with execution mode, visuals, structured data, and merged render specs. Jobs, Inbox, web chat, and Telegram now consume the same report/visual contract instead of scraping fenced JSON from markdown.
- **Telegram visual delivery** — Report summaries now send inline chart photos before the attached full-report document, and direct chat artifact delivery sends image outputs as photos instead of generic documents.
- **Filesystem-backed artifacts** — Artifacts (screenshots, charts, reports) are now stored on disk at `{dataDir}/artifacts/` instead of as SQLite BLOBs. Keeps the database lean and makes cleanup trivial. Migration v2 runs automatically on server startup — no manual setup required.
- **Artifact auto-cleanup** — Background worker deletes artifacts older than 7 days (runs every 24 hours). Also cleans up orphan files on disk that have no matching DB records.
- **Telegram HTML report readability** — Downloaded Telegram research/swarm report documents now use richer markdown-to-HTML rendering with proper headings, paragraphs, ordered/unordered lists, blockquotes, links, and improved document styling for browser viewing.

### Added

- **Report visuals metadata** — Added shared `ReportExecution`, `ReportVisual`, and `ReportPresentation` types plus deterministic visual manifest parsing and render-spec merging for chart/image artifacts.
- **Visual gallery fallbacks** — Inbox, Jobs, and chat tool results now use shared gallery components to render persisted chart PNGs and other artifacts consistently when specs omit them.
- **Chat document upload** — Attach text documents (`.txt`, `.md`, `.csv`, `.json`, `.xml`, `.html`, code files) directly in the chat composer via drag-and-drop or the attachment button. Documents are automatically stored in the knowledge base and included in the LLM context for analysis, Q&A, and comparison.
- **Downloadable analysis reports** — New `generate_report` agent tool creates downloadable Markdown reports from chat conversations. Includes a tool card with a one-click download button. Ask the assistant to "generate a report" or "create an analysis document" to trigger it.
- **Document upload + analysis** — Added `/api/knowledge/upload` and Knowledge UI flow to upload text-based docs (`.txt`, `.md`, `.csv`, `.json`, `.xml`, `.html`), index them into the knowledge base, and generate a quick AI analysis summary
- **Research export actions** — Research detail view now supports direct export to Markdown/JSON and print-to-PDF for sharing reports
- **`/jobs` command** — View recent research and swarm job status directly from Telegram with status emojis and relative timestamps
- **`/research` command** — Start research directly from Telegram with `/research <query>` shortcut
- **Memory Curator delegation** — Telegram assistant can now delegate to the Memory Curator sub-agent for memory health analysis and fixes

### Changed

- **Telegram tool step limit** — Increased from 3 to 8 to match the web UI, enabling complex multi-tool queries
- **Swarm result delivery** — Push loop now handles both `research-*` and `swarm-*` briefing IDs, with distinct emoji labels (🔬 research, 🐝 swarm)

### Fixed

- **Built UI asset routing** — Production server static hosting now serves nested `/assets/*` files correctly, preventing blank-page reloads caused by JavaScript and CSS requests falling through to `index.html`.
- **Provider setup error visibility** — LLM setup "Test Connection" now performs a tiny inference instead of a shallow provider health check, so billing, quota, auth, and model-access failures surface with the provider's actual error message.
- **Wasteful thread title token usage** — Short chats now keep cheap heuristic titles instead of immediately invoking the full LLM title path. LLM-generated title refreshes only start on longer threads and the title call itself is capped to a tiny output budget, cutting unnecessary token burn and queue time.
- **Hung background LLM calls** — Research, swarm, and daily briefing generation now set explicit AI SDK timeouts so a stalled provider step cannot hold the background dispatcher indefinitely and leave jobs stuck in `running`.
- **Silent Ask failures on provider auth errors** — Ask now surfaces streamed provider failures such as `unauthorized` to the chat UI instead of ending the SSE stream with a blank response, so broken credentials and model access issues are visible immediately.
- **Nested chat LLM slowdown** — Nested LLM work inside an active chat or analysis turn now reuses the parent traffic permit instead of queueing for a second slot. This keeps sub-agent delegation and in-turn follow-up LLM calls from stalling behind background work.
- **Telegram raw JSON responses** — Bot now detects JSON-only responses and converts them into Telegram-friendly structured sections and bullet lists for readable delivery.
- **Telegram report link sanitization** — Telegram markdown rendering now allows only `http`/`https` URLs and strips unsafe protocols (for example `javascript:`), preventing untrusted report content from turning into executable or malformed links.
- **Swarm results not delivered** — Push loop only handled `research-*` briefing IDs, silently dropping `swarm-*` reports
- **Group chat research/swarm delivery** — Same root cause as above; both prefixes now resolve to originating chat
- **Debug toggle not persisting** — `loadConfig()` didn't read `debugResearch`, `workers`, or `knowledge` fields from config file, losing them on server restart
- **Telegram HTML injection** — User content in bot command responses (goals, titles, labels) is now escaped to prevent HTML injection via `escapeHTML()`
- **Docker missing plugin-swarm** — Dockerfile now includes `plugin-swarm` package in both build and runtime stages
- **Timezone consistency across UI and Telegram jobs** — SQLite UTC timestamps are now normalized before parsing, preventing hour offsets and mismatched relative times between web UI and Telegram outputs.

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
- **Artifact storage** — Filesystem-backed artifact storage at `{dataDir}/artifacts/`. Metadata in SQLite, binary data on disk. Auto-cleanup of artifacts older than 7 days. `GET /api/artifacts/:id` serves artifacts with correct MIME types. `GET /api/jobs/:jobId/artifacts` lists artifacts per job.
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

- **Structured report text contrast** — Shared `json-render` result components now use theme-aware foreground and surface tokens instead of dark-only zinc colors, restoring readable body copy, bullet lists, tables, and source chips in light-surface brief and report detail views.
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

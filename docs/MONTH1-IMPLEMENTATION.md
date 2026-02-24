# Month 1 Roadmap — Implementation Report

**Period:** Feb 24 – Mar 28, 2026
**Branch:** `feature/month1-roadmap` (merged to `main`)
**Commit:** `05f24b6`
**Stats:** 32 files changed, +2554/−135 lines, 331 tests passing

---

## Goal 1: Memory Reliability Audit & Fixes (P1 Critical)

### Task 1.1 — Memory Lifecycle Diagram

Created `docs/MEMORY-LIFECYCLE.md` (268 lines) documenting every code path from user input to belief storage, with mermaid flowcharts covering:

- **Ingestion:** `remember()` → `createEpisode()` → `llm.embed()` + `extractBeliefs()`
- **Deduplication bands:** >0.85 reinforce, 0.70–0.85 grey zone, <0.70 new belief
- **Retrieval scoring:** 50% cosine + 20% importance + 10% recency + 5% stability + 15% subject match
- **Maintenance:** reflect, synthesize, prune, decay formula
- **All similarity thresholds** in a reference table

### Task 1.2 — Recall Benchmark Script

Created `packages/core/test/bench/recall-benchmark.ts` (276 lines):

- Seeds 500 beliefs across 5 types with 384-dim random embeddings
- Runs 100 semantic search queries
- Reports p50/p95/p99 latencies to stdout
- Exports per-query timings to CSV

### Task 1.3 — Grey Zone Edge Cases

Created `packages/core/test/memory/contradiction-edge-cases.test.ts` (810 lines, 24 tests):

| Category | Tests | Examples |
|----------|-------|---------|
| False contradictions | 5 | Refinement, additive detail, temporal coexistence, different scope, complementary preferences |
| Correct contradictions | 3 | Soft negation, implied contradiction, value change |
| Ambiguous → reinforce | 3 | Intensity change, specificity increase, synonym substitution |
| Evidence weighing | 2 | Well-supported belief weakening, equal evidence balance |
| classifyRelationship unit | 5 | Paraphrases, opposites, compatible, unrecognized, trailing text |
| checkContradiction parsing | 3 | Trailing period, explanation text, prefixed numbers |
| Band boundaries | 2 | Exact 0.85 and 0.70 boundary behavior |

### Task 1.4 — Fix False Contradiction Detection

Refactored `packages/core/src/memory/remember.ts`:

**New function: `classifyRelationship()`** — three-way grey zone classifier replacing the binary `checkContradiction()` in the 0.70–0.85 band:

```typescript
export async function classifyRelationship(
  llm: LLMClient, newStatement: string, existingStatement: string, logger?: Logger,
): Promise<"REINFORCEMENT" | "CONTRADICTION" | "INDEPENDENT">
```

- **REINFORCEMENT** — paraphrase, synonym, intensity or specificity change
- **CONTRADICTION** — mutually exclusive statements
- **INDEPENDENT** — related but compatible (different scopes, additive detail)

**Proportional evidence weighing** for contradictions against well-supported beliefs:

```typescript
if (supportCount >= 3) {
  const drop = Math.min(0.2, 1 / (supportCount + 1));
  // Weaken old belief proportionally, keep both active
} else {
  // Invalidate old, replace with new
}
```

### Task 1.5 — Embedding Index Optimization

Verified that migration v9 already creates indexes on belief embeddings. Brute-force cosine search is appropriate for the target scale (<10K beliefs) — no additional indexing needed.

### Task 1.6 — Regression Test Suite

Confirmed 130+ memory tests across 6 test files, well exceeding the 30-test minimum:

| File | Tests |
|------|-------|
| `memory.test.ts` | 60 |
| `contradiction-edge-cases.test.ts` | 24 |
| `lifecycle.test.ts` | 21 |
| `remember.test.ts` | 16 |
| `memory-file.test.ts` | 5 |
| `consolidate.test.ts` | 4 |

### Task 1.7 — Re-run Benchmark

Benchmark script ready. Run with `npx tsx packages/core/test/bench/recall-benchmark.ts` against a running Ollama instance.

---

## Goal 2: Cloud LLM Support (P1 Critical)

### Task 2.1 — Harden Provider Path

Added `humanizeError()` to `packages/core/src/llm.ts` mapping raw errors to friendly messages:

| Error Pattern | User Message |
|---------------|-------------|
| 401, 403, `unauthorized` | "Invalid API key for {provider}. Check Settings." |
| 404, `model not found` | "Model not found. Verify the model name in Settings." |
| `ECONNREFUSED`, `ENOTFOUND` | "Cannot reach {provider}. Is the service running?" |
| 429, `rate limit` | "Rate limited. Please wait a moment." |
| `quota`, `billing`, 402 | "Quota or billing issue. Check your account." |

All `chat()`, `streamChat()`, and `embed()` calls wrapped with try/catch + `humanizeError()`.

### Task 2.2 — Google/Gemini Provider

- Added `@ai-sdk/google` dependency
- Integrated into `createProviderModel()`, `createProviderEmbedding()`, and `health()`
- Default embedding model: `text-embedding-004`
- Default chat model: `gemini-2.0-flash`
- Extended `Config.llm.provider` type with `"google"`
- 7 new LLM tests covering Google construction, chat, health, embeddings, and error handling

### Task 2.3 — Auto-Populated Provider Settings

Added `PROVIDER_PRESETS` to `packages/ui/src/pages/Settings.tsx`:

| Provider | Base URL | Model | Embed Model |
|----------|----------|-------|-------------|
| Ollama | `http://localhost:11434` | `llama3.2` | `nomic-embed-text` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o` | `text-embedding-3-small` |
| Anthropic | `https://api.anthropic.com` | `claude-sonnet-4-20250514` | _(none)_ |
| Google AI | `https://generativelanguage.googleapis.com/v1beta` | `gemini-2.0-flash` | `text-embedding-004` |

Selecting a provider auto-fills all fields. Provider input changed from text to `<select>` dropdown.

### Task 2.4 — Token Usage Display

Added `TokenBadge` component to `packages/ui/src/pages/Chat.tsx`:

- Reads `message.metadata.usage` from AI SDK streaming responses
- Displays subtle badge below assistant messages: `{input} in / {output} out`
- Only renders when token data is available
- Styled with muted monospace at 10px

---

## Goal 3: One-Click Installer + Docker (P1 Critical)

### Task 3.1 — Multi-stage Dockerfile

Created `Dockerfile` (92 lines):

- **Stage 1 (Builder):** Node 20 Alpine, pnpm 9.15.3, installs build deps (python3, make, g++ for better-sqlite3), builds all packages, prunes dev deps
- **Stage 2 (Runtime):** Node 20 Alpine, copies only dist + prod node_modules, exposes port 3141, mounts `/data` volume
- Target: <400MB image

### Task 3.2 — Docker Compose with Ollama

Created `docker-compose.yml` (57 lines):

- **pai service:** builds from Dockerfile, port 3141, depends on Ollama health
- **ollama service:** `ollama/ollama:latest`, port 11434, model volume
- Health checks on both services (30s interval)
- Named volumes for data persistence (`pai-data`, `ollama-models`)
- Optional NVIDIA GPU passthrough (commented out)

### Task 3.3 — Docker Publish Workflow

Created `.github/workflows/docker.yml` (59 lines):

- Triggers on `v*` tag push
- Builds with Docker Buildx + GHA cache
- Pushes to GHCR (`ghcr.io/{repo}`) and optionally Docker Hub
- Tags: `v{X.Y.Z}`, `{X.Y}`, `latest`

### Task 3.4 — Install Script

Created `install.sh` (88 lines):

```bash
curl -fsSL https://raw.githubusercontent.com/devjarus/personal-ai/main/install.sh | bash
```

- Checks Docker + Docker Compose
- Creates `~/.personal-ai/data/`
- Downloads `docker-compose.yml` from GitHub (falls back to local)
- Pulls and starts containers
- Prints Web UI URL + management commands

---

## Goal 4: Automated DB Migration System (P1 Critical)

### Task 4.1–4.3 — Migration System Enhancement

The `_migrations` table and `storage.migrate()` already existed. Enhancements in `packages/core/src/storage.ts`:

**Transaction wrapping** — each migration runs in BEGIN/COMMIT with ROLLBACK on failure:

```typescript
try {
  db.exec("BEGIN");
  db.exec(m.up);
  db.prepare("INSERT INTO _migrations (plugin, version) VALUES (?, ?)").run(pluginName, m.version);
  db.exec("COMMIT");
} catch (err) {
  db.exec("ROLLBACK");
  throw err;
}
```

### Task 4.4 — Migration Upgrade Tests

Added 5 storage tests in `packages/core/test/storage.test.ts`:

- `dbPath` exposure on Storage interface
- Backup creation before pending migrations
- No backup when schema is up-to-date
- Transaction rollback on failed migration SQL
- Standalone `backupDatabase()` function

### Task 4.5 — Automatic Backup Before Migrations

Added `backupDatabase()` function:

```typescript
export function backupDatabase(storage: Storage): string {
  storage.db.pragma("wal_checkpoint(TRUNCATE)");
  copyFileSync(dbPath, `${dbPath}-backup-${timestamp}.db`);
  return backupPath;
}
```

- Checkpoints WAL before copying to ensure backup has all data
- Timestamp-based naming: `personal-ai.db-backup-2026-02-24T10-30-00-000Z.db`
- Called automatically when pending migrations exist

---

## Goal 5: Error Handling & Empty States (P2 Important)

### Task 5.1 — React ErrorBoundary

Created `packages/ui/src/components/ErrorBoundary.tsx` (107 lines):

- Class component wrapping the entire app
- Shows friendly full-screen error UI
- **Refresh** button to reload the page
- **Copy error details** button — copies error message, stack trace, URL, timestamp, and user agent
- Integrated in `App.tsx` wrapping all routes

### Task 5.2 — Server Offline Banner

Created `packages/ui/src/components/OfflineBanner.tsx` (43 lines):

- Pings `/api/stats` every 10 seconds with 5s timeout
- Shows amber warning banner when server is unreachable
- Auto-dismisses when server comes back online
- Integrated in `Layout.tsx` above page content

### Task 5.3 — Empty States

Improved empty states for:

- **Memory Explorer:** "No memories yet" with descriptive subtitle
- **Timeline:** "No beliefs to display yet" with guidance on generating events

### Task 5.4 — Human-Readable Error Messages

Added client-side `humanizeError()` to `packages/ui/src/api.ts`:

| Raw Error | User Message |
|-----------|-------------|
| `SQLITE_CANTOPEN` | "Couldn't load your data. Check the data directory in Settings." |
| `SQLITE_BUSY` | "Database is busy. Please try again in a moment." |
| `ECONNREFUSED` | "Server is not running. Start it with: pnpm start" |
| HTTP 429 | "Too many requests. Please wait a moment." |
| HTTP 500–503 | "Server error. Please try again or check the server logs." |

---

## Files Changed

### New Files (10)

| File | Lines | Purpose |
|------|-------|---------|
| `Dockerfile` | 92 | Multi-stage Docker build |
| `docker-compose.yml` | 57 | pai + Ollama services |
| `.dockerignore` | 38 | Docker build exclusions |
| `.github/workflows/docker.yml` | 59 | Docker publish on tag |
| `install.sh` | 88 | Quick install script |
| `docs/MEMORY-LIFECYCLE.md` | 268 | Memory system documentation |
| `packages/core/test/bench/recall-benchmark.ts` | 276 | Recall performance benchmark |
| `packages/core/test/memory/contradiction-edge-cases.test.ts` | 810 | Grey zone edge case tests |
| `packages/ui/src/components/ErrorBoundary.tsx` | 107 | React error boundary |
| `packages/ui/src/components/OfflineBanner.tsx` | 43 | Offline detection banner |

### Modified Files (22)

| File | Changes |
|------|---------|
| `packages/core/src/memory/remember.ts` | `classifyRelationship()`, proportional evidence weighing |
| `packages/core/src/llm.ts` | Google provider, `humanizeError()`, error wrapping |
| `packages/core/src/storage.ts` | `backupDatabase()`, transaction-wrapped migrations |
| `packages/core/src/types.ts` | Added `"google"` to provider types, `dbPath` to Storage |
| `packages/core/src/index.ts` | Export `backupDatabase` |
| `packages/core/test/llm.test.ts` | +7 tests (Google, error handling) |
| `packages/core/test/storage.test.ts` | +5 tests (backup, transactions) |
| `packages/core/test/memory/lifecycle.test.ts` | Updated mocks for `classifyRelationship` |
| `packages/core/test/memory/remember.test.ts` | Updated mocks for `classifyRelationship` |
| `packages/ui/src/App.tsx` | Wrapped with ErrorBoundary |
| `packages/ui/src/components/Layout.tsx` | Added OfflineBanner |
| `packages/ui/src/pages/Settings.tsx` | PROVIDER_PRESETS, select dropdown |
| `packages/ui/src/pages/Chat.tsx` | TokenBadge component |
| `packages/ui/src/pages/Memory.tsx` | Improved empty state |
| `packages/ui/src/pages/Timeline.tsx` | Improved empty state |
| `packages/ui/src/api.ts` | Client-side `humanizeError()` |
| `packages/server/src/routes/config.ts` | Added `"google"` to valid providers |
| `packages/cli/src/init.ts` | Added Google preset to init defaults |
| `packages/core/package.json` | Added `@ai-sdk/google` |
| `package.json` | Added pnpm engine field |
| `pnpm-lock.yaml` | Updated lockfile |
| `CHANGELOG.md` | Added unreleased entries |

---

## Remaining Manual Tasks

These tasks from the roadmap require manual effort and are not included in this commit:

| Task | Description |
|------|-------------|
| 2.5 | E2E test with each cloud provider (requires API keys) |
| 3.5 | User-test install.sh with 3 non-technical people |
| 3.6 | Rewrite README Quick Start for non-developers |
| 5.5 | QA pass — all 5 pages, every error scenario |

---

## Verification

```bash
pnpm run verify    # typecheck + 331 tests passing
pnpm run ci        # typecheck + tests + coverage thresholds
docker build .     # builds Docker image
```

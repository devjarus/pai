# PAI-16: E2E Tests + CI Hardening — Design

## Goal

Add end-to-end tests for critical user flows and harden the CI pipeline. Focus on ship safety — catch real breakage before it reaches users.

## Architecture

### E2E Tests (Playwright)

Full-stack tests against a real server with a temp data directory. No mocks except LLM.

**Test structure:**
```
tests/
  e2e/
    mock-llm.ts       # Tiny HTTP server mimicking Ollama /api/chat
    setup.ts           # Global setup: start server + mock LLM, teardown after
    setup.spec.ts      # First boot → setup wizard → create owner → redirect to chat
    auth.spec.ts       # Login, logout, auth guard (unauthenticated → redirect)
    settings.spec.ts   # Save config, API key persistence, hasApiKey indicator
    chat.spec.ts       # Send message → see streamed response
```

**Mock LLM server:** A ~20-line Node.js HTTP server that mimics Ollama's `/api/chat` endpoint, returning a fixed streamed response. Starts alongside the real server in global setup. This tests the full stack (UI → server → LLM client → mock) without needing a real LLM provider.

**Server lifecycle:** Playwright global setup starts the server with:
- `PAI_DATA_DIR` pointing to a temp directory
- `PAI_LLM_BASE_URL` pointing to the mock LLM
- `PAI_LLM_PROVIDER=ollama`
- Binding to a random available port

Global teardown kills the server and cleans up the temp directory.

### Critical Flows (5 specs)

1. **Setup wizard** — No owner → shows setup page → fill name/email/password → submit → redirected to /chat
2. **Login/logout** — Navigate to login → enter credentials → authenticated → logout → back to login
3. **Auth guard** — Without auth cookies, /chat redirects to /login, API returns 401
4. **Settings** — Change model → save → refresh → value persisted. Enter API key → save → refresh → placeholder shows "Key saved". Change provider → save → API key not lost.
5. **Chat** — Type message → send → assistant response appears (streamed from mock LLM)

### CI Hardening

Additions to `.github/workflows/ci.yml`:

1. **ESLint** — `pnpm lint` after typecheck
2. **Dependency audit** — `pnpm audit --prod --audit-level=high` (fail on high/critical)
3. **E2E tests** — `pnpm exec playwright test` after unit tests, with Playwright installed via CI step

### Config Route Unit Tests

Add to `packages/server/test/routes.test.ts`:

- `GET /api/config` returns `hasApiKey: true` when key is set
- `PUT /api/config` with API key → persists → GET shows `hasApiKey: true`
- `PUT /api/config` without API key → existing key preserved
- `PUT /api/config` with provider change → key not lost

## Out of Scope

- UI component tests (React Testing Library) — E2E covers same flows
- CLI tests — thin wrapper around tested core
- Load testing — premature for single-owner
- SAST scanning — nice-to-have, separate issue

## Tech

- Playwright (E2E)
- Vitest (unit tests, existing)
- GitHub Actions (CI)

# pai Platform Architecture: Deployment and Infrastructure Strategy

**Date:** 2026-03-24
**Status:** Draft / Research Complete
**Audience:** Engineering team, founders

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Design Principles](#2-design-principles)
3. [Deployment Tiers](#3-deployment-tiers)
4. [Compute and Hosting](#4-compute-and-hosting-a)
5. [Database and State](#5-database-and-state-b)
6. [Workers and Durable Jobs](#6-workers-and-durable-jobs-c)
7. [Sandbox and Code Execution](#7-sandbox-and-code-execution-d)
8. [Browser Automation](#8-browser-automation-e)
9. [Search](#9-search-f)
10. [Artifact Storage](#10-artifact-storage-g)
11. [Auth and Tenancy](#11-auth-and-tenancy-h)
12. [Client Strategy](#12-client-strategy-i)
13. [CDK Infrastructure-as-Code](#13-cdk-infrastructure-as-code-j)
14. [Build vs Buy Summary](#14-build-vs-buy-summary)
15. [Migration Path](#15-migration-path)
16. [Cost Projections](#16-cost-projections)
17. [Answers to Specific Questions](#17-answers-to-specific-questions)
18. [Critical Self-Review](#18-critical-self-review)
19. [Sources](#19-sources)

---

## 1. Executive Summary

pai is not a typical CRUD SaaS. It combines interactive chat (low-latency), long-running background research (minutes to hours), scheduled recurring jobs, optional code execution sandboxes, browser automation, and persistent memory. The infrastructure must accommodate all of these workloads without becoming operationally burdensome for a small team.

**Recommendation:** Deploy the hosted offering on AWS ECS Fargate behind an Application Load Balancer, backed by RDS PostgreSQL, with Trigger.dev (self-hosted on the same cluster) for durable background jobs. Use the existing Docker image as the universal deployment artifact for both self-hosted and hosted tiers. Use AWS CDK for all infrastructure. Keep the self-hosted tier on SQLite and in-process workers -- do not force a migration that does not serve those users.

**Simplest credible hosted MVP:** One Fargate service (API + workers in the same task), one RDS PostgreSQL instance (db.t4g.small), one S3 bucket, one ALB. CDK deploys in under 10 minutes. Total infrastructure cost under $100/month before LLM spend.

---

## 2. Design Principles

1. **One Docker image, multiple deployment modes.** The same `Dockerfile` builds the artifact for self-hosted (SQLite, in-process workers), hosted-dedicated (PostgreSQL, external workers), and hosted-shared (PostgreSQL with tenant isolation). A `PAI_MODE` environment variable selects the runtime configuration.

2. **Managed services where the maintenance cost is real.** Use RDS instead of self-managing PostgreSQL. Use S3 instead of local disk. Do not use managed services where they add complexity without removing real pain (e.g., do not use DynamoDB just because it is serverless).

3. **No Lambda for the core workload.** pai has long-running background jobs, SSE streaming, in-memory state for the dispatcher, and WebSocket-adjacent patterns. Lambda's 15-minute timeout and cold-start penalty make it a poor fit for the primary API and worker processes. Lambda is fine for ancillary triggers (scheduled events, webhook ingestion).

4. **PostgreSQL as the single source of truth for hosted.** One database technology for relational data, job queues (via `SKIP LOCKED` or Trigger.dev's internal queue), and full-text search. Avoid adding Redis unless and until there is a proven bottleneck.

5. **Keep self-hosted simple.** Self-hosted users should be able to run `docker compose up` with no external dependencies beyond an LLM API key. SQLite, in-process workers, local disk -- all acceptable for single-user.

6. **CDK stacks are few and understandable.** Three stacks maximum: network, data, and compute. A developer who has never used CDK should be able to read the stack and understand what it deploys.

---

## 3. Deployment Tiers

> **Current vs Target convention:** Each tier below labels what exists TODAY vs what needs to be BUILT. Items marked *(current)* work now. Items marked *(target)* require implementation work described in the Migration Path section.

### 3.1 Self-Hosted (Single Owner)

This is the current architecture, preserved as-is. No infrastructure changes needed.

| Component | Implementation | Status |
|-----------|---------------|--------|
| Compute | Docker container or bare Node.js process | *(current)* |
| Database | SQLite with WAL mode (better-sqlite3) | *(current)* |
| Workers | In-process `WorkerLoop` + `BackgroundDispatcher` | *(current)* |
| Artifacts | Local filesystem (`$PAI_DATA_DIR/artifacts/`) | *(current)* |
| Search engine | Optional SearXNG sidecar (Docker Compose) | *(current)* |
| Sandbox | Optional Docker sidecar (Docker Compose) | *(current)* |
| Auth | Custom single-owner JWT auth (packages/core/src/auth.ts) | *(current)* |
| LLM | User-configured (Ollama, OpenAI, Anthropic, Google) | *(current)* |

**No changes needed.** Self-hosted auth stays as custom single-owner JWT. Better Auth is a hosted-tier concern only — it will not be forced on self-hosted users.

### 3.2 Hosted Dedicated (Single Workspace)

One pai instance per paying customer. Each customer gets their own Fargate task and their own database (either a separate RDS instance or a separate database on a shared RDS cluster).

| Component | Implementation | Status |
|-----------|---------------|--------|
| Compute | ECS Fargate task (0.5 vCPU, 1 GB) | *(target — CDK stacks needed)* |
| Database | RDS PostgreSQL (db.t4g.micro) | *(target — requires Storage interface abstraction + PostgreSQL adapter)* |
| Workers | In-process workers initially, Trigger.dev in Phase 2 | *(current workers work on Fargate; Trigger.dev is Phase 2)* |
| Artifacts | S3 bucket with per-customer prefix | *(target — requires artifact storage abstraction)* |
| Search engine | Brave Search API | *(current — already supported via config)* |
| Sandbox | E2B (managed) | *(target — requires E2B client integration)* |
| Auth | Better Auth | *(target — major migration from custom auth.ts; hosted-only)* |
| LLM | Platform-provided keys with per-customer usage tracking | *(target — usage tracking needed)* |

**Required migration work (see Section 15):**
1. Abstract the Storage interface away from better-sqlite3 types (currently bound at `packages/core/src/types.ts`)
2. Implement PostgreSQL adapter behind the abstracted Storage interface
3. Abstract artifact storage (local fs → S3)
4. Integrate Better Auth for hosted tier only
5. Add `PAI_MODE=hosted` runtime branching to select backends

**When to use this tier:** Early paying customers, high-touch onboarding, customers who want data isolation guarantees.

### 3.3 Hosted Shared (Multi-Tenant SaaS)

Multiple customers share compute and database infrastructure. Tenant isolation is at the database row level (tenant_id column on every table) with RLS policies.

| Component | Implementation |
|-----------|---------------|
| Compute | ECS Fargate service with auto-scaling (multiple tasks) |
| Database | RDS PostgreSQL with row-level security |
| Workers | Trigger.dev with tenant-scoped queues and concurrency |
| Artifacts | S3 with tenant-prefixed keys |
| Auth | Better Auth with organization/workspace support |
| LLM | Shared provider keys with per-tenant rate limiting |

**When to use this tier:** Scale. This is the eventual architecture, but should not be built until there are at least 20+ paying customers on the dedicated tier.

---

## 4. Compute and Hosting (A)

### Recommendation: ECS Fargate

**Why Fargate over the alternatives:**

| Option | Verdict | Reasoning |
|--------|---------|-----------|
| **ECS Fargate** | **Selected** | Right abstraction level. No servers to manage, supports long-running tasks, persistent connections (SSE), sidecar containers, and the team has AWS familiarity. CDK has excellent L3 constructs (`ApplicationLoadBalancedFargateService`). |
| App Runner | Rejected | Cannot support long-running background tasks in the same process. No HTTP/2 inbound. Limited networking control. Deployment latency is poor. Scale-to-zero behavior is not truly zero-cost. Simpler than Fargate but too constrained for pai's workload mix. |
| Lambda + API Gateway | Rejected | 15-minute timeout kills research jobs. Cold starts degrade chat UX. SSE streaming requires workarounds. Would force a complete rearchitecture of the worker system. Good for ancillary triggers only. |
| EKS | Rejected | Massive operational overhead for a small team. No advantage over Fargate for this workload. Introduces kubectl, Helm, cluster upgrades, node management. |
| EC2 | Considered for self-hosted | For a one-click self-hosted appliance, a single EC2 instance with Docker Compose is actually the simplest path. But for the hosted offering, Fargate is better because it removes instance management. |

### Fargate Pricing (US East, Linux/ARM)

- vCPU: $0.03238/hour ($23.31/month for 1 vCPU always-on)
- Memory: $0.00356/GB/hour ($2.56/month for 1 GB always-on)
- A minimal task (0.5 vCPU, 1 GB): ~$14/month
- Fargate Spot: up to 70% discount for interruptible workloads (good for batch research)

**Source:** [AWS Fargate Pricing](https://aws.amazon.com/fargate/pricing/)

### Fargate Task Architecture

For the MVP, run a **single Fargate task definition** with two containers:

1. **api** container: Fastify server (port 3141), serves the web UI, handles chat, exposes REST + SSE
2. **worker** container: Same Docker image, different entrypoint (`PAI_MODE=worker`), runs `WorkerLoop` and `BackgroundDispatcher`

Both containers share the same task (same ENI, same security group) and connect to the same RDS instance. This avoids the need for a separate message bus in the MVP -- the worker can poll the database directly.

When scaling to multi-tenant, split into separate Fargate services (api service with auto-scaling, worker service with concurrency-limited scaling).

---

## 5. Database and State (B)

### Recommendation: RDS PostgreSQL (db.t4g.small) for hosted; SQLite for self-hosted

**Why PostgreSQL over Aurora Serverless v2:**

| Option | Monthly Cost | Verdict |
|--------|-------------|---------|
| RDS PostgreSQL db.t4g.micro | ~$12 + storage | Best for MVP. Cheapest real PostgreSQL. |
| RDS PostgreSQL db.t4g.small | ~$23 + storage | **Selected for hosted MVP.** 2 GB RAM, enough for 5-10 dedicated customers sharing one cluster. |
| Aurora Serverless v2 (0.5 ACU min) | ~$44 minimum + I/O | Overkill. The minimum 0.5 ACU floor means you pay $44/month even with zero load. Aurora's advantages (multi-writer, cross-region) are not needed yet. |
| Aurora Provisioned | ~$60+ | Even more overkill for MVP. |

**Source:** [Amazon RDS Pricing](https://aws.amazon.com/rds/postgresql/pricing/), [Aurora Pricing](https://aws.amazon.com/rds/aurora/pricing/)

Aurora Serverless v2 is the correct upgrade path when the dedicated tier has 20+ customers and load becomes spiky. It does not make sense as a starting point.

### Migration from SQLite to PostgreSQL

The current codebase uses `better-sqlite3` with raw SQL queries. The migration strategy:

1. **Abstract the storage interface.** The current `Storage` type in `packages/core/src/types.ts` is bound to `better-sqlite3` types and does NOT have a `transaction` method. The interface itself needs redesign before a PostgreSQL adapter can be built: extract a provider-agnostic `Storage` interface with `query<T>(sql, params)`, `run(sql, params)`, and `transaction<T>(fn)` methods, then implement `SqliteStorage` and `PostgresStorage` behind it. This is the single largest migration prerequisite.

2. **SQL compatibility.** Most of the existing SQL is ANSI-compatible. Key differences to handle:
   - `AUTOINCREMENT` becomes `GENERATED ALWAYS AS IDENTITY` or `SERIAL`
   - `datetime('now')` becomes `NOW()`
   - `json_extract()` becomes `->>` operator
   - `GROUP_CONCAT` becomes `STRING_AGG`
   - WAL pragmas become no-ops

3. **Keep SQLite as the self-hosted default.** The `PAI_MODE` environment variable selects which storage backend to instantiate. Self-hosted users never touch PostgreSQL.

### Redis: Not Now

Redis adds operational complexity (another service to run, monitor, and secure) and cost (~$13/month for ElastiCache t4g.micro). PostgreSQL can handle job queuing (`SELECT ... FOR UPDATE SKIP LOCKED`), pub/sub (`LISTEN/NOTIFY`), and caching (materialized views or application-level caching) for the foreseeable scale. Add Redis only if profiling shows PostgreSQL becoming the bottleneck for a specific access pattern.

---

## 6. Workers and Durable Jobs (C)

### Recommendation: Trigger.dev (self-hosted) for hosted; in-process for self-hosted

This is the most consequential infrastructure decision. pai's background workload is not trivial: research jobs can take 5-30 minutes, involve multiple LLM calls with retries, and must survive process restarts.

### Options Evaluated

| Option | Cost (Hosted) | Self-hostable | Long-running | Concurrency Control | Observability | Verdict |
|--------|---------------|---------------|-------------|---------------------|--------------|---------|
| **In-process (current)** | $0 | Yes | Yes | Process-local | Logs only | **Keep for self-hosted** |
| **Trigger.dev (self-hosted)** | $0 (infra only) | Yes (Apache 2.0) | Yes, durable | Yes, per-queue | Built-in dashboard | **Selected for hosted** |
| Trigger.dev Cloud | $50/month + usage | No | Yes, durable | Yes | Built-in dashboard | Good but unnecessary if self-hosting |
| Inngest Cloud | ~$25/month + $0.40/1k | No | Yes, durable | Yes | Built-in dashboard | Good DX but not self-hostable in production |
| SQS + Lambda | ~$5/month | N/A | 15-min max | Via SQS settings | CloudWatch | Timeout kills research jobs |
| Step Functions | $0.025/1k transitions | N/A | Yes (Standard) | Limited | Built-in | Expensive at scale, awkward for dynamic workflows |
| Upstash QStash | $1/100k messages | No | Via callbacks | Basic | Minimal | Too simple for durable multi-step research |
| Temporal | $0 (self-hosted) | Yes | Yes | Yes | Excellent | Massively over-engineered for this team size |

### Why Trigger.dev

1. **Apache 2.0 open source.** Self-host with unlimited runs and no feature limitations. No vendor lock-in.
2. **TypeScript-native.** pai is already TypeScript. Trigger.dev tasks are plain async functions with decorators. Minimal new concepts.
3. **Durable execution.** If a research job crashes midway through 5 LLM calls, it can resume from the last checkpoint. This is critical for expensive multi-step research.
4. **Built-in concurrency control.** Can limit research jobs to N concurrent per tenant, which directly maps to pai's LLM traffic lanes (interactive / deferred / background).
5. **Built-in observability.** Dashboard shows running/queued/failed jobs, execution timeline, and retry history. This replaces custom observability code.
6. **Self-hosted on the same Fargate cluster.** Runs as another Fargate service alongside the API. Uses the same RDS PostgreSQL as its backend.
7. **v4 Docker deployment is simple.** Single `docker compose` with built-in registry and object storage. No S3 or external registry required.

**Source:** [Trigger.dev self-hosting overview](https://trigger.dev/docs/self-hosting/overview), [Self-hosting v4 with Docker](https://trigger.dev/blog/self-hosting-trigger-dev-v4-docker)

### Migration Path

The current `BackgroundDispatcher` in `packages/server/src/background-dispatcher.ts` already has the right abstractions: work items with priorities, kinds (research/swarm/briefing), and source types. The migration:

1. **Phase 1 (hosted only):** Add a `TriggerBackgroundDispatcher` implementation that enqueues work as Trigger.dev tasks instead of running them in-process. The self-hosted `BackgroundDispatcher` remains unchanged.
2. **Phase 2:** Move research/swarm/briefing execution logic into Trigger.dev task definitions. Each task calls the existing plugin functions.
3. **Phase 3:** Add per-tenant concurrency limits and priority queues.

### Why Not SQS + Lambda

SQS + Lambda is the "obvious" AWS-native answer, but it fails for pai because:
- Lambda's 15-minute timeout is insufficient for multi-step research jobs that involve browser automation, multiple LLM calls, and synthesis
- Lambda cold starts degrade latency for user-triggered research
- No built-in durable execution (if Lambda times out midway, you restart from scratch)
- Observability requires wiring CloudWatch, X-Ray, and custom dashboards

### Why Not Step Functions

Step Functions Standard Workflows support long-running tasks, but:
- $0.025 per 1,000 state transitions. A single research job with 10 LLM calls, retries, and web fetches could be 50+ transitions = $0.00125 per job. At 1,000 jobs/day = $1.25/day = $37.50/month just for state machine transitions, not counting Lambda costs for the steps.
- The state machine JSON definition language (ASL) is awkward for dynamic research workflows where the number of steps depends on runtime decisions.
- Not self-hostable, so it creates a gap between self-hosted and hosted architectures.

---

## 7. Sandbox and Code Execution (D)

### Recommendation: E2B for hosted; Docker sidecar for self-hosted

pai needs code execution for chart generation, data analysis, and agent-generated scripts. The current sandbox sidecar (Python + Node.js + Chromium in a Docker container) works well for self-hosted.

### Options Evaluated

| Option | Cold Start | Isolation | Cost | Self-hostable | Verdict |
|--------|-----------|-----------|------|---------------|---------|
| **Docker sidecar (current)** | 0ms (always running) | Container-level | $0 (infra only) | Yes | **Keep for self-hosted** |
| **E2B** | <200ms (Firecracker) | microVM | ~$0.05/hr/sandbox | No (unless enterprise) | **Selected for hosted** |
| Modal Sandboxes | ~200ms | Container | ~$0.05/hr (similar) | No | Good but GPU-focused, less relevant for CPU code execution |
| AWS Lambda (custom runtime) | 500ms-2s | Firecracker | $0.0000167/GB-s | N/A | Possible but requires custom container image, 15-min limit |
| Self-built Firecracker pool | <100ms | microVM | Infra only | Yes | Excellent isolation but massive engineering investment |

### Why E2B for Hosted

1. **Firecracker microVMs.** Same isolation technology as AWS Lambda. Each sandbox is a full VM, not a container. This is the strongest isolation possible for running untrusted agent-generated code.
2. **Sub-200ms cold start.** No perceptible delay for the user.
3. **Simple SDK.** `const sandbox = await Sandbox.create(); const result = await sandbox.runCode("python", code);`
4. **Cost-effective.** At $0.05/vCPU-hour, a 30-second code execution costs $0.0004. Even at 1,000 executions/day, that is $0.40/day = $12/month.
5. **Artifact output handling.** Files written inside the sandbox can be downloaded via SDK, fitting naturally into pai's artifact pipeline.

**Source:** [E2B Pricing](https://e2b.dev/pricing), [E2B Documentation](https://e2b.dev/docs)

### Why Not Build a Custom Sandbox on AWS

Building Firecracker pools on EC2 is a serious infrastructure project. It requires:
- Firecracker binary management and kernel image maintenance
- Snapshot management for fast cold starts
- Networking (each microVM needs a TAP device)
- Resource cleanup and garbage collection
- Security hardening

This is a multi-month project for a dedicated infrastructure team. E2B has done this work already. The $12/month cost at moderate usage is trivially justified.

### Architecture

```
Self-hosted:  pai-server ---> Docker sidecar (localhost:8888)
Hosted:       pai-server ---> E2B API (HTTPS, SDK)
```

Abstract the sandbox client interface in `packages/core/src/sandbox.ts` to support both backends, selected by `PAI_MODE`.

---

## 8. Browser Automation (E)

### Recommendation: Self-hosted Playwright pool for self-hosted; Browserless for hosted

Browser automation is used for:
- Fetching JavaScript-rendered pages during research
- Extracting structured data from dynamic websites
- Screenshot capture for visual analysis

### Options Evaluated

| Option | Cost | Anti-detection | Scaling | Verdict |
|--------|------|---------------|---------|---------|
| **Docker sidecar with Chromium (current)** | $0 | None | Single instance | **Keep for self-hosted** |
| **Browserless** | $50/month (5k units) | Built-in stealth | Managed scaling | **Selected for hosted** |
| Playwright pool on Fargate | Infra only (~$15/month) | None | Manual | Viable alternative if cost-sensitive |
| Bright Data Scraping Browser | ~$100/month | Best-in-class | Managed | Overkill unless anti-bot is critical |

### Why Browserless for Hosted

1. **No infrastructure to manage.** Browser pools are notoriously flaky -- zombie processes, memory leaks, crashed tabs. Browserless handles all of this.
2. **Stealth/anti-detection built in.** Many research targets block obvious headless browsers. Browserless includes stealth settings.
3. **REST API for common tasks.** PDF generation, screenshots, and page content extraction via simple HTTP calls.
4. **Reasonable cost.** $50/month for 5,000 browser sessions is $0.01/session. Adequate for the research workload.
5. **Chromium-based.** Compatible with existing Playwright scripts.

**Source:** [Browserless Pricing](https://www.browserless.io/pricing)

### Self-Hosted Alternative

The current sandbox Dockerfile already includes Chromium and Pinchtab (a Go-based browser automation bridge). This remains the self-hosted solution. For hosted environments where Browserless cost is a concern, a dedicated Fargate task running `browserless/chrome` is a viable alternative at ~$15/month (0.5 vCPU, 1 GB).

---

## 9. Search (F)

### Recommendation: Two-tier search strategy

pai needs web search for research jobs (background), watch monitoring (recurring), and real-time chat (interactive). These have different quality and cost requirements.

### Tier 1: Default (Low-Cost, High-Volume)

**Brave Search API** -- $5/1,000 queries

- Cheapest credible search API with independent index (not reselling Google/Bing)
- 1,000 free queries/month via $5 monthly credit
- AI-optimized endpoint returns clean text, no HTML parsing needed
- Rate limit: 20 queries/second (sufficient for background research)

For self-hosted users, **SearXNG** remains the default (free, privacy-preserving, aggregates 242 engines).

### Tier 2: Premium Deep Research

**Tavily** -- $0.008-0.016/query (basic/advanced)

- Purpose-built for AI agent research
- Returns structured content optimized for LLM consumption
- Advanced mode does deeper extraction
- 1,000 free credits/month
- Research API (4-250 credits/request) for deep dives

**Exa** -- $5-7/1,000 queries

- Neural/semantic search, excellent for finding specific types of content
- Instant mode (<200ms) for real-time use
- Deep mode for thorough research
- Content extraction included at 10 results per request

### Recommended Configuration

| Use Case | Self-Hosted | Hosted Default | Hosted Premium |
|----------|-------------|---------------|----------------|
| Watch monitoring | SearXNG | Brave Search | Brave Search |
| Chat web search | SearXNG | Brave Search | Tavily Basic |
| Background research | SearXNG | Brave Search | Tavily Advanced + Exa |
| Deep research (swarm) | SearXNG | Tavily Basic | Tavily Research API |

### Cost Estimate (Hosted, Moderate Usage)

- 500 watch checks/month at $0.005/query (Brave): $2.50
- 200 chat searches/month at $0.005/query (Brave): $1.00
- 100 research jobs/month at $0.016/query (Tavily Advanced), 5 queries each: $8.00
- **Total: ~$12/month**

**Sources:** [Brave Search API Pricing](https://api-dashboard.search.brave.com/documentation/pricing), [Tavily Pricing](https://www.tavily.com/pricing), [Exa Pricing](https://exa.ai/pricing)

---

## 10. Artifact Storage (G)

### Recommendation: S3 with signed URLs for hosted; local filesystem for self-hosted

### Architecture

```
Self-hosted:  pai-server ---> local filesystem ($PAI_DATA_DIR/artifacts/)
Hosted:       pai-server ---> S3 bucket (per-tenant prefix) ---> CloudFront (optional)
```

### S3 Configuration

- **Bucket structure:** `s3://pai-artifacts-{env}/{tenant_id}/{artifact_type}/{yyyy-mm}/{artifact_id}.{ext}`
- **Access pattern:** Server generates pre-signed URLs (GET, 1-hour expiry) for the frontend. No proxying through the application server.
- **Lifecycle policies:**
  - Research charts/images: 90-day retention, then transition to Glacier
  - Temporary sandbox outputs: 7-day retention, then delete
  - User-uploaded knowledge documents: No expiration
- **Encryption:** SSE-S3 (default encryption, no key management overhead)
- **CDK:** `new s3.Bucket()` with lifecycle rules and CORS for signed URL access from the web app

### Why Signed URLs Over Proxying

Proxying artifact requests through the Fastify server wastes CPU, memory, and bandwidth on the API task. Signed URLs let the browser download directly from S3/CloudFront, which is what S3 is designed for. The server generates the URL (fast, no I/O) and the client fetches from S3 (fast, CDN-cached).

### CloudFront: Add When Needed

CloudFront adds $0.085/GB transfer + $0.0075/10k requests. For low traffic, direct S3 access is cheaper and simpler. Add CloudFront when either (a) artifact access patterns become latency-sensitive (e.g., embedding charts in real-time chat), or (b) data transfer costs become significant (>$10/month).

### Cost Estimate

- S3 Standard: $0.023/GB/month
- 10 GB of artifacts: $0.23/month
- 10,000 GET requests: $0.004/month
- **Negligible**

---

## 11. Auth and Tenancy (H)

### Recommendation: Better Auth for all tiers

### Options Evaluated

| Option | Cost | Self-hostable | Multi-tenancy | DX | Lock-in | Verdict |
|--------|------|---------------|--------------|-----|---------|---------|
| **Better Auth** | $0 (MIT) | Yes | Built-in | Excellent (TypeScript-native) | None | **Selected** |
| Clerk | Free <10k MAU, then $0.02/MAU | No | Org support | Excellent | High (vendor) | Great DX but not self-hostable |
| Cognito | Free <10k MAU, then $0.015/MAU | No | User pools | Poor | High (AWS) | Terrible DX, recent price increases |
| Auth0 | Free <7.5k MAU, $1400/month at 20k MAU | No | Yes | Good | Very high | Cost explodes at scale |
| Lucia Auth | $0 (MIT) | Yes | DIY | Good | None | Deprecated in favor of Better Auth |

### Why Better Auth (Hosted Tier Only)

> **Important:** Self-hosted pai keeps its current custom single-owner JWT auth (`packages/core/src/auth.ts`). Better Auth is for the **hosted tier only**, where multi-user, social login, and team management are needed. This is a significant migration — not just wiring a new library, but replacing the auth system for the hosted deployment path.

1. **MIT licensed, self-hostable.** Can run on the same infrastructure without external dependencies.
2. **TypeScript-native.** First-class support for the frameworks pai uses (Fastify/Express, React).
3. **Multi-tenancy built-in.** Teams, roles, invitations, and member management. Needed for hosted-dedicated and hosted-shared tiers.
4. **Database-backed.** Uses the same PostgreSQL as the hosted deployment. No external auth service.
5. **SSO/SAML/SCIM for enterprise.** Built-in, not a $3,000/month Auth0 add-on.
6. **Passkeys, magic links, social login, API keys.** Modern auth primitives included.
7. **No per-MAU pricing.** Zero marginal cost per user vs Clerk/Auth0/Cognito growth penalty.

**Source:** [Better Auth Documentation](https://better-auth.com/docs/introduction), [Better Auth GitHub](https://github.com/better-auth/better-auth)

### Tenancy Model by Tier

| Tier | Tenancy Model | Auth Config |
|------|--------------|-------------|
| Self-hosted | Single owner, single workspace | Better Auth with email/password, optional passkey |
| Hosted dedicated | Single workspace per instance | Better Auth with social login + email/password |
| Hosted shared | Multi-tenant, row-level security | Better Auth with organizations, roles, invitations |

### Migration from Current Auth

The current auth system is a custom JWT implementation in `packages/server/src/routes/auth.ts`. Migration:

1. Replace custom JWT generation/validation with Better Auth sessions
2. Keep the existing `extractToken` middleware as a compatibility shim during transition
3. Add social login providers (Google, GitHub) for the hosted offering
4. Add organization support for multi-tenant

---

## 12. Client Strategy (I)

### Recommendation: Web-first with Capacitor for mobile, Tauri for desktop

### The Problem

pai needs to be accessible on web, desktop (macOS/Windows/Linux), and mobile (iOS/Android). Building and maintaining four separate native apps is not feasible for a small team.

### Strategy: One Web Codebase, Multiple Shells

```
packages/ui/  (React + Vite + Tailwind + shadcn/ui)
    |
    +---> Web app (primary, Vite build, served by Fastify or CDN)
    |
    +---> Desktop app (Tauri shell wrapping the web app)
    |
    +---> Mobile app (Capacitor shell wrapping the web app)
```

### Web (Primary)

The existing React + Vite + Tailwind + shadcn/ui app is the canonical client. It is served statically by the Fastify server or from a CDN. No changes needed.

For hosted multi-tenant, the UI build becomes a standalone deployment on S3 + CloudFront, calling the API via CORS.

### Desktop: Tauri

| Criterion | Tauri | Electron |
|-----------|-------|----------|
| Bundle size | <10 MB | >100 MB |
| Memory usage | ~30-40 MB idle | ~200+ MB idle |
| Security | Rust bridge, sandboxed by default | Full Node.js access, larger attack surface |
| Backend language | Rust | JavaScript |
| WebView | System native | Bundled Chromium |
| Ecosystem maturity | Good (2.0 released 2024, growing fast) | Excellent (decade of ecosystem) |

**Why Tauri over Electron:**
- pai is a personal assistant that runs persistently. Memory and CPU efficiency matter.
- The desktop app is a thin shell around the web UI. There is no complex native integration needed (no filesystem access beyond config, no hardware APIs).
- The Rust learning curve is a concern, but the Tauri shell is minimal -- it opens a WebView and points it at the web app. Less than 100 lines of Rust.
- If the team later needs deep native integration (system tray, keyboard shortcuts, file drag-and-drop), Tauri supports it through Rust plugins.

**Source:** [Tauri vs Electron comparison](https://blog.nishikanta.in/tauri-vs-electron-the-complete-developers-guide-2026)

### Mobile: Capacitor

| Criterion | Capacitor | React Native | PWA |
|-----------|-----------|-------------|-----|
| Code reuse with web | 95%+ (same React app) | 20-30% (shared logic only) | 100% |
| Native APIs | Via plugins | Full native bridge | Limited |
| App Store distribution | Yes | Yes | No (iOS severely limits PWAs) |
| Performance | Good (WebView) | Near-native | Varies by device |
| Development cost | Minimal (wrap existing web app) | Build from scratch | Zero |
| Push notifications | Yes (via plugin) | Yes | Limited on iOS |

**Why Capacitor over React Native:**
- pai already has a React web app. Capacitor wraps it as-is. React Native would require rewriting the entire UI.
- The mobile app is primarily a chat interface and digest reader. It does not need native 60fps animations or complex native UI.
- Capacitor supports the same web codebase across web, iOS, and Android. One `packages/ui/` directory serves all three.
- Push notifications (for digest delivery) work via Capacitor's push notification plugin.

**Why not PWA-only:**
- iOS Safari severely limits PWA capabilities (no push notifications until recently, limited background execution, storage limits, no App Store presence).
- App Store distribution builds user trust and discoverability.
- Capacitor starts as a PWA and adds native capabilities incrementally. You can ship the PWA immediately and add Capacitor native builds later.

### Implementation Plan

1. **Now:** Ship the web app as the primary client. It works on all platforms via browser.
2. **Phase 2:** Add Tauri desktop builds. CI pipeline produces `.dmg`, `.msi`, `.AppImage`. The desktop app points at the local or hosted API.
3. **Phase 3:** Add Capacitor mobile builds. CI pipeline produces iOS `.ipa` and Android `.apk`. Submit to App Store and Google Play.
4. **Ongoing:** All UI work happens in `packages/ui/`. Desktop and mobile shells are thin wrappers that rarely need updates.

---

## 13. CDK Infrastructure-as-Code (J)

### Stack Organization

Three CDK stacks, deployed in dependency order:

```
PaiNetworkStack     (VPC, subnets, security groups)
      |
PaiDataStack        (RDS, S3, Secrets Manager)
      |
PaiComputeStack     (ECS cluster, Fargate services, ALB, Route 53)
```

### PaiNetworkStack

```typescript
// Straightforward CDK -- uses L2 constructs
const vpc = new ec2.Vpc(this, 'PaiVpc', {
  maxAzs: 2,
  natGateways: 1, // $32/month -- minimize for MVP
});
```

**CDK complexity: Low.** Standard VPC with 2 AZs. NAT Gateway is the main cost ($32/month). Consider NAT instances ($4/month) for MVP if cost-sensitive, though CDK support for NAT instances is more manual.

### PaiDataStack

```typescript
// RDS PostgreSQL -- CDK L2 construct is excellent
const db = new rds.DatabaseInstance(this, 'PaiDb', {
  engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16 }),
  instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.SMALL),
  vpc,
  vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
  credentials: rds.Credentials.fromGeneratedSecret('pai'),
  multiAz: false, // Single-AZ for MVP, enable for prod
  allocatedStorage: 20,
  storageType: rds.StorageType.GP3,
  backupRetention: Duration.days(7),
  deletionProtection: true,
});

// S3 -- trivial in CDK
const artifacts = new s3.Bucket(this, 'PaiArtifacts', {
  encryption: s3.BucketEncryption.S3_MANAGED,
  lifecycleRules: [
    { expiration: Duration.days(90), prefix: 'temp/' },
  ],
  cors: [{ allowedOrigins: ['*'], allowedMethods: [s3.HttpMethods.GET] }],
  blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
});
```

**CDK complexity: Low.** Both RDS and S3 have mature L2 constructs. Credentials are auto-generated and stored in Secrets Manager.

### PaiComputeStack

```typescript
// L3 construct -- deploys ALB + ECS Cluster + Fargate Service in one shot
const apiService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, 'PaiApi', {
  cluster,
  cpu: 512,        // 0.5 vCPU
  memoryLimitMiB: 1024,
  desiredCount: 1,
  taskImageOptions: {
    image: ecs.ContainerImage.fromEcrRepository(repo, 'latest'),
    containerPort: 3141,
    environment: {
      PAI_MODE: 'hosted',
      DATABASE_URL: `postgresql://...`, // from Secrets Manager
    },
    secrets: {
      JWT_SECRET: ecs.Secret.fromSecretsManager(jwtSecret),
    },
  },
  publicLoadBalancer: true,
  certificate, // ACM certificate for HTTPS
});

// Worker as a separate Fargate service (no ALB, no public access)
const workerService = new ecs.FargateService(this, 'PaiWorker', {
  cluster,
  taskDefinition: workerTaskDef,
  desiredCount: 1,
});
```

**CDK complexity: Low to moderate.** The `ApplicationLoadBalancedFargateService` L3 construct is the gold standard for CDK -- one construct creates the VPC integration, ALB, target group, security groups, and ECS service. The worker service is a plain `FargateService` without a load balancer.

### Where CDK is Awkward

1. **ECR image builds.** CDK can build and push Docker images via `DockerImageAsset`, but it shells out to Docker during synthesis, which is slow and requires Docker on the CI machine. Recommendation: Build and push the Docker image in CI (GitHub Actions), then reference it in CDK by tag.

2. **Trigger.dev self-hosted deployment.** Trigger.dev's Docker Compose deployment does not map neatly to CDK constructs. You would need to translate each container (webapp, worker, registry) into separate Fargate task definitions. This is doable but tedious. Alternative: Run Trigger.dev on a single EC2 instance with Docker Compose and manage it separately.

3. **NAT Gateway cost.** The default VPC construct creates NAT Gateways at $32/month each. For MVP, override to a single NAT Gateway. Consider fck-nat (an open-source NAT instance) at ~$4/month.

4. **Secrets rotation.** RDS credentials rotation via Secrets Manager is supported in CDK but requires a Lambda rotation function. Skip for MVP; add when compliance requires it.

---

## 14. Build vs Buy Summary

| Component | Build (Self-Hosted) | Buy (Hosted) | Rationale |
|-----------|-------------------|-------------|-----------|
| **Background jobs** | In-process `WorkerLoop` | Trigger.dev (self-hosted) | Durable execution, concurrency control, and observability are worth the integration cost. |
| **Code sandbox** | Docker sidecar | E2B | Firecracker microVM isolation is not worth building. E2B is cheap and excellent. |
| **Browser automation** | Chromium in sandbox container | Browserless | Browser pools are operationally painful. Browserless handles zombie processes and anti-detection. |
| **Search** | SearXNG | Brave + Tavily | Self-hosted metasearch is free and private. Hosted needs API reliability. |
| **Artifact storage** | Local filesystem | S3 | S3 is the obvious choice for hosted. No reason to build a custom object store. |
| **Auth** | Better Auth (same for both) | Better Auth (same for both) | MIT license, self-hostable, TypeScript-native, multi-tenancy built-in. |
| **Database** | SQLite | RDS PostgreSQL | SQLite is perfect for single-user. PostgreSQL is necessary for concurrent multi-tenant access. |
| **Observability** | Custom (current) | AWS native (CloudWatch + X-Ray) + Trigger.dev dashboard | CloudWatch is free for basic metrics. Trigger.dev provides job-level observability. Avoid third-party APM vendors until needed. |

---

## 15. Migration Path

### Phase 1: Hosted MVP (Weeks 1-4)

Goal: Deploy a single-tenant hosted instance on AWS.

1. **Abstract storage interface.** Add PostgreSQL backend behind existing `Storage` type. (Week 1)
2. **CDK stacks.** Deploy VPC, RDS, S3, ECS Fargate. (Week 1-2)
3. **Docker image CI.** GitHub Actions builds and pushes to ECR on merge to main. (Week 2)
4. **Environment configuration.** `PAI_MODE=hosted` selects PostgreSQL, S3 artifacts, external search APIs. (Week 2)
5. **Better Auth integration.** Replace custom JWT auth with Better Auth. Support email/password + Google social login. (Week 3)
6. **S3 artifact storage.** Add S3 backend to artifact system with signed URL generation. (Week 3)
7. **Deploy and test.** Single customer, single instance, smoke-tested against core loop. (Week 4)

### Phase 2: Background Jobs (Weeks 5-8)

Goal: Move background workloads to Trigger.dev for durability and observability.

1. **Deploy Trigger.dev self-hosted.** Run on same Fargate cluster or dedicated EC2 instance. (Week 5)
2. **Define Trigger.dev tasks.** Research, swarm, briefing generation as Trigger.dev tasks. (Week 5-6)
3. **Integrate dispatcher.** `TriggerBackgroundDispatcher` enqueues to Trigger.dev instead of running in-process. (Week 6-7)
4. **Concurrency and priority.** Map LLM traffic lanes to Trigger.dev queue concurrency limits. (Week 7)
5. **Observability.** Verify job status, retries, and failures are visible in Trigger.dev dashboard. (Week 8)

### Phase 3: External Services (Weeks 9-12)

Goal: Integrate managed services for sandbox, browser, and search.

1. **E2B sandbox integration.** Abstract sandbox client, add E2B backend for hosted mode. (Week 9)
2. **Browserless integration.** Add Browserless backend for page fetching in hosted mode. (Week 10)
3. **Search API integration.** Configure Brave + Tavily as hosted search backends. (Week 10)
4. **Client builds.** Add Tauri desktop builds to CI. (Week 11-12)

### Phase 4: Multi-Tenancy (Weeks 13-20)

Goal: Support multiple customers on shared infrastructure.

1. **Tenant isolation.** Add `tenant_id` to all database tables. Enable RLS in PostgreSQL. (Week 13-15)
2. **Better Auth organizations.** Configure workspace management, invitations, roles. (Week 15-16)
3. **Per-tenant resource limits.** LLM usage caps, storage quotas, job concurrency limits. (Week 16-17)
4. **Billing integration.** Stripe for subscription management. (Week 18-19)
5. **Capacitor mobile builds.** Add iOS/Android builds to CI. (Week 19-20)

---

## 16. Cost Projections

### Hosted MVP (Single Customer)

| Service | Spec | Monthly Cost |
|---------|------|-------------|
| ECS Fargate (API) | 0.5 vCPU, 1 GB | $14 |
| ECS Fargate (Worker) | 0.5 vCPU, 1 GB | $14 |
| RDS PostgreSQL | db.t4g.small, 20 GB | $25 |
| ALB | 1 LCU average | $22 |
| NAT Gateway | 1 (single AZ) | $32 |
| S3 | 10 GB | $0.25 |
| ECR | 5 GB images | $0.50 |
| Secrets Manager | 3 secrets | $1.20 |
| Route 53 | 1 hosted zone | $0.50 |
| **AWS subtotal** | | **~$110/month** |
| Brave Search API | 500 queries | $2.50 |
| E2B | 100 sandbox sessions | $1 |
| Browserless | Free tier | $0 |
| **Total (excl. LLM)** | | **~$115/month** |

### LLM Cost (Largest Variable)

LLM costs dominate. A rough estimate:
- 50 chat messages/day * $0.01/message (GPT-4o-class) = $15/month
- 5 research jobs/day * $0.50/job (multiple LLM calls) = $75/month
- 1 daily digest * $0.10/digest = $3/month
- **LLM total: ~$93/month**

**Total all-in for one customer: ~$210/month**

### Cost Optimization Levers

1. **Fargate Spot for workers.** 70% discount on background worker tasks = saves ~$10/month
2. **fck-nat instead of NAT Gateway.** $4/month instead of $32/month = saves $28/month
3. **Smaller RDS instance.** db.t4g.micro at $12/month (fine for single customer) = saves $13/month
4. **Reserved capacity.** 1-year RDS reservation saves ~30-40%

With optimizations, the MVP infrastructure cost drops to **~$60/month** before LLM spend.

### Ultra-Lean Option: Single EC2 Instance

For the first 1-3 hosted customers, a single EC2 instance running Docker Compose is the cheapest credible path:

| Service | Cost |
|---------|------|
| EC2 t4g.small (2 vCPU, 2GB ARM) | $12/mo (1yr reserved) or $15/mo on-demand |
| 20GB EBS gp3 | $1.60/mo |
| S3 (10GB artifacts) | $0.25/mo |
| Route 53 | $0.50/mo |
| **Total** | **~$15-18/mo** |

No ALB, no NAT Gateway, no Fargate markup. The same Docker Compose that runs self-hosted, just on AWS. Tradeoff: manual deploys, no auto-scaling, single point of failure. Acceptable for early customers where trust is high and SLA is informal.

### Staged Cost Path

| Phase | Infrastructure | Monthly Cost | Trigger to Upgrade |
|-------|---------------|-------------|-------------------|
| **0. Now** | Railway (current) | ~$5-20 | Need AWS or first paying customer |
| **1. First customers** | EC2 t4g.small + Docker Compose + S3 | ~$18 | Ops burden or 5+ customers |
| **2. Growth** | Fargate + RDS micro + fck-nat (optimized) | ~$55 | Load spikes or multi-tenant need |
| **3. Scale** | Fargate + Aurora Serverless v2 + Trigger.dev | ~$100+ | 20+ customers or spiky workloads |

Each phase uses `PAI_MODE` to select the right backends at runtime. The Docker image is the same across all phases.

---

## 17. Answers to Specific Questions

### 1. What is the simplest credible hosted MVP on AWS for this product?

One ECS Fargate service (API + worker in same task definition for absolute simplicity), one RDS PostgreSQL db.t4g.small, one S3 bucket, one ALB. Three CDK stacks. The same Docker image currently used for self-hosted, with `PAI_MODE=hosted` selecting PostgreSQL and S3 backends. Total infrastructure: ~$110/month. Deployable in 2 weeks by one engineer familiar with CDK.

### 2. What should remain different between self-hosted and hosted?

| Concern | Self-Hosted | Hosted |
|---------|-------------|--------|
| Database | SQLite | PostgreSQL |
| Workers | In-process | Trigger.dev |
| Artifact storage | Local filesystem | S3 |
| Search | SearXNG | Brave / Tavily |
| Sandbox | Docker sidecar | E2B |
| Auth complexity | Single-owner password | Better Auth with social login |

The code should share interfaces and business logic. The difference is in infrastructure backends, selected at runtime via configuration. Do not force self-hosted users to run PostgreSQL or Trigger.dev.

### 3. Which parts should stay in-house vs be outsourced?

**Keep in-house:** Core AI agent logic, memory system, digest generation, knowledge ingestion, the entire product loop. These are the product's competitive advantage.

**Outsource:** Infrastructure concerns (database management via RDS, object storage via S3, job orchestration via Trigger.dev, code sandboxing via E2B, browser automation via Browserless, auth primitives via Better Auth). These are commodity infrastructure that distracts from product work.

### 4. Which service choices minimize ops load for a small team?

- **RDS over self-managed PostgreSQL** -- automated backups, patching, failover
- **Fargate over EC2** -- no instance management, no AMI updates, no SSH
- **E2B over self-built sandbox** -- no Firecracker management, no kernel images
- **Better Auth over custom auth** -- security-critical code you do not want to maintain
- **Trigger.dev over custom job system** -- retries, concurrency, observability for free
- **S3 over self-managed storage** -- durability, lifecycle policies, no disk management

### 5. Which choices are most likely to become expensive or painful later?

1. **LLM costs.** The single largest cost and hardest to predict. Mitigation: aggressive caching, model routing (cheap models for simple tasks, expensive models for synthesis), usage caps per tenant.

2. **NAT Gateway.** $32/month for the smallest deployment. Scales linearly with data transfer. Mitigation: Use fck-nat ($4/month) or VPC endpoints for S3/ECR.

3. **ALB.** $22/month minimum even with zero traffic. If running multiple hosted-dedicated instances, each would need its own ALB (or share one with path-based routing). Mitigation: Share one ALB across all customers using host-based routing.

4. **RDS Multi-AZ.** Doubles database cost when enabled. Mitigation: Start single-AZ, enable Multi-AZ only when SLA commitments require it.

5. **Trigger.dev self-hosted operational burden.** Self-hosting means you own upgrades, scaling, and debugging. Mitigation: Start with Trigger.dev Cloud ($50/month) and self-host only when cost or control requires it.

### 6. Which client strategy gives the best balance?

**Web-first with Capacitor for mobile and Tauri for desktop.** One React codebase in `packages/ui/` serves all platforms. Capacitor and Tauri are thin shells that wrap the same web app. The web app is the canonical client; desktop and mobile are distribution channels, not separate products.

This means:
- Zero UI duplication
- One set of components, one design system, one test suite
- Desktop and mobile builds are CI artifacts, not separate codebases
- Native capabilities (push notifications, system tray) are added incrementally via plugins
- The team never needs to hire React Native or Swift/Kotlin engineers

---

## 18. Critical Self-Review

### Weaknesses in This Recommendation

1. **Trigger.dev self-hosted is a risk.** Self-hosting a job orchestration platform is itself operational work. If the team is truly small (1-2 engineers), starting with Trigger.dev Cloud ($50/month) and migrating to self-hosted later may be wiser. The code is the same either way -- only the deployment target changes.

2. **PostgreSQL migration is non-trivial.** The current codebase has ~50+ raw SQL queries with SQLite-specific syntax. A thorough audit and testing pass is required. Consider using an ORM or query builder (Drizzle, Kysely) for new code to reduce dialect differences, even if existing code is migrated manually.

3. **Better Auth is young.** It was not widely adopted until 2025-2026. Clerk has a much larger ecosystem of pre-built UI components and framework integrations. If fast time-to-market on the auth UI matters more than self-hostability, Clerk may be the better Phase 1 choice, with migration to Better Auth later for self-hosted parity.

4. **Tauri requires Rust.** Even a thin shell needs some Rust knowledge for debugging build issues, signing, and native plugin integration. If no one on the team knows Rust, Electron is the pragmatic choice despite its bloat. The shell code is under 200 lines either way.

5. **Capacitor WebView performance on older devices.** The chat interface with SSE streaming and real-time updates may feel sluggish on older Android devices in a WebView. React Native would feel smoother on these devices. Counter-argument: pai is a personal tool for tech-savvy early adopters who generally have modern devices.

6. **Single NAT Gateway is a single point of failure.** If the NAT Gateway goes down, the Fargate tasks lose internet access (cannot reach LLM APIs, search APIs, etc.). For the MVP this is acceptable. For production, either add a second NAT Gateway ($32/month more) or use NAT instances with auto-recovery.

7. **No consideration of Neon or Supabase.** Neon (serverless PostgreSQL) offers true scale-to-zero and branching, which could be cheaper than RDS for low-usage customers. Supabase offers PostgreSQL + auth + storage + real-time in one package. Both are worth evaluating as alternatives to the RDS + Better Auth + S3 combination, particularly for reducing the number of services to manage.

### Alternative Approaches Worth Tracking

- **Fly.io instead of AWS.** Simpler developer experience, built-in Postgres, global edge deployment. But: team has AWS familiarity, CDK ecosystem, and AWS credits.
- **Coolify / Dokploy for self-hosted.** Open-source PaaS platforms that could simplify the self-hosted deployment story for non-technical users.
- **BullMQ + Redis instead of Trigger.dev.** Simpler, more battle-tested, but lacks durable execution and the built-in dashboard. Good fallback if Trigger.dev self-hosted proves too complex.

---

## 19. Sources

### AWS Services
- [AWS Fargate Pricing](https://aws.amazon.com/fargate/pricing/)
- [Amazon ECS Pricing](https://aws.amazon.com/ecs/pricing/)
- [Amazon RDS PostgreSQL Pricing](https://aws.amazon.com/rds/postgresql/pricing/)
- [Amazon Aurora Pricing](https://aws.amazon.com/rds/aurora/pricing/)
- [AWS Step Functions Pricing](https://aws.amazon.com/step-functions/pricing/)
- [AWS App Runner Pricing](https://aws.amazon.com/apprunner/pricing/)
- [CDK ECS Patterns Documentation](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ecs_patterns-readme.html)
- [CDK RDS Module Documentation](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_rds-readme.html)
- [CDK ECS Fargate Example](https://docs.aws.amazon.com/cdk/v2/guide/ecs_example.html)

### Background Jobs
- [Trigger.dev Pricing](https://trigger.dev/pricing)
- [Trigger.dev Self-Hosting Overview](https://trigger.dev/docs/self-hosting/overview)
- [Trigger.dev Self-Hosting v4 with Docker](https://trigger.dev/blog/self-hosting-trigger-dev-v4-docker)
- [Inngest Pricing](https://www.inngest.com/pricing)
- [Upstash QStash Pricing](https://upstash.com/pricing/qstash)

### Code Sandbox
- [E2B Pricing](https://e2b.dev/pricing)
- [E2B Documentation](https://e2b.dev/docs)
- [AI Code Sandbox Benchmark 2026](https://www.superagent.sh/blog/ai-code-sandbox-benchmark-2026)

### Browser Automation
- [Browserless Pricing](https://www.browserless.io/pricing)

### Search APIs
- [Brave Search API Pricing](https://api-dashboard.search.brave.com/documentation/pricing)
- [Tavily Pricing](https://www.tavily.com/pricing)
- [Tavily Credits and Pricing Docs](https://docs.tavily.com/documentation/api-credits)
- [Exa Pricing](https://exa.ai/pricing)
- [SerpAPI Pricing](https://serpapi.com/pricing)

### Auth
- [Better Auth Documentation](https://better-auth.com/docs/introduction)
- [Better Auth GitHub](https://github.com/better-auth/better-auth)
- [Auth Pricing Comparison (Cognito vs Auth0 vs Firebase)](https://zuplo.com/learning-center/api-authentication-pricing)

### Client Frameworks
- [Tauri vs Electron 2026 Guide](https://blog.nishikanta.in/tauri-vs-electron-the-complete-developers-guide-2026)
- [Capacitor vs React Native Comparison](https://nextnative.dev/blog/capacitor-vs-react-native)
- [Flutter vs React Native vs Capacitor vs Tauri 2026](https://www.oflight.co.jp/en/columns/flutter-rn-capacitor-tauri-overview-2026)

### SearXNG
- [SearXNG Documentation](https://docs.searxng.org/)
- [SearXNG Installation Guide](https://docs.searxng.org/admin/installation.html)

### App Runner Limitations
- [App Runner Issues Discussion (Medium)](https://medium.com/@naimulislam19149/some-issues-with-aws-apprunner-that-are-not-widely-discussed-0c85d066cb66)
- [App Runner Alternatives and Limitations (Qovery)](https://www.qovery.com/blog/aws-app-runner-alternatives)

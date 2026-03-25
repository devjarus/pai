# pai Platform Design Diagrams

**Companion to:** [architecture.md](./architecture.md)
**Date:** 2026-03-24

---

## 1. High-Level System Context (All Tiers)

```mermaid
graph TB
    subgraph Clients
        WEB[Web App<br/>React + Vite]
        DESK[Desktop App<br/>Tauri shell]
        MOB[Mobile App<br/>Capacitor shell]
        TG[Telegram Bot]
        CLI[CLI / MCP Server]
    end

    subgraph "pai API"
        API[Fastify Server<br/>REST + SSE]
    end

    subgraph "Background Processing"
        JOBS[Job Orchestrator<br/>Trigger.dev or In-Process]
    end

    subgraph "Data Layer"
        DB[(Database<br/>PostgreSQL or SQLite)]
        OBJ[Object Store<br/>S3 or Local FS]
    end

    subgraph "External Services"
        LLM[LLM Providers<br/>OpenAI / Anthropic / Ollama]
        SEARCH[Search APIs<br/>Brave / Tavily / SearXNG]
        SAND[Code Sandbox<br/>E2B or Docker sidecar]
        BROWSER[Browser Automation<br/>Browserless or Chromium]
    end

    WEB --> API
    DESK --> API
    MOB --> API
    TG --> API
    CLI --> API

    API --> DB
    API --> OBJ
    API --> JOBS

    JOBS --> DB
    JOBS --> LLM
    JOBS --> SEARCH
    JOBS --> SAND
    JOBS --> BROWSER

    API --> LLM
```

---

## 2. Self-Hosted Deployment

Everything runs on a single machine. No external infrastructure except LLM API keys.

```mermaid
graph TB
    subgraph "User Machine (Docker Compose)"
        subgraph "pai container"
            API2[Fastify API :3141]
            WORKER[In-Process Workers<br/>WorkerLoop + Dispatcher]
            AUTH[Better Auth<br/>Single Owner]
        end

        subgraph "Data Volume"
            SQLITE[(SQLite WAL<br/>personal-ai.db)]
            FS[Local Filesystem<br/>artifacts/]
        end

        subgraph "Optional Sidecars"
            SEARX[SearXNG :8080]
            SANDBOX[Sandbox :8888<br/>Python + Node + Chromium]
        end
    end

    subgraph "External"
        LLM2[LLM API<br/>OpenAI / Anthropic / Ollama]
    end

    API2 --> SQLITE
    API2 --> FS
    WORKER --> SQLITE
    WORKER --> LLM2
    WORKER --> SEARX
    WORKER --> SANDBOX
    API2 --> LLM2
```

### Docker Compose Structure (Self-Hosted)

```
docker-compose.yml
  services:
    pai:          # Main app (API + workers in-process)
      image: pai:latest
      ports: ["3141:3141"]
      volumes: ["pai-data:/data"]
      environment:
        PAI_MODE: self-hosted
        PAI_DATA_DIR: /data

    searxng:      # Optional: self-hosted search
      image: searxng/searxng
      ports: ["8080:8080"]
      profiles: ["search"]

    sandbox:      # Optional: code execution
      build: ./sandbox
      ports: ["8888:8888"]
      profiles: ["sandbox"]
```

---

## 3. Hosted MVP on AWS (Single Customer)

```mermaid
graph TB
    subgraph "Internet"
        USER[User Browser / Apps]
    end

    subgraph "AWS - us-east-1"
        subgraph "Public Subnet"
            ALB[Application Load Balancer<br/>HTTPS :443]
            NAT[NAT Gateway]
        end

        subgraph "Private Subnet"
            subgraph "ECS Fargate Cluster"
                API3[API Task<br/>0.5 vCPU, 1 GB<br/>Fastify :3141]
                WORK3[Worker Task<br/>0.5 vCPU, 1 GB<br/>Trigger.dev tasks]
            end
        end

        subgraph "Private Isolated Subnet"
            RDS[(RDS PostgreSQL<br/>db.t4g.small<br/>20 GB gp3)]
        end

        subgraph "AWS Services"
            S3[S3 Bucket<br/>pai-artifacts]
            ECR[ECR<br/>Docker images]
            SM[Secrets Manager<br/>DB creds, JWT secret]
            R53[Route 53<br/>DNS]
        end
    end

    subgraph "External Services"
        LLM3[LLM APIs]
        BRAVE[Brave Search API]
        E2B[E2B Sandbox]
        BLESS[Browserless]
    end

    USER --> ALB
    ALB --> API3
    API3 --> RDS
    API3 --> S3
    API3 --> WORK3

    WORK3 --> RDS
    WORK3 --> LLM3
    WORK3 --> BRAVE
    WORK3 --> E2B
    WORK3 --> BLESS

    API3 --> LLM3
    NAT --> LLM3
    NAT --> BRAVE
    NAT --> E2B
    NAT --> BLESS
```

---

## 4. Hosted Multi-Tenant Architecture (Future)

```mermaid
graph TB
    subgraph "Clients"
        C1[Tenant A]
        C2[Tenant B]
        C3[Tenant C]
    end

    subgraph "Edge"
        CF[CloudFront CDN<br/>Static UI assets]
        ALB2[ALB<br/>Host-based routing]
    end

    subgraph "Compute (ECS Fargate)"
        APIS[API Service<br/>Auto-scaling 2-10 tasks<br/>Stateless]
        WORKS[Worker Service<br/>Trigger.dev<br/>Per-tenant queues]
    end

    subgraph "Data"
        PG[(RDS PostgreSQL<br/>Row-Level Security<br/>tenant_id on all tables)]
        S32[S3<br/>/{tenant_id}/artifacts/]
    end

    subgraph "Auth"
        BA[Better Auth<br/>Organizations + Roles<br/>Social Login + SSO]
    end

    subgraph "Billing"
        STRIPE[Stripe<br/>Subscriptions + Usage]
    end

    C1 --> CF
    C2 --> CF
    C3 --> CF
    CF --> ALB2
    ALB2 --> APIS
    APIS --> BA
    APIS --> PG
    APIS --> S32
    APIS --> WORKS
    WORKS --> PG
    APIS --> STRIPE
```

---

## 5. CDK Stack Dependency Graph

```mermaid
graph TD
    NET[PaiNetworkStack<br/>VPC, Subnets, Security Groups<br/>NAT Gateway]
    DATA[PaiDataStack<br/>RDS PostgreSQL<br/>S3 Bucket<br/>Secrets Manager]
    COMP[PaiComputeStack<br/>ECS Cluster<br/>Fargate Services<br/>ALB, Route 53]

    NET --> DATA
    DATA --> COMP

    style NET fill:#e1f5fe
    style DATA fill:#fff3e0
    style COMP fill:#e8f5e9
```

### CDK Stack Contents

```
PaiNetworkStack
  |-- VPC (2 AZs, 1 NAT Gateway)
  |-- Public subnets (ALB, NAT)
  |-- Private subnets (Fargate tasks)
  |-- Private isolated subnets (RDS)
  |-- Security groups (api-sg, worker-sg, db-sg)

PaiDataStack (depends on Network)
  |-- RDS DatabaseInstance (PostgreSQL 16, t4g.small)
  |-- S3 Bucket (pai-artifacts, lifecycle rules)
  |-- Secrets Manager (DB credentials, JWT secret, API keys)

PaiComputeStack (depends on Data)
  |-- ECS Cluster
  |-- ECR Repository
  |-- ApplicationLoadBalancedFargateService (API)
  |-- FargateService (Worker)
  |-- ACM Certificate (HTTPS)
  |-- Route 53 Record (DNS)
```

---

## 6. Data Flow: Core Product Loop

```mermaid
sequenceDiagram
    participant U as User
    participant API as pai API
    participant DB as Database
    participant W as Worker
    participant LLM as LLM Provider
    participant S as Search API

    Note over U,S: ASK Phase
    U->>API: Chat message ("Track GPU prices")
    API->>LLM: Generate response + extract intent
    LLM-->>API: Response + Watch creation intent
    API->>DB: Save belief + create Watch
    API-->>U: "I'll track GPU prices weekly"

    Note over U,S: WATCH Phase (recurring)
    W->>DB: Check due schedules
    DB-->>W: Watch "GPU prices" is due
    W->>S: Search for GPU price data
    S-->>W: Search results
    W->>LLM: Analyze findings vs previous
    LLM-->>W: Structured findings
    W->>DB: Save research findings

    Note over U,S: DIGEST Phase
    W->>DB: Gather findings since last digest
    W->>LLM: Generate personalized briefing
    LLM-->>W: Digest with recommendations
    W->>DB: Save briefing
    W-->>U: Push notification / Telegram

    Note over U,S: CORRECTION Phase
    U->>API: "I care more about VRAM than price"
    API->>LLM: Extract preference update
    LLM-->>API: Belief update
    API->>DB: Update belief (preference)
    Note over W: Next digest incorporates correction
```

---

## 7. Background Job Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Queued: Job created
    Queued --> Running: Dispatcher picks up
    Running --> WaitingLLM: LLM call in progress
    WaitingLLM --> Running: LLM response received
    Running --> WaitingSearch: Search in progress
    WaitingSearch --> Running: Search results received
    Running --> Completed: All steps done
    Running --> Failed: Unrecoverable error
    Running --> Retrying: Transient error
    Retrying --> Running: Retry attempt
    Retrying --> Failed: Max retries exceeded
    Failed --> [*]
    Completed --> [*]

    note right of WaitingLLM
        Trigger.dev checkpoint:
        Process can be suspended,
        resumed on different machine
    end note
```

---

## 8. Auth and Tenancy Model

```
SELF-HOSTED (Single Owner)
================================
+---------------------------+
|  Better Auth              |
|  - Email/Password         |
|  - Optional Passkey       |
|  - Single session         |
|  - SQLite backend         |
+---------------------------+
         |
    [pai instance]
         |
    [SQLite DB - no tenant_id]


HOSTED DEDICATED (Single Workspace)
====================================
+---------------------------+
|  Better Auth              |
|  - Email/Password         |
|  - Google Social Login    |
|  - Workspace invitations  |
|  - PostgreSQL backend     |
+---------------------------+
         |
    [Fargate task per customer]
         |
    [Separate DB per customer on shared RDS]


HOSTED SHARED (Multi-Tenant)
==============================
+---------------------------+
|  Better Auth              |
|  - All auth methods       |
|  - Organizations          |
|  - Roles & Permissions    |
|  - SSO / SAML (enterprise)|
|  - PostgreSQL backend     |
+---------------------------+
         |
    [Shared Fargate service]
         |
    [Shared DB with RLS]
    [Every table has tenant_id]
    [Row-Level Security policies]
```

---

## 9. Client Architecture

```mermaid
graph TB
    subgraph "Source Code"
        UI[packages/ui/<br/>React + Vite + Tailwind + shadcn/ui<br/>SINGLE CODEBASE]
    end

    subgraph "Build Outputs"
        WEBUILD[Vite build<br/>Static HTML/JS/CSS]
        TAURIBUILD[Tauri build<br/>.dmg / .msi / .AppImage]
        CAPBUILD[Capacitor build<br/>.ipa / .apk]
    end

    subgraph "Distribution"
        CDN2[CDN / Fastify Static<br/>Web App]
        GHREL[GitHub Releases<br/>Desktop Downloads]
        STORE[App Store / Play Store<br/>Mobile Apps]
    end

    UI --> WEBUILD
    UI --> TAURIBUILD
    UI --> CAPBUILD

    WEBUILD --> CDN2
    TAURIBUILD --> GHREL
    CAPBUILD --> STORE

    style UI fill:#fff9c4
```

### Build Pipeline

```
GitHub Actions CI
  |
  +-- on push to main:
  |     |-- pnpm build (all packages)
  |     |-- pnpm verify (typecheck + test)
  |     |-- docker build + push to ECR
  |     |-- CDK deploy to staging
  |
  +-- on release tag:
        |-- All of the above, plus:
        |-- Tauri build (macOS, Windows, Linux)
        |-- Capacitor build (iOS, Android)
        |-- Upload to GitHub Releases
        |-- Submit to App Store / Play Store
```

---

## 10. Network Topology (AWS)

```
                    Internet
                       |
                  [Route 53]
                       |
              [ACM Certificate]
                       |
    +---------[ALB (public)]---------+
    |                                |
    |    Public Subnet AZ-a          |    Public Subnet AZ-b
    |    [NAT Gateway]               |
    |         |                      |
    |    Private Subnet AZ-a         |    Private Subnet AZ-b
    |    [Fargate: API task]         |    [Fargate: API task]  (auto-scale)
    |    [Fargate: Worker task]      |    [Fargate: Worker task]
    |         |                      |
    |    Private Isolated AZ-a       |    Private Isolated AZ-b
    |    [RDS Primary]               |    [RDS Standby]  (Multi-AZ, future)
    |                                |
    +--------------------------------+

    AWS Services (via VPC Endpoints or NAT):
      - S3 (Gateway Endpoint, free)
      - ECR (Interface Endpoint or NAT)
      - Secrets Manager (Interface Endpoint or NAT)
      - CloudWatch (Interface Endpoint or NAT)
```

---

## 11. Migration Phases Visual

```mermaid
gantt
    title pai Hosted Deployment Roadmap
    dateFormat YYYY-MM-DD
    axisFormat %b %d

    section Phase 1: Hosted MVP
    Abstract storage interface       :p1a, 2026-04-01, 7d
    CDK stacks (VPC+RDS+ECS+S3)     :p1b, 2026-04-01, 14d
    Docker CI pipeline to ECR        :p1c, 2026-04-08, 7d
    PAI_MODE environment switching   :p1d, 2026-04-08, 7d
    Better Auth integration          :p1e, 2026-04-15, 7d
    S3 artifact storage backend      :p1f, 2026-04-15, 7d
    Deploy + smoke test              :p1g, 2026-04-22, 7d

    section Phase 2: Background Jobs
    Deploy Trigger.dev self-hosted   :p2a, 2026-04-29, 7d
    Define Trigger.dev tasks         :p2b, 2026-04-29, 14d
    Integrate dispatcher             :p2c, 2026-05-06, 14d
    Concurrency + priority queues    :p2d, 2026-05-13, 7d
    Observability verification       :p2e, 2026-05-20, 7d

    section Phase 3: External Services
    E2B sandbox integration          :p3a, 2026-05-27, 7d
    Browserless integration          :p3b, 2026-06-03, 7d
    Search API integration           :p3c, 2026-06-03, 7d
    Tauri desktop builds             :p3d, 2026-06-10, 14d

    section Phase 4: Multi-Tenancy
    Tenant isolation (RLS)           :p4a, 2026-06-24, 21d
    Better Auth organizations        :p4b, 2026-07-08, 14d
    Per-tenant resource limits       :p4c, 2026-07-15, 14d
    Stripe billing integration       :p4d, 2026-07-22, 14d
    Capacitor mobile builds          :p4e, 2026-07-22, 14d
```

---

## 12. Cost Breakdown Visual

```
Monthly Cost Breakdown: Hosted MVP (Single Customer)
=====================================================

AWS Infrastructure           ~$110/month
  |-- ECS Fargate (API)        $14  ████
  |-- ECS Fargate (Worker)     $14  ████
  |-- RDS PostgreSQL           $25  ██████
  |-- ALB                      $22  █████
  |-- NAT Gateway              $32  ████████
  |-- S3 + ECR + SM + R53       $3  █

External Services             ~$5/month
  |-- Brave Search              $3  █
  |-- E2B Sandbox               $1
  |-- Browserless               $0  (free tier)

LLM Costs (estimated)        ~$93/month
  |-- Chat (50 msgs/day)      $15  ████
  |-- Research (5 jobs/day)    $75  ██████████████████
  |-- Digests (1/day)           $3  █

TOTAL                        ~$210/month
                              ========

With optimizations (fck-nat, smaller RDS, Fargate Spot):
AWS Infrastructure drops to  ~$60/month
TOTAL drops to               ~$160/month
```

---

## 13. Decision Matrix Summary

```
                    Self-Hosted    Hosted MVP    Hosted Multi-Tenant
                    ===========    ==========    ===================
Compute             Docker         ECS Fargate   ECS Fargate (auto-scale)
Database            SQLite         RDS PG small  RDS PG / Aurora Sv2
Workers             In-process     Trigger.dev   Trigger.dev (tenant queues)
Artifacts           Local FS       S3            S3 (tenant prefixes)
Search              SearXNG        Brave API     Brave + Tavily + Exa
Sandbox             Docker sidecar E2B           E2B
Browser             Chromium sidecar Browserless Browserless
Auth                Better Auth    Better Auth   Better Auth (orgs + SSO)
Desktop             N/A            Tauri         Tauri
Mobile              N/A            Capacitor     Capacitor
IaC                 docker-compose CDK (3 stacks) CDK (3 stacks)
```

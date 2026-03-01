# Autonomous Background Agents — Implementation Plan

> **Status**: Draft  
> **Author**: Architecture planner  
> **Date**: 2026-02-28  
> **Scope**: Flight research agent, Stock analysis agent, sandbox execution, deployment

---

## 1. Executive Recommendation

**Ship a "structured research" MVP in 3 weeks** by extending the existing `plugin-research` pattern with domain-specific tool sets (flight scraping, stock data) and typed result schemas. Use a Docker sidecar sandbox for code execution (charts, analysis scripts). Skip gVisor/Firecracker/Wasm — they add complexity with no user-facing value in v1.

The key insight: **90% of this is already built.** The research plugin already runs background jobs, tracks progress, delivers to inbox, and pushes to Telegram. We need to:

1. Add **domain-specific tools** (flight search, stock data APIs).
2. Add a **code execution sandbox** (Docker sidecar running a Python/Node container).
3. Add **typed result schemas** so the UI can render rich cards instead of raw markdown.
4. Add **new UI tool cards** for flights and stocks.

Everything else — job tracking, inbox delivery, schedules, worker loops, SSE streaming — already works.

---

## 2. Sandbox Runtime Option Matrix

| Criterion | Docker Sidecar | gVisor (runsc) | Kata Containers | Firecracker | Wasmtime |
|---|---|---|---|---|---|
| **Security Isolation** | ★★★☆☆ Process isolation, no host access | ★★★★☆ Syscall filtering, strong userspace kernel | ★★★★★ VM-level isolation per container | ★★★★★ MicroVM, minimal attack surface | ★★★★☆ Wasm sandbox, no syscall access |
| **Deployment Complexity** | ★★★★★ `docker compose` only | ★★★☆☆ Custom runtime install, config | ★★☆☆☆ Requires nested virt, heavy | ★★☆☆☆ Custom VMM, API integration | ★★★☆☆ Limited ecosystem, no pip/npm |
| **Cross-Platform** | ★★★★★ Linux + macOS + Windows | ★★☆☆☆ Linux only | ★★☆☆☆ Linux only (KVM) | ★☆☆☆☆ Linux only (KVM) | ★★★★☆ Cross-platform, limited libs |
| **Cost / Performance** | ★★★★☆ ~50MB idle, shared daemon | ★★★★☆ Minimal overhead | ★★☆☆☆ ~128MB per VM | ★★★☆☆ ~5MB per microVM, fast boot | ★★★★★ Near-native, tiny footprint |
| **Time-to-Ship** | ★★★★★ 1-2 days | ★★★☆☆ 1 week | ★★☆☆☆ 2+ weeks | ★★☆☆☆ 2+ weeks | ★★☆☆☆ 1-2 weeks (ecosystem gaps) |
| **Python/Node support** | ★★★★★ Full pip/npm | ★★★★★ Full (runs containers) | ★★★★★ Full (runs containers) | ★★★★☆ Needs rootfs prep | ★☆☆☆☆ No native pip/npm |
| **Railway compatible** | ★★★★★ Multi-service native | ★☆☆☆☆ No custom runtimes | ★☆☆☆☆ No nested virt | ★☆☆☆☆ No KVM | ★★★☆☆ Possible but limited |

### Recommendation

**Phase 1 → Docker Sidecar** (ship in days, works everywhere, Railway-native).  
**Phase 2 → gVisor** if multi-tenant or untrusted code execution becomes a requirement.  
**Phase 3 → Firecracker** only if selling to enterprises with strict compliance needs.

---

## 3. End-User Walkthroughs

### 3a. Flight Research Journey

```
User: "Find me flights from SFO to Tokyo for March 15-22, nonstop preferred, under $1200"

┌─ Chat UI ─────────────────────────────────────────────────────────┐
│                                                                    │
│  User: Find me flights from SFO to Tokyo for March 15-22,         │
│        nonstop preferred, under $1200                              │
│                                                                    │
│  ┌─ Tool Card: ✈ Flight Research ─────────────────────────────┐   │
│  │  Status: Collecting requirements...                         │   │
│  │  ✓ Origin: SFO                                              │   │
│  │  ✓ Destination: Tokyo (NRT/HND)                             │   │
│  │  ✓ Dates: Mar 15 → Mar 22                                   │   │
│  │  ✓ Constraints: nonstop, max $1,200                         │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                    │
│  Assistant: I'm starting a flight search for SFO → Tokyo,          │
│  Mar 15-22. I'll search multiple sources and deliver the best      │
│  options to your Inbox. This usually takes 2-3 minutes.            │
│                                                                    │
│  ┌─ Tool Card: 🔍 Research Started ───────────────────────────┐   │
│  │  Job: flight-research-abc123                                │   │
│  │  Status: ● Running                                          │   │
│  │  Progress: Searching Google Flights via SearxNG...           │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘

... 2 minutes later, Inbox shows: ...

┌─ Inbox ───────────────────────────────────────────────────────────┐
│                                                                    │
│  ✈ Flight Research  •  2 min ago                         ● unread  │
│  SFO → Tokyo, Mar 15-22                                            │
│                                                                    │
│  Found 4 options under $1,200. Best: ANA nonstop $987.             │
│  ▸ View full report                                                │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘

... clicking "View full report" ...

┌─ Flight Report Detail ────────────────────────────────────────────┐
│                                                                    │
│  ✈ SFO → Tokyo  •  Mar 15-22, 2026                                │
│  Found 4 options matching your criteria                            │
│                                                                    │
│  ┌─ Option 1 ─ Best Overall ★ ────────────────────────────────┐   │
│  │  ANA NH7  SFO → NRT                                        │   │
│  │  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │   │
│  │  Outbound: Mar 15, 11:25 AM → Mar 16, 3:25 PM  (11h 0m)   │   │
│  │  Return:   Mar 22, 5:30 PM → Mar 22, 10:15 AM  (9h 45m)   │   │
│  │                                                              │   │
│  │  $987 round-trip    Nonstop    ✓ Free checked bag            │   │
│  │  ✓ Refundable ($150 fee)      ✓ Seat selection included     │   │
│  │                                                              │   │
│  │  Why: Cheapest nonstop, includes bags, good times.           │   │
│  │  Score: 94/100                                               │   │
│  │                                                              │   │
│  │  [🔗 Book on ANA]  [🔗 Google Flights]                      │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                    │
│  ┌─ Option 2 ─ Budget Pick ───────────────────────────────────┐   │
│  │  JAL JL1  SFO → NRT                                        │   │
│  │  $1,043 round-trip  Nonstop  ✓ Bags  ✗ Non-refundable      │   │
│  │  Score: 88/100                                               │   │
│  │  [🔗 Book on JAL]                                           │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                    │
│  ┌─ Filters ──────────────────────────────────────────────────┐   │
│  │  [✓ Nonstop only]  [Max price: $1,200]  [Times: Any]       │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                    │
│  [↻ Refine search]  [💬 Start Chat]                                │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

### 3b. Stock Analysis Journey

```
User: "Analyze NVIDIA stock — is it a good buy at current levels?"

┌─ Chat UI ─────────────────────────────────────────────────────────┐
│                                                                    │
│  User: Analyze NVIDIA stock — is it a good buy at current levels?  │
│                                                                    │
│  ┌─ Tool Card: 📊 Stock Research ─────────────────────────────┐   │
│  │  Status: Collecting scope...                                │   │
│  │  ✓ Ticker: NVDA                                             │   │
│  │  ✓ Analysis: fundamental + technical                        │   │
│  │  ✓ Time horizon: medium-term                                │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                    │
│  Assistant: Starting a deep analysis of NVIDIA (NVDA). I'll       │
│  pull financial data, run charts, and check recent news. Results   │
│  will be in your Inbox in ~3-5 minutes.                            │
│                                                                    │
│  ┌─ Tool Card: 🔍 Research Started ───────────────────────────┐   │
│  │  Job: stock-research-def456                                 │   │
│  │  Status: ● Running                                          │   │
│  │  Steps:                                                     │   │
│  │    ✓ Fetching price data                                    │   │
│  │    ✓ Running technical analysis                              │   │
│  │    ● Generating charts...                                   │   │
│  │    ○ Compiling report                                       │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘

... Inbox report ...

┌─ Stock Report Detail ─────────────────────────────────────────────┐
│                                                                    │
│  📊 NVDA — NVIDIA Corporation                                      │
│  Analysis completed Feb 28, 2026                                   │
│                                                                    │
│  ┌─ Thesis ───────────────────────────────────────────────────┐   │
│  │  MODERATE BUY — Strong AI/data center tailwinds, but        │   │
│  │  elevated valuation limits near-term upside. Best entered    │   │
│  │  on pullbacks to the $115-120 support zone.                  │   │
│  │  Confidence: 72%                                             │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                    │
│  ┌─ Key Metrics ──────────────────────────────────────────────┐   │
│  │  Price: $131.42    P/E: 58.3     Market Cap: $3.2T          │   │
│  │  52w High: $153.13  52w Low: $75.61  YTD: +12.4%            │   │
│  │  Rev Growth: +94% YoY   EPS: $2.25 (beat est. by 8%)       │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                    │
│  ┌─ Charts ───────────────────────────────────────────────────┐   │
│  │  [6-month price + volume chart]                              │   │
│  │  ┌────────────────────────────────────────────────────┐     │   │
│  │  │   ╱╲    ╱╲╱╲                                       │     │   │
│  │  │  ╱  ╲╱╱╲    ╲   ╱╲                                │     │   │
│  │  │ ╱             ╲╱╱  ╲╱╲                             │     │   │
│  │  │╱                       ╲────                        │     │   │
│  │  └────────────────────────────────────────────────────┘     │   │
│  │  [NVDA vs S&P 500 benchmark — 1yr relative performance]     │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                    │
│  ┌─ Risks ────────────────────────────────────────────────────┐   │
│  │  ⚠ Valuation premium (P/E > 50x)                           │   │
│  │  ⚠ Export restrictions to China                              │   │
│  │  ⚠ Customer concentration (top 5 = 40% revenue)             │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                    │
│  ┌─ Sources ──────────────────────────────────────────────────┐   │
│  │  • Yahoo Finance — NVDA price data                          │   │
│  │  • SEC EDGAR — Latest 10-Q filing                           │   │
│  │  • Reuters — "NVIDIA beats Q4 estimates" (Feb 26)           │   │
│  │  • MarketWatch — Technical analysis signals                  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                    │
│  [↻ Update analysis]  [💬 Start Chat]                              │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

---

## 4. Engineering Plan — File-Level Change List

### Phase 1: Structured Research MVP (Weeks 1-2)

No sandbox needed. Uses existing research pipeline + web scraping via SearxNG. Flight and stock data come from web search + page fetching.

#### 4.1 Core: Typed Research Results

**`packages/core/src/research-schemas.ts`** (NEW)
```
- FlightOption { airline, flightNo, departure, arrival, duration, stops, 
                 price, currency, baggage, refundable, seatSelection,
                 bookingUrl, score, scoreReason }
- FlightReport { query: FlightQuery, options: FlightOption[], 
                 searchedAt, sources: string[] }
- StockMetrics { ticker, price, pe, marketCap, high52w, low52w, 
                 ytdReturn, revGrowth, epsActual, epsBeat }
- StockReport  { ticker, company, thesis, confidence, verdict,
                 metrics: StockMetrics, risks: string[], 
                 sources: { title, url }[], charts: ChartArtifact[] }
- ChartArtifact { id, type: "price"|"volume"|"comparison", 
                  format: "svg"|"png", data: string (base64 or SVG) }
- ResearchResult = 
    | { type: "flight", data: FlightReport }
    | { type: "stock",  data: StockReport }
    | { type: "general", data: { markdown: string } }
```

**`packages/core/src/background-jobs.ts`** (MODIFY)
```
- Add `resultType?: "flight" | "stock" | "general"` to BackgroundJob
- Add `structuredResult?: string` (JSON blob) alongside existing `result`
```

**`packages/core/src/index.ts`** (MODIFY)
```
- Export new research-schemas types
```

#### 4.2 Research Plugin: Domain-Specific Prompts

**`packages/plugin-research/src/research.ts`** (MODIFY)
```
- Add domain detection: parse goal → detect "flight" or "stock" intent
- Add FLIGHT_RESEARCH_PROMPT: instructs LLM to search for flights, 
  extract structured data, score options, format as FlightReport JSON
- Add STOCK_RESEARCH_PROMPT: instructs LLM to search for stock data,
  key metrics, analyst opinions, format as StockReport JSON
- Add result parsing: after LLM generates report, extract JSON 
  from markdown code fences, validate against schema, store as 
  structuredResult on the job
- Keep existing general research path untouched (additive)
```

**`packages/plugin-research/src/flight-tools.ts`** (NEW)
```
- search_flights: wraps SearxNG search with flight-specific queries
  (Google Flights URLs, Kayak, Skyscanner results)
- parse_flight_page: fetches a flights result page, extracts 
  structured flight data via LLM extraction
- Budget: max 8 searches, max 5 page reads (same pattern as research.ts)
```

**`packages/plugin-research/src/stock-tools.ts`** (NEW)
```
- search_stock_data: wraps SearxNG for Yahoo Finance, MarketWatch, etc.
- parse_stock_page: extracts key metrics from financial pages
- Budget: max 10 searches, max 5 page reads
```

#### 4.3 Server: Typed Job Results

**`packages/server/src/routes/jobs.ts`** (MODIFY)
```
- GET /api/jobs/:id — return structuredResult alongside report markdown
- Add resultType to job list response
```

**`packages/server/src/briefing.ts`** (MODIFY)
```
- createResearchBriefing: include resultType and structuredResult 
  in briefing metadata so inbox can render rich cards
```

#### 4.4 UI: Rich Result Cards

**`packages/ui/src/types.ts`** (MODIFY)
```
- Add FlightOption, FlightReport, StockMetrics, StockReport, 
  ChartArtifact, ResearchResult types (mirror core schemas)
- Add resultType to BackgroundJobInfo and ResearchJobDetail
- Add structuredResult to ResearchJobDetail
```

**`packages/ui/src/components/tools/ToolFlightResults.tsx`** (NEW)
```
- Renders FlightReport as a card list
- Each flight option: airline + flight no, times, duration, stops,
  price (large), baggage/refund badges, score pill, booking CTA
- Collapsible "Why this option" section
- Client-side filters: nonstop toggle, max price slider, time preference
- Mobile: stacked cards, sticky filter bar
- States: loading (skeleton), results, empty ("no flights found"), error
```

**`packages/ui/src/components/tools/ToolStockReport.tsx`** (NEW)
```
- Renders StockReport as a structured card
- Sections: Thesis (verdict badge + confidence), Key Metrics (grid),
  Charts (inline SVG/img), Risks (warning list), Sources (link list)
- Charts: render SVG inline or base64 PNG via <img>
- Mobile: thesis + metrics visible, charts scroll horizontally
- States: loading, results, error
```

**`packages/ui/src/components/tools/ToolResearchProgress.tsx`** (NEW)
```
- Enhanced job status card with step progress
- Steps: ✓ done, ● running, ○ pending
- Shows last update time, elapsed duration
- "View in Inbox" link when complete
```

**`packages/ui/src/components/tools/index.tsx`** (MODIFY)
```
- Export ToolFlightResults, ToolStockReport, ToolResearchProgress
```

**`packages/ui/src/pages/Inbox.tsx`** (MODIFY)
```
- Detect resultType on briefing
- Render FlightReport or StockReport inline in expanded briefing view
- Add "Rerun" and "Refine" action buttons
- Rerun: POST /api/inbox/:id/rerun → creates new research job with same goal
- Refine: opens chat thread with prefilled "Refine this research: ..."
```

**`packages/ui/src/pages/Jobs.tsx`** (MODIFY)
```
- Show step progress for running jobs (parse progress field)
- Show resultType badge (✈ Flight, 📊 Stock, 📝 General)
```

**`packages/server/src/routes/inbox.ts`** (MODIFY)
```
- POST /api/inbox/:id/rerun — extract goal from briefing, create new job
```

#### 4.5 Chat Integration

**`packages/plugin-assistant/src/tools.ts`** (MODIFY)
```
- research_start: add optional `type` parameter ("flight"|"stock"|"general")
- Auto-detect type from goal if not specified
- Pass type to createResearchJob → used to select domain-specific prompt
```

**`packages/ui/src/components/chat/`** (MODIFY where tool cards are registered)
```
- Register ToolFlightResults for tool name "flight_results"
- Register ToolStockReport for tool name "stock_results"  
- Register ToolResearchProgress for tool name "research_start" + "job_status"
```

---

### Phase 2: Sandbox Code Execution (Week 3)

Add a Docker sidecar that can run Python/Node scripts for chart generation and data analysis.

#### 4.6 Sandbox Sidecar

**`sandbox/Dockerfile`** (NEW)
```dockerfile
FROM python:3.12-slim
RUN pip install matplotlib pandas numpy yfinance plotly kaleido
RUN apt-get update && apt-get install -y --no-install-recommends nodejs npm && rm -rf /var/lib/apt/lists/*
COPY entrypoint.py /app/entrypoint.py
EXPOSE 8888
# HTTP API: POST /run {language, code, timeout} → {stdout, stderr, files[]}
CMD ["python", "/app/entrypoint.py"]
```

**`sandbox/entrypoint.py`** (NEW)
```
- Flask/FastAPI micro-server on port 8888
- POST /run: accepts {language: "python"|"node", code: string, timeout: int}
- Executes in subprocess with:
  - timeout (default 30s, max 120s)
  - memory limit (256MB)
  - no network access (iptables DROP)
  - temp working dir (cleaned after each run)
- Returns: {stdout, stderr, exitCode, files: [{name, base64}]}
- Files: any files written to /output/ are returned as base64
```

**`packages/core/src/sandbox.ts`** (NEW)
```
- runInSandbox(code: string, language: string, timeout?: number): Promise<SandboxResult>
- SandboxResult { stdout, stderr, exitCode, files: { name: string, data: string }[] }
- Calls http://sandbox:8888/run (Docker) or http://localhost:8888/run (local)
- URL from env: PAI_SANDBOX_URL (default: http://localhost:8888)
- Timeout handling: aborts fetch after timeout + 5s grace
```

#### 4.7 Agent Tools for Code Execution

**`packages/plugin-assistant/src/tools.ts`** (MODIFY)
```
- Add run_code tool:
  run_code({
    language: "python" | "node",
    code: string,
    purpose: string,  // "Generate NVDA price chart", logged for audit
  }) → { stdout, stderr, files[] }
  
- Gated: only available if PAI_SANDBOX_URL is set
- Files returned as artifacts, stored in data dir, referenced by ID
```

**`packages/plugin-research/src/stock-tools.ts`** (MODIFY)
```
- Add generate_chart tool that uses sandbox:
  - Generates Python script for matplotlib/plotly chart
  - Runs via sandbox
  - Returns chart as base64 PNG/SVG
  - Stored as ChartArtifact on the StockReport
```

#### 4.8 Docker Compose

**`docker-compose.yml`** (MODIFY)
```yaml
  sandbox:
    build:
      context: ./sandbox
      dockerfile: Dockerfile
    container_name: personal-ai-sandbox
    profiles:
      - sandbox    # opt-in, like ollama
    mem_limit: 512m
    cpus: 1.0
    # No network access except from pai service
    networks:
      - internal
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "curl -sf http://localhost:8888/health || exit 1"]
      interval: 30s
      timeout: 5s
      retries: 3
```

**`docker-compose.yml`** environment additions for `pai` service:
```yaml
    environment:
      - PAI_SANDBOX_URL=http://sandbox:8888   # only when sandbox profile active
```

#### 4.9 Artifact Storage

**`packages/core/src/artifacts.ts`** (NEW)
```
- storeArtifact(storage, { jobId, name, mimeType, data: Buffer }): string (artifactId)
- getArtifact(storage, artifactId): { name, mimeType, data: Buffer } | null
- listArtifacts(storage, jobId): { id, name, mimeType, size }[]
- Migration: CREATE TABLE artifacts (id, job_id, name, mime_type, data BLOB, created_at)
```

**`packages/server/src/routes/artifacts.ts`** (NEW)
```
- GET /api/artifacts/:id — serve artifact with correct Content-Type
- Used by UI to render chart images: <img src="/api/artifacts/abc123" />
```

---

### Phase 3: Advanced Dynamic Agents (Weeks 4-6)

#### 4.10 Agent Registry

**`packages/core/src/agent-registry.ts`** (NEW)
```
- Dynamic agent definitions stored in DB (not just code plugins)
- AgentDefinition { id, name, systemPrompt, tools: string[], 
                    resultSchema?: JSONSchema, isBackground: boolean }
- Seed with: flight-researcher, stock-analyst, general-researcher
- UI: Settings page shows registered agents, can toggle on/off
```

#### 4.11 Multi-Step Workflows

**`packages/core/src/workflows.ts`** (NEW)
```
- WorkflowStep { id, agentId, input, output, status, duration }
- Workflow { id, steps: WorkflowStep[], currentStep, status }
- Enables: "Research flights" → "Compare with last month's prices" → "Generate report"
- Stored in DB, visible in Jobs page as multi-step progress
```

#### 4.12 Tool Marketplace (Future)

**`packages/core/src/tool-registry.ts`** (NEW)
```
- ToolDefinition { name, description, inputSchema, execute: string (code) }
- User-defined tools that run in sandbox
- "Install tool from URL" — fetch tool definition, validate, register
```

---

## 5. Deployment Runbook

### 5a. Local Docker Commands

```bash
# Basic (no sandbox) — same as today
docker compose up -d

# With sandbox for code execution (charts, analysis)
docker compose --profile sandbox up -d

# With sandbox + local Ollama
docker compose --profile sandbox --profile local up -d

# Verify sandbox is running
curl http://localhost:8888/health
# → {"ok": true, "languages": ["python", "node"]}

# Test sandbox execution
curl -X POST http://localhost:8888/run \
  -H "Content-Type: application/json" \
  -d '{"language":"python","code":"print(2+2)","timeout":10}'
# → {"stdout":"4\n","stderr":"","exitCode":0,"files":[]}
```

### 5b. Railway Multi-Service Topology

```
┌─────────────────────────────────────────────────────┐
│  Railway Project: personal-ai                        │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │   pai     │  │ searxng  │  │    sandbox       │  │
│  │  :3141    │→ │  :8080   │  │    :8888         │  │
│  │ (volume)  │→ │          │  │ (no ext network) │  │
│  └──────────┘  └──────────┘  └──────────────────┘  │
│                                                      │
│  Environment Variables:                              │
│  pai:                                                │
│    PAI_SANDBOX_URL=http://sandbox.railway.internal:8888  │
│    PAI_SEARCH_URL=http://searxng.railway.internal:8080   │
│    PAI_LLM_PROVIDER=openai                           │
│    PAI_LLM_API_KEY=sk-...                            │
│                                                      │
│  sandbox:                                            │
│    # No env vars needed — internal only              │
│    # Railway internal networking handles routing     │
└─────────────────────────────────────────────────────┘
```

**Railway setup steps:**
1. Fork repo, connect to Railway
2. Add 3 services from the monorepo:
   - `pai` → root Dockerfile, port 3141, volume at `/data`
   - `searxng` → `searxng/Dockerfile`, port 8080 (internal only)
   - `sandbox` → `sandbox/Dockerfile`, port 8888 (internal only)
3. Set env vars on `pai` service (see above)
4. Deploy — Railway auto-discovers internal networking

---

## 6. UI Final State Spec

### 6a. Chat States

| State | Visual | Trigger |
|-------|--------|---------|
| Collecting requirements | Tool card with ✓ checkmarks appearing for each parsed field | User sends flight/stock request |
| Researching in background | Animated spinner + step progress list | After requirements collected |
| Ready to review | Green "Report ready" banner + "View in Inbox" link | Job completes |
| Error | Red error card with retry button | Job fails |

### 6b. Job Status Card (in Chat + Jobs page)

```
┌─ 📊 Stock Analysis: NVDA ─────────────────────────────┐
│  Status: ● Running          Started: 2 min ago         │
│                                                         │
│  Steps:                                                 │
│    ✓ Fetching price data           (8s)                 │
│    ✓ Searching news & analysis     (22s)                │
│    ● Generating charts...          (running)            │
│    ○ Compiling final report                             │
│                                                         │
│  Last update: 5 seconds ago                             │
└─────────────────────────────────────────────────────────┘
```

### 6c. Flight Result Card

```
┌─ ✈ ANA NH7 ─ Best Overall ★ ──────────────────────────┐
│                                                         │
│  SFO → NRT  •  Nonstop                                  │
│                                                         │
│  Mar 15   11:25 AM ─── 11h 0m ───→ Mar 16   3:25 PM   │
│  Mar 22    5:30 PM ─── 9h 45m ───→ Mar 22  10:15 AM   │
│                                                         │
│  ┌──────────┐  ✓ Free checked bag                       │
│  │  $987    │  ✓ Refundable ($150 fee)                  │
│  │ per person│  ✓ Seat selection included               │
│  └──────────┘                                           │
│                                                         │
│  Score: 94/100 — Cheapest nonstop, includes bags        │
│                                                         │
│  [🔗 Book on ANA]  [🔗 Google Flights]                  │
└─────────────────────────────────────────────────────────┘

Filters:  [✓ Nonstop]  [Max $1,200 ▾]  [Any time ▾]
```

**Mobile behavior:** Cards stack vertically, price is prominent, filters collapse into a bottom sheet.

### 6d. Stock Result Card

```
┌─ 📊 NVDA — NVIDIA Corporation ─────────────────────────┐
│                                                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │  MODERATE BUY        Confidence: 72%             │    │
│  │  Strong AI tailwinds, elevated valuation.        │    │
│  └─────────────────────────────────────────────────┘    │
│                                                          │
│  Price     P/E      Market Cap    YTD                    │
│  $131.42   58.3     $3.2T         +12.4%                 │
│                                                          │
│  52w Range: [$75.61 ████████████████░░ $153.13]          │
│                          ▲ $131.42                       │
│                                                          │
│  ┌─ 6-Month Price Chart ──────────────────────────┐     │
│  │  [SVG/PNG chart rendered from artifact]         │     │
│  └─────────────────────────────────────────────────┘     │
│                                                          │
│  Risks:                                                  │
│  ⚠ Valuation premium (P/E > 50x)                        │
│  ⚠ Export restrictions to China                          │
│  ⚠ Customer concentration                               │
│                                                          │
│  Sources: Yahoo Finance, SEC EDGAR, Reuters, MarketWatch │
└──────────────────────────────────────────────────────────┘
```

**Mobile behavior:** Metrics use 2-column grid, chart is full-width, thesis stays at top.

### 6e. Inbox Feed

```
┌─ Inbox  3  2 unread ──────────────────── [↻] [🗑] ─────┐
│                                                          │
│  📊 Stock Analysis: NVDA         ● 5 min ago            │
│  MODERATE BUY — Confidence: 72%. Strong AI tailwinds...  │
│  3 charts • 4 sources                                    │
│  ▸ View report                                           │
│                                                          │
│  ───────────────────────────────────────────────────────  │
│                                                          │
│  ✈ Flight Research: SFO → Tokyo   28 min ago            │
│  Found 4 options under $1,200. Best: ANA nonstop $987.   │
│  ▸ View report                                           │
│                                                          │
│  ───────────────────────────────────────────────────────  │
│                                                          │
│  ✨ Daily Briefing                  6h ago               │
│  Good morning! You have 2 open tasks and 1 new memory... │
│  ▸ View briefing                                         │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### 6f. Empty / Loading / Error States

| View | Empty | Loading | Error |
|------|-------|---------|-------|
| Flight Results | "No flights found matching your criteria. Try adjusting dates or budget." + [Refine] button | Skeleton cards (3) with animated pulse | "Search failed: [reason]. [Retry]" |
| Stock Report | "No data available for [TICKER]. Check if the ticker is correct." | Skeleton with metrics placeholder + chart placeholder | "Analysis failed: [reason]. [Retry]" |
| Job Progress | "No background jobs running." | Spinner + "Starting..." | "Job failed: [reason]. [Retry] [View Logs]" |
| Inbox | "Your inbox is empty. Start a research task from Chat!" | Spinner + "Loading briefings..." | "Failed to load inbox. [Retry]" |

---

## 7. Config & Environment Additions

### New environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PAI_SANDBOX_URL` | _(unset)_ | URL of the sandbox sidecar. If unset, `run_code` tool is not registered. |
| `PAI_SANDBOX_TIMEOUT` | `30` | Default timeout in seconds for sandbox execution. |
| `PAI_SANDBOX_MAX_MEMORY` | `256` | Max memory in MB for sandbox execution. |
| `PAI_FLIGHT_SEARCH_ENABLED` | `true` | Enable/disable flight research domain. |
| `PAI_STOCK_SEARCH_ENABLED` | `true` | Enable/disable stock research domain. |

### Config file additions (`config.json`)

```json
{
  "sandbox": {
    "url": "http://localhost:8888",
    "timeout": 30,
    "maxMemory": 256
  },
  "research": {
    "domains": {
      "flights": true,
      "stocks": true
    }
  }
}
```

---

## 8. Testing Strategy

### Unit Tests

| Area | Test file | What to test |
|------|-----------|--------------|
| Research schemas | `packages/core/test/research-schemas.test.ts` | Schema validation, serialization/deserialization |
| Flight tools | `packages/plugin-research/test/flight-tools.test.ts` | Query construction, result parsing, scoring |
| Stock tools | `packages/plugin-research/test/stock-tools.test.ts` | Metric extraction, chart generation trigger |
| Sandbox client | `packages/core/test/sandbox.test.ts` | HTTP call mock, timeout handling, error cases |
| Artifacts | `packages/core/test/artifacts.test.ts` | Store, retrieve, list, cleanup |
| Domain detection | `packages/plugin-research/test/domain-detect.test.ts` | "flights SFO→NRT" → flight, "analyze NVDA" → stock |

### E2E Tests

| Spec | What to test |
|------|--------------|
| `tests/e2e/05-research.spec.ts` | Start research via chat, verify job appears in Jobs page, verify report in Inbox |
| `tests/e2e/06-flights.spec.ts` | Flight query → structured card renders in Inbox with flight options |
| `tests/e2e/07-stocks.spec.ts` | Stock query → report card renders with metrics and thesis |

E2E tests will use the existing mock LLM server with domain-specific mock responses added.

### Integration Tests

| Test | What to test |
|------|--------------|
| Sandbox integration | Docker sidecar starts, accepts code, returns output, respects timeout |
| Full research flow | Goal → domain detection → tools → structured result → inbox delivery |

---

## 9. Risks and Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Runaway code in sandbox** | High | Timeout (30s default), memory limit (256MB), no network, process isolation, kill after timeout+5s grace |
| **Output/token explosion** | Medium | Cap research tool budgets (max searches, max pages). Cap sandbox stdout to 100KB. Cap structured result JSON to 500KB. |
| **Duplicate worker execution** | Medium | Existing: job ID deduplication in `upsertJob`. Add: `SELECT FOR UPDATE` style lock (SQLite `BEGIN IMMEDIATE`) before starting a job. |
| **Untrusted scraping/code** | High | Sandbox has no network access. Web scraping goes through SearxNG (rate-limited). User code runs in isolated container. Never `eval()` in the main process. |
| **LLM hallucinating flight data** | High | Require structured JSON output with validation. Cross-reference prices across sources. Show "AI-generated, verify before booking" disclaimer. |
| **Stale stock data** | Medium | Always show data timestamp. Use `yfinance` for real-time quotes in sandbox (when available). Mark data freshness in UI. |
| **Sandbox container escapes** | Low (Docker) | Phase 2: migrate to gVisor for stronger isolation. For v1: acceptable risk for self-hosted personal tool. |
| **Railway cost from sandbox** | Low | Sandbox idles at ~30MB. Only active during code execution. Auto-sleep if no requests for 5min. |

---

## 10. Definition of Done Checklist

### Phase 1: Structured Research MVP

- [ ] `research-schemas.ts` types defined and exported from core
- [ ] Domain detection (flight/stock/general) works in research plugin
- [ ] Flight research produces `FlightReport` JSON stored on job
- [ ] Stock research produces `StockReport` JSON stored on job
- [ ] `GET /api/jobs/:id` returns `structuredResult` and `resultType`
- [ ] `ToolFlightResults` card renders flight options with prices, durations, booking links
- [ ] `ToolStockReport` card renders thesis, metrics, risks, sources
- [ ] `ToolResearchProgress` card shows step-by-step progress
- [ ] Inbox renders rich cards for flight and stock reports
- [ ] Inbox "Rerun" button creates new job with same goal
- [ ] Jobs page shows resultType badge
- [ ] All new components have loading, empty, and error states
- [ ] Mobile-responsive layout for all new cards
- [ ] Unit tests for schemas, domain detection, flight/stock tools
- [ ] E2E test for research → inbox flow
- [ ] `pnpm lint` + `pnpm test` + `pnpm typecheck` pass
- [ ] CHANGELOG updated

### Phase 2: Sandbox Code Execution

- [ ] `sandbox/Dockerfile` builds and runs
- [ ] Sandbox HTTP API accepts code, returns output + files
- [ ] `run_code` tool registered when `PAI_SANDBOX_URL` is set
- [ ] Stock research uses sandbox for chart generation
- [ ] Charts stored as artifacts, served via `/api/artifacts/:id`
- [ ] `docker compose --profile sandbox up -d` works
- [ ] Railway deployment with sandbox service documented
- [ ] Timeout and memory limits enforced
- [ ] No network access from sandbox verified
- [ ] Integration test for sandbox → chart → report flow

### Phase 3: Advanced Agents

- [ ] Agent registry in DB with CRUD API
- [ ] Multi-step workflow support
- [ ] Settings UI for agent management
- [ ] Tool marketplace design doc

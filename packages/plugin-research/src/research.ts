import { generateText, tool, stepCountIs } from "ai";
import type { LanguageModel } from "ai";
import { z } from "zod";
import { nanoid } from "nanoid";
import type { Storage, LLMClient, Logger, ResearchResultType } from "@personal-ai/core";
import { formatDateTime, detectResearchDomain } from "@personal-ai/core";
import { upsertJob, updateJobStatus, knowledgeSearch, appendMessages, learnFromContent } from "@personal-ai/core";
import type { BackgroundJob } from "@personal-ai/core";

// ---- Types ----

export interface ResearchJob {
  id: string;
  threadId: string | null;
  goal: string;
  status: "pending" | "running" | "done" | "failed";
  resultType: ResearchResultType;
  budgetMaxSearches: number;
  budgetMaxPages: number;
  searchesUsed: number;
  pagesLearned: number;
  stepsLog: string[];
  report: string | null;
  briefingId: string | null;
  createdAt: string;
  completedAt: string | null;
}

interface ResearchJobRow {
  id: string;
  thread_id: string | null;
  goal: string;
  status: string;
  result_type: string | null;
  budget_max_searches: number;
  budget_max_pages: number;
  searches_used: number;
  pages_learned: number;
  steps_log: string;
  report: string | null;
  briefing_id: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface ResearchContext {
  storage: Storage;
  llm: LLMClient;
  logger: Logger;
  /** IANA timezone for date formatting (e.g. "America/Los_Angeles") */
  timezone?: string;
  /** Web search function — injected to avoid circular dependency */
  webSearch: (query: string, maxResults?: number) => Promise<Array<{ title: string; url: string; snippet: string }>>;
  /** Format search results for display */
  formatSearchResults: (results: Array<{ title: string; url: string; snippet: string }>) => string;
  /** Fetch a web page as markdown — injected to avoid circular dependency */
  fetchPage: (url: string) => Promise<{ title: string; markdown: string; url: string } | null>;
}

// ---- Data Access ----

export function createResearchJob(
  storage: Storage,
  opts: { goal: string; threadId: string | null; maxSearches?: number; maxPages?: number; resultType?: ResearchResultType },
): string {
  const id = nanoid();
  const detectedType = opts.resultType ?? detectResearchDomain(opts.goal);
  storage.run(
    `INSERT INTO research_jobs (id, thread_id, goal, status, result_type, budget_max_searches, budget_max_pages, created_at)
     VALUES (?, ?, ?, 'pending', ?, ?, ?, datetime('now'))`,
    [id, opts.threadId, opts.goal, detectedType, opts.maxSearches ?? 5, opts.maxPages ?? 3],
  );
  return id;
}

export function getResearchJob(storage: Storage, id: string): ResearchJob | null {
  const rows = storage.query<ResearchJobRow>(
    "SELECT * FROM research_jobs WHERE id = ?",
    [id],
  );
  if (rows.length === 0) return null;
  const row = rows[0]!;
  return {
    id: row.id,
    threadId: row.thread_id,
    goal: row.goal,
    status: row.status as ResearchJob["status"],
    resultType: (row.result_type as ResearchResultType) ?? "general",
    budgetMaxSearches: row.budget_max_searches,
    budgetMaxPages: row.budget_max_pages,
    searchesUsed: row.searches_used,
    pagesLearned: row.pages_learned,
    stepsLog: JSON.parse(row.steps_log) as string[],
    report: row.report,
    briefingId: row.briefing_id,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export function listResearchJobs(storage: Storage): ResearchJob[] {
  const rows = storage.query<ResearchJobRow>(
    "SELECT * FROM research_jobs ORDER BY created_at DESC LIMIT 50",
  );
  return rows.map((row) => ({
    id: row.id,
    threadId: row.thread_id,
    goal: row.goal,
    status: row.status as ResearchJob["status"],
    resultType: (row.result_type as ResearchResultType) ?? "general",
    budgetMaxSearches: row.budget_max_searches,
    budgetMaxPages: row.budget_max_pages,
    searchesUsed: row.searches_used,
    pagesLearned: row.pages_learned,
    stepsLog: JSON.parse(row.steps_log) as string[],
    report: row.report,
    briefingId: row.briefing_id,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  }));
}

export function clearCompletedJobs(storage: Storage): number {
  const count = storage.query<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM research_jobs WHERE status IN ('done', 'failed')",
  )[0]?.cnt ?? 0;
  storage.run("DELETE FROM research_jobs WHERE status IN ('done', 'failed')");
  return count;
}

function updateJob(storage: Storage, id: string, fields: Record<string, unknown>): void {
  const sets = Object.keys(fields).map((k) => `${k} = ?`).join(", ");
  const values = Object.values(fields);
  storage.run(`UPDATE research_jobs SET ${sets} WHERE id = ?`, [...values, id]);
}

// ---- Research Agent System Prompt ----

function getResearchSystemPrompt(timezone?: string): string {
  const dt = formatDateTime(timezone);

  return `You are a Research Agent. Your job is to thoroughly research a topic and produce a structured report.

## Current Date
Today is ${dt.date}. When searching for recent information, news, or developments, always include the current year (${dt.year}) in your search queries to get up-to-date results. Prioritize recent sources over older ones.

## Process
1. First, check existing knowledge using knowledge_search to see what's already known about this topic
2. Plan your research approach — focus on what's NEW or CHANGED since previous reports
3. Execute searches using web_search — include the year "${dt.year}" in queries about recent topics
4. Read important pages using read_page to get detailed content
5. Synthesize findings into a structured report with NEW information only

## Building on Previous Research
When knowledge_search returns previous research reports on the same topic:
- Do NOT repeat previously known findings — the user already has those
- Focus on what's NEW, CHANGED, or UPDATED since the last report
- Reference previous findings briefly ("Previously reported X — now Y")
- If nothing has changed, say so clearly rather than restating old information

## Report Format
Your final response MUST be a structured markdown report:

# Research Report: [Topic]

## Summary
[2-3 sentence overview of findings]

## Key Findings
- [Finding 1 with detail]
- [Finding 2 with detail]
- [Finding 3 with detail]

## Sources
- [URL 1] — [what it contributed]
- [URL 2] — [what it contributed]

## Budget
You have a limited budget for searches and page reads. When a tool tells you the budget is exhausted, stop searching and synthesize what you have into the report.

Be thorough but efficient. Focus on the most relevant and authoritative sources.`;
}

function getFlightResearchPrompt(timezone?: string): string {
  const dt = formatDateTime(timezone);
  return `You are a Flight Research Agent. Your job is to find the best flight options for the user.

## Current Date
Today is ${dt.date} (${dt.year}).

## Process
1. Search for flights using web_search with specific queries like "flights [origin] to [destination] [dates] site:google.com/flights" or "cheap flights [route] [month year]"
2. Read flight comparison pages using read_page to extract prices, airlines, durations
3. Search for the specific airlines and routes to find booking links
4. Compile findings into a structured report

## Report Format
Your final response MUST be valid JSON wrapped in a markdown code fence:

\`\`\`json
{
  "query": {
    "origin": "SFO",
    "destination": "NRT",
    "departDate": "2026-03-15",
    "returnDate": "2026-03-22",
    "passengers": 1,
    "maxPrice": 1200,
    "nonstopOnly": false,
    "cabinClass": "economy"
  },
  "options": [
    {
      "airline": "ANA",
      "flightNo": "NH7",
      "departure": "2026-03-15T11:25:00",
      "arrival": "2026-03-16T15:25:00",
      "duration": "11h 0m",
      "stops": 0,
      "price": 987,
      "currency": "USD",
      "returnDeparture": "2026-03-22T17:30:00",
      "returnArrival": "2026-03-22T10:15:00",
      "returnDuration": "9h 45m",
      "returnStops": 0,
      "baggage": "1 checked bag included",
      "refundable": true,
      "bookingUrl": "https://www.ana.co.jp",
      "score": 94,
      "scoreReason": "Cheapest nonstop option with included bags"
    }
  ],
  "searchedAt": "${new Date().toISOString()}",
  "sources": ["google.com/flights", "kayak.com"],
  "disclaimer": "Prices are approximate and may vary. Always verify on the airline website before booking."
}
\`\`\`

## Scoring Rules
- Score 0-100 based on: price (40%), duration (20%), stops (20%), amenities (10%), schedule (10%)
- Nonstop flights get +15 bonus if user prefers nonstop
- Cheapest option gets +10 bonus
- Sort options by score descending

## Budget
You have limited searches and page reads. Be efficient — focus on the most useful flight aggregator sites.`;
}

function getStockResearchPrompt(timezone?: string): string {
  const dt = formatDateTime(timezone);
  return `You are a Stock Research Agent. Your job is to analyze a stock and produce an investment thesis.

## Current Date
Today is ${dt.date} (${dt.year}).

## Process
1. Search for the stock's current price, key metrics, and recent news
2. Read financial analysis pages for detailed metrics
3. Search for analyst opinions and price targets
4. Check for recent earnings reports and guidance
5. Compile findings into a structured report

## Report Format
Your final response MUST be valid JSON wrapped in a markdown code fence:

\`\`\`json
{
  "ticker": "NVDA",
  "company": "NVIDIA Corporation",
  "thesis": "Strong AI/data center tailwinds support continued growth, but elevated valuation limits near-term upside.",
  "confidence": 72,
  "verdict": "buy",
  "metrics": {
    "ticker": "NVDA",
    "company": "NVIDIA Corporation",
    "price": 131.42,
    "currency": "USD",
    "pe": 58.3,
    "marketCap": "$3.2T",
    "high52w": 153.13,
    "low52w": 75.61,
    "ytdReturn": "+12.4%",
    "revGrowth": "+94% YoY",
    "epsActual": 2.25,
    "epsBeat": "+8%"
  },
  "risks": [
    "Valuation premium (P/E > 50x)",
    "Export restrictions to China",
    "Customer concentration (top 5 = 40% revenue)"
  ],
  "catalysts": [
    "AI infrastructure spending accelerating",
    "New Blackwell architecture ramping",
    "Data center revenue growing 100%+ YoY"
  ],
  "sources": [
    {"title": "Yahoo Finance - NVDA", "url": "https://finance.yahoo.com/quote/NVDA"},
    {"title": "Reuters - NVIDIA Q4 results", "url": "https://reuters.com/technology/nvidia-q4-2026"}
  ],
  "charts": [],
  "analyzedAt": "${new Date().toISOString()}"
}
\`\`\`

## Verdict Scale
- "strong_buy": Very high conviction, significantly undervalued
- "buy": Positive outlook, good risk/reward
- "hold": Fair value, wait for better entry
- "sell": Overvalued or deteriorating fundamentals
- "strong_sell": High conviction negative, significant downside risk

## Confidence Scale
- 0-30: Low confidence, limited data
- 31-60: Moderate confidence, mixed signals
- 61-80: Good confidence, clear thesis
- 81-100: High confidence, strong supporting data

## Budget
You have limited searches and page reads. Prioritize authoritative financial sources.`;
}

// ---- Budget-Limited Tool Factories ----

function createResearchTools(
  ctx: ResearchContext,
  jobId: string,
  job: { budgetMaxSearches: number; budgetMaxPages: number },
) {
  let searchesUsed = 0;
  let pagesRead = 0;

  return {
    web_search: tool({
      description: "Search the web for information. Budget-limited.",
      inputSchema: z.object({
        query: z.string().describe("Search query"),
      }),
      execute: async ({ query }: { query: string }) => {
        if (searchesUsed >= job.budgetMaxSearches) {
          return "Budget exhausted — you've used all your web searches. Synthesize your findings into the report now.";
        }
        searchesUsed++;
        updateJob(ctx.storage, jobId, { searches_used: searchesUsed });

        try {
          const results = await ctx.webSearch(query, 5);
          if (results.length === 0) return "No results found for this query.";
          return ctx.formatSearchResults(results);
        } catch (err) {
          return `Search failed: ${err instanceof Error ? err.message : "unknown error"}`;
        }
      },
    }),

    read_page: tool({
      description: "Fetch and read a web page to get detailed content. Budget-limited.",
      inputSchema: z.object({
        url: z.string().url().describe("URL to read"),
      }),
      execute: async ({ url }: { url: string }) => {
        if (pagesRead >= job.budgetMaxPages) {
          return "Budget exhausted — you've used all your page reads. Synthesize your findings into the report now.";
        }
        pagesRead++;
        updateJob(ctx.storage, jobId, { pages_learned: pagesRead });

        try {
          const page = await ctx.fetchPage(url);
          if (!page) return "Could not extract content from this page.";
          return `# ${page.title}\n\n${page.markdown.slice(0, 3000)}`;
        } catch (err) {
          return `Failed to read page: ${err instanceof Error ? err.message : "unknown error"}`;
        }
      },
    }),

    knowledge_search: tool({
      description: "Search existing knowledge base for relevant information already learned.",
      inputSchema: z.object({
        query: z.string().describe("What to search for"),
      }),
      execute: async ({ query }: { query: string }) => {
        try {
          const results = await knowledgeSearch(ctx.storage, ctx.llm, query, 3);
          if (results.length === 0) return "No existing knowledge on this topic.";
          return results.slice(0, 3).map((r) => ({
            content: r.chunk.content.slice(0, 500),
            source: r.source.title,
          }));
        } catch {
          return "Knowledge search unavailable.";
        }
      },
    }),
  };
}

// ---- Background Execution ----

export async function runResearchInBackground(
  ctx: ResearchContext,
  jobId: string,
): Promise<void> {
  const job = getResearchJob(ctx.storage, jobId);
  if (!job) {
    ctx.logger.error(`Research job ${jobId} not found`);
    return;
  }

  // Register in shared tracker (DB-backed)
  const tracked: BackgroundJob = {
    id: jobId,
    type: "research",
    label: job.goal.slice(0, 100),
    status: "running",
    progress: "starting",
    startedAt: new Date().toISOString(),
  };
  upsertJob(ctx.storage, tracked);

  // Set status to running
  updateJob(ctx.storage, jobId, { status: "running" });

  try {
    const tools = createResearchTools(ctx, jobId, job);

    // Select domain-specific system prompt
    let systemPrompt: string;
    switch (job.resultType) {
      case "flight":
        systemPrompt = getFlightResearchPrompt(ctx.timezone);
        break;
      case "stock":
        systemPrompt = getStockResearchPrompt(ctx.timezone);
        break;
      default:
        systemPrompt = getResearchSystemPrompt(ctx.timezone);
    }

    const result = await generateText({
      model: ctx.llm.getModel() as LanguageModel,
      system: systemPrompt,
      messages: [
        { role: "user", content: `Research this topic thoroughly: ${job.goal}` },
      ],
      tools,
      toolChoice: "auto",
      stopWhen: stepCountIs(8),
      maxRetries: 1,
    });

    const report = result.text || "Research completed but no report was generated.";

    // Extract structured result from domain-specific reports
    let structuredResult: string | undefined;
    if (job.resultType !== "general") {
      try {
        const jsonMatch = report.match(/```json\s*([\s\S]*?)```/);
        if (jsonMatch?.[1]) {
          // Validate it's parseable JSON
          JSON.parse(jsonMatch[1].trim());
          structuredResult = jsonMatch[1].trim();
        }
      } catch {
        ctx.logger.warn(`Failed to extract structured result from ${job.resultType} research`, { jobId });
      }
    }

    // Store report and mark done
    updateJob(ctx.storage, jobId, {
      status: "done",
      report,
      completed_at: new Date().toISOString(),
    });

    updateJobStatus(ctx.storage, jobId, {
      status: "done",
      progress: "complete",
      result: report.slice(0, 200),
      resultType: job.resultType,
      ...(structuredResult ? { structuredResult } : {}),
    });

    // Learn the report into the knowledge base so future research builds on it
    try {
      const reportUrl = `research://${jobId}`;
      const reportTitle = `Research Report: ${job.goal.slice(0, 100)}`;
      await learnFromContent(ctx.storage, ctx.llm, reportUrl, reportTitle, report);
      ctx.logger.info(`Stored research report in knowledge base`, { jobId, goal: job.goal });
    } catch (err) {
      ctx.logger.warn(`Failed to store research report in knowledge: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Create Inbox briefing for the report
    try {
      const briefingId = `research-${jobId}`;
      ctx.storage.run(
        "INSERT INTO briefings (id, generated_at, sections, raw_context, status, type) VALUES (?, datetime('now'), ?, null, 'ready', 'research')",
        [briefingId, JSON.stringify({ report, goal: job.goal, resultType: job.resultType, ...(structuredResult ? { structuredResult } : {}) })],
      );
      updateJob(ctx.storage, jobId, { briefing_id: briefingId });
    } catch (err) {
      ctx.logger.warn(`Failed to create research briefing: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Append summary to originating chat thread
    if (job.threadId) {
      try {
        const summary = report.length > 500
          ? report.slice(0, 500) + "\n\n*Full report available in your Inbox.*"
          : report;
        appendMessages(ctx.storage, job.threadId, [
          { role: "assistant", content: `Research complete: "${job.goal}"\n\n${summary}` },
        ]);
      } catch (err) {
        ctx.logger.warn(`Failed to append research results to thread: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    ctx.logger.info(`Research job ${jobId} completed`, { goal: job.goal });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    updateJob(ctx.storage, jobId, {
      status: "failed",
      completed_at: new Date().toISOString(),
    });

    updateJobStatus(ctx.storage, jobId, { status: "error", error: errorMsg });

    // Post failure to thread
    if (job.threadId) {
      try {
        appendMessages(ctx.storage, job.threadId, [
          { role: "assistant", content: `Research failed: "${job.goal}"\n\nError: ${errorMsg}` },
        ]);
      } catch {
        // ignore
      }
    }

    ctx.logger.error(`Research job ${jobId} failed: ${errorMsg}`);
  }
}

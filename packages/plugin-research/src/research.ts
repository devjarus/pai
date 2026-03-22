import { stepCountIs } from "ai";
import type { LanguageModel } from "ai";
import type { BackgroundJob } from "@personal-ai/core";
import {
  buildBriefSignalHash,
  buildReportBriefSection,
  getContextBudget,
  getProviderOptions,
  buildReportPresentation,
  deriveReportVisuals,
  extractPresentationBlocks,
  instrumentedGenerateText,
  runAgentHarness,
  stripEnrichmentFromGoal,
} from "@personal-ai/core";
import { upsertJob, updateJobStatus, appendMessages, learnFromContent } from "@personal-ai/core";
import { getProgramById, recordProgramEvaluation } from "@personal-ai/plugin-schedules";
import { ingestResearchResult, computeFindingDelta } from "@personal-ai/library";
import type { ResearchFinding, ResearchFindingSource } from "@personal-ai/library";
import { enrichResearchSource, normalizeResearchSourceUrl, summarizeResearchSources } from "@personal-ai/library";

import type { ResearchContext } from "./types.js";
import { RESEARCH_LLM_TIMEOUT } from "./types.js";
import { getResearchJob, updateResearchJob, getProgramActionSummary } from "./repository.js";
import { getPromptForResultType } from "./prompts.js";
import { createResearchTools } from "./tools.js";
import { generateStockChartCode } from "./charts.js";

// Re-export everything consumers need from the split modules
export type { ResearchJob, ResearchContext } from "./types.js";
export {
  createResearchJob,
  getResearchJob,
  listResearchJobs,
  listPendingResearchJobs,
  cancelResearchJob,
  recoverStaleResearchJobs,
  cancelAllRunningResearchJobs,
  clearCompletedJobs,
} from "./repository.js";

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0.35;
  return Math.max(0.2, Math.min(0.95, Math.round(value * 100) / 100));
}

function normalizedSourceSet(sources: ResearchFindingSource[]): Set<string> {
  return new Set(
    sources
      .map((source) => normalizeResearchSourceUrl(source.url))
      .filter((url): url is string => !!url),
  );
}

function calculateNoveltySignals(
  previousFinding: ResearchFinding | undefined,
  summary: string,
  sources: ResearchFindingSource[],
): {
  delta?: { changed: string[]; significance: number };
  sourceNovelty: number;
  deltaSignificance: number;
  noveltyScore: number;
} {
  if (!previousFinding) {
    return {
      sourceNovelty: 1,
      deltaSignificance: 1,
      noveltyScore: 1,
    };
  }

  const delta = computeFindingDelta(previousFinding.summary, summary);
  const currentSources = normalizedSourceSet(sources);
  const previousSources = normalizedSourceSet(previousFinding.sources);
  const newSources = [...currentSources].filter((source) => !previousSources.has(source)).length;
  const sourceNovelty = currentSources.size > 0 ? newSources / currentSources.size : 0;
  const deltaSignificance = Math.max(0, Math.min(1, delta.significance));
  const noveltyScore = currentSources.size > 0
    ? deltaSignificance * 0.65 + sourceNovelty * 0.35
    : deltaSignificance;

  return {
    delta,
    sourceNovelty,
    deltaSignificance,
    noveltyScore,
  };
}

function pushSource(
  sources: Map<string, ResearchFindingSource>,
  url: string,
  title: string | undefined,
  fetchedAt: string,
  relevance = 0.8,
): void {
  const normalizedUrl = normalizeResearchSourceUrl(url);
  if (!normalizedUrl) return;
  if (sources.has(normalizedUrl)) return;
  sources.set(normalizedUrl, enrichResearchSource({
    url: normalizedUrl,
    title: title?.trim() || new URL(normalizedUrl).hostname,
    fetchedAt,
    relevance,
  }));
}

function extractStructuredSources(
  structuredResult: string | undefined,
  fetchedAt: string,
): ResearchFindingSource[] {
  if (!structuredResult) return [];

  const sources = new Map<string, ResearchFindingSource>();

  try {
    const parsed = JSON.parse(structuredResult) as Record<string, unknown>;
    const collections = [
      parsed.sources,
      parsed.articles,
      parsed.findings,
      parsed.results,
    ];

    for (const collection of collections) {
      if (!Array.isArray(collection)) continue;
      for (const item of collection) {
        if (typeof item === "string") {
          pushSource(sources, item, undefined, fetchedAt, 0.75);
          continue;
        }
        if (!item || typeof item !== "object") continue;
        const candidate = item as Record<string, unknown>;
        const url = typeof candidate.url === "string"
          ? candidate.url
          : typeof candidate.link === "string"
            ? candidate.link
            : null;
        if (!url) continue;
        const title = typeof candidate.title === "string"
          ? candidate.title
          : typeof candidate.name === "string"
            ? candidate.name
            : typeof candidate.source === "string"
              ? candidate.source
              : undefined;
        pushSource(sources, url, title, fetchedAt, 0.85);
      }
    }
  } catch {
    return [];
  }

  return [...sources.values()];
}

function extractMarkdownSources(
  report: string,
  fetchedAt: string,
): ResearchFindingSource[] {
  const sources = new Map<string, ResearchFindingSource>();

  for (const match of report.matchAll(/\[([^\]]{1,160})\]\((https?:\/\/[^)\s]+)\)/g)) {
    const url = match[2];
    if (!url) continue;
    pushSource(sources, url, match[1], fetchedAt, 0.75);
  }

  for (const match of report.matchAll(/\bhttps?:\/\/[^\s)<>"']+/g)) {
    pushSource(sources, match[0], undefined, fetchedAt, 0.65);
  }

  return [...sources.values()];
}

function extractEvidenceSources(
  evidence: Array<{ sourceUrl?: string; sourceLabel?: string; title?: string }>,
  report: string,
  structuredResult: string | undefined,
): ResearchFindingSource[] {
  const fetchedAt = new Date().toISOString();
  const sources = new Map<string, ResearchFindingSource>();

  for (const item of evidence) {
    if (item.sourceUrl) {
      pushSource(sources, item.sourceUrl, item.title ?? item.sourceLabel, fetchedAt, 0.85);
      continue;
    }
    if (item.sourceLabel?.startsWith("http")) {
      pushSource(sources, item.sourceLabel, item.title, fetchedAt, 0.8);
    }
  }

  for (const source of extractStructuredSources(structuredResult, fetchedAt)) {
    pushSource(sources, source.url, source.title, source.fetchedAt, source.relevance);
  }
  for (const source of extractMarkdownSources(report, fetchedAt)) {
    pushSource(sources, source.url, source.title, source.fetchedAt, source.relevance);
  }

  return [...sources.values()].slice(0, 8);
}

function extractStructuredConfidence(structuredResult: string | undefined): number | undefined {
  if (!structuredResult) return undefined;
  try {
    const parsed = JSON.parse(structuredResult) as Record<string, unknown>;
    const raw = typeof parsed.confidence === "number" ? parsed.confidence : null;
    if (raw == null || Number.isNaN(raw)) return undefined;
    return clampConfidence(raw > 1 ? raw / 100 : raw);
  } catch {
    return undefined;
  }
}

function confidenceFromLabel(label: "low" | "medium" | "high" | undefined): number {
  switch (label) {
    case "high":
      return 0.8;
    case "medium":
      return 0.65;
    case "low":
      return 0.45;
    default:
      return 0.55;
  }
}

function calculateResearchConfidence(input: {
  summary: string;
  sources: ResearchFindingSource[];
  searchesUsed: number;
  pagesLearned: number;
  budgetMaxSearches: number;
  budgetMaxPages: number;
  structuredResult: string | undefined;
  recommendationConfidence: "low" | "medium" | "high" | undefined;
  previousFinding?: ResearchFinding;
}): number {
  const sourceSummary = summarizeResearchSources(input.sources);
  const distinctSources = sourceSummary.distinctUrls;
  const searchRatio = input.budgetMaxSearches > 0 ? Math.min(1, input.searchesUsed / input.budgetMaxSearches) : 0;
  const pageRatio = input.budgetMaxPages > 0 ? Math.min(1, input.pagesLearned / input.budgetMaxPages) : 0;
  const toolCoverage = searchRatio * 0.55 + pageRatio * 0.45;
  const structuredConfidence = extractStructuredConfidence(input.structuredResult)
    ?? confidenceFromLabel(input.recommendationConfidence);
  const novelty = calculateNoveltySignals(input.previousFinding, input.summary, input.sources);
  const diversityScore = sourceSummary.distinctDomains >= 4
    ? 0.95
    : sourceSummary.distinctDomains === 3
      ? 0.85
      : sourceSummary.distinctDomains === 2
        ? 0.72
        : sourceSummary.distinctDomains === 1
          ? 0.55
          : 0.2;
  const authoritativeCoverage = sourceSummary.totalSources > 0
    ? sourceSummary.authoritativeSources / sourceSummary.totalSources
    : 0;
  const sourceScore = Math.min(
    0.98,
    diversityScore * 0.35
      + sourceSummary.averageAuthority * 0.55
      + authoritativeCoverage * 0.1
      + (sourceSummary.primarySources > 0 ? 0.05 : 0),
  );
  const summaryScore = input.summary.length >= 140 ? 0.75 : input.summary.length >= 80 ? 0.6 : 0.45;
  const blended = 0.08
    + sourceScore * 0.37
    + toolCoverage * 0.22
    + structuredConfidence * 0.13
    + novelty.noveltyScore * 0.2
    + summaryScore * 0.05;

  let cap = sourceSummary.distinctDomains >= 4
    ? 0.95
    : sourceSummary.distinctDomains === 3
      ? 0.9
      : sourceSummary.distinctDomains === 2
        ? 0.78
        : sourceSummary.distinctDomains === 1
          ? 0.62
          : 0.45;

  if (input.searchesUsed === 0 && input.pagesLearned === 0) cap = Math.min(cap, 0.4);
  if (input.summary.length < 60) cap = Math.min(cap, 0.55);
  if (sourceSummary.authoritativeSources === 0) cap = Math.min(cap, 0.58);
  if (sourceSummary.lowQualitySources > 0 && sourceSummary.lowQualitySources >= sourceSummary.totalSources / 2 && sourceSummary.authoritativeSources === 0) {
    cap = Math.min(cap, 0.5);
  }
  if (sourceSummary.primarySources === 0 && sourceSummary.averageAuthority < 0.75 && sourceSummary.distinctDomains <= 2) {
    cap = Math.min(cap, 0.68);
  }
  if (input.previousFinding) {
    if (novelty.noveltyScore < 0.12) cap = Math.min(cap, 0.48);
    else if (novelty.noveltyScore < 0.25) cap = Math.min(cap, 0.58);
    else if (novelty.noveltyScore < 0.4) cap = Math.min(cap, 0.68);
    if (distinctSources === 0 && novelty.deltaSignificance < 0.15) cap = Math.min(cap, 0.42);
    if (novelty.sourceNovelty === 0 && novelty.deltaSignificance < 0.1) cap = Math.min(cap, 0.45);
  }

  return clampConfidence(Math.min(blended, cap));
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

  const startedAt = new Date().toISOString();
  const nextAttempt = (job.attemptCount ?? 0) + 1;

  // Register in shared tracker (DB-backed)
  const tracked: BackgroundJob = {
    id: jobId,
    type: "research",
    label: job.goal.slice(0, 100),
    status: "running",
    progress: "starting",
    startedAt,
    queuedAt: job.queuedAt,
    attemptCount: nextAttempt,
    lastAttemptAt: startedAt,
    sourceKind: job.sourceKind,
    sourceScheduleId: job.sourceScheduleId,
  };
  upsertJob(ctx.storage, tracked);

  // Set status to running
  updateResearchJob(ctx.storage, jobId, {
    status: "running",
    started_at: startedAt,
    last_attempt_at: startedAt,
    attempt_count: nextAttempt,
    completed_at: null,
    report: null,
    briefing_id: null,
  });

  try {
    const tools = createResearchTools(ctx, jobId, job);

    // Select domain-specific system prompt
    const systemPrompt = getPromptForResultType(job.resultType, ctx.timezone);

    const budget = getContextBudget(ctx.provider ?? "ollama", ctx.model ?? "", ctx.contextWindow);

    // Wrap research execution with agent harness for plan/reflect tracking
    let rawReport = "";
    const harnessResult = await runAgentHarness({
      goal: job.goal,
      context: [],
      budget: {
        maxTokens: 50000,
        maxToolCalls: (job.budgetMaxSearches || 5) + (job.budgetMaxPages || 8),
        maxDurationMs: 300000,
      },
      depth: "standard",
      execute: async (harnessCtx) => {
        const { result } = await instrumentedGenerateText(
          { storage: ctx.storage, logger: ctx.logger },
          {
            model: ctx.llm.getModel() as LanguageModel,
            system: systemPrompt,
            messages: [
              { role: "user", content: `Research this topic thoroughly: ${job.goal}` },
            ],
            tools,
            toolChoice: "auto",
            stopWhen: stepCountIs(15),
            maxRetries: 1,
            timeout: RESEARCH_LLM_TIMEOUT,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            providerOptions: getProviderOptions(ctx.provider ?? "ollama", budget.contextWindow) as any,
          },
          {
            spanType: "llm",
            process: "research.run",
            surface: "worker",
            threadId: job.threadId,
            jobId,
            provider: ctx.provider ?? "ollama",
            model: ctx.model ?? "",
            requestSizeChars: job.goal.length,
          },
        );

        // Track tool calls used via harness context
        const toolCallCount = result.steps.reduce(
          (sum, s) => sum + (s.toolCalls?.length ?? 0),
          0,
        );
        harnessCtx.toolCallsUsed = toolCallCount;

        let reportText = result.text;

        // If the LLM exhausted all steps on tool calls without producing a report,
        // do a follow-up call to synthesize findings from the tool results.
        if (!reportText) {
          ctx.logger.warn(`Research job ${jobId}: no report text, running synthesis pass`);
          const toolResults = result.steps
            .flatMap((s) => s.toolResults ?? [])
            .map((r) => String((r as Record<string, unknown>).result ?? ""))
            .filter((r) => r.length > 10)
            .join("\n\n---\n\n")
            .slice(0, 30_000);

          {
            const { result: synthResult } = await instrumentedGenerateText(
              { storage: ctx.storage, logger: ctx.logger },
              {
                model: ctx.llm.getModel() as LanguageModel,
                system: systemPrompt,
                messages: toolResults
                  ? [
                    { role: "user", content: `Research this topic thoroughly: ${job.goal}` },
                    { role: "assistant", content: `I've gathered the following research data:\n\n${toolResults}` },
                    { role: "user", content: "Now synthesize all findings into the structured markdown report." },
                  ]
                  : await (async () => {
                    // No tool results — use previous findings from Library as context
                    let previousContext = "";
                    try {
                      const { listFindingsForWatch } = await import("@personal-ai/library");
                      const { knowledgeSearch } = await import("@personal-ai/core");
                      if (job.sourceScheduleId) {
                        const prev = listFindingsForWatch(ctx.storage, job.sourceScheduleId);
                        if (prev.length > 0) {
                          previousContext = prev.slice(0, 3).map((f) => f.summary).join("\n\n");
                        }
                      }
                      if (!previousContext) {
                        const goalClean = job.goal.split("\n")[0]?.slice(0, 150) ?? job.goal;
                        const kResults = await knowledgeSearch(ctx.storage, ctx.llm, goalClean, 3);
                        if (kResults.length > 0) {
                          previousContext = kResults.map((r) => r.chunk.content.slice(0, 500)).join("\n\n");
                        }
                      }
                    } catch { /* no previous data available */ }

                    const context = previousContext
                      ? `\n\nPREVIOUS FINDINGS (use as basis — update with any new information you know):\n${previousContext}`
                      : "";
                    return [
                      { role: "user" as const, content: `Write a research report on: ${job.goal}${context}\n\nNote: web search was unavailable this time. Summarize what is known from previous research and note that fresh data could not be fetched.` },
                    ];
                  })(),
                maxRetries: 1,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                providerOptions: getProviderOptions(ctx.provider ?? "ollama", budget.contextWindow) as any,
              },
              {
                spanType: "llm",
                process: "research.synthesize",
                surface: "worker",
                threadId: job.threadId,
                jobId,
                provider: ctx.provider ?? "ollama",
                model: ctx.model ?? "",
                requestSizeChars: toolResults.length,
              },
            );
            reportText = synthResult.text || "";
          }
        }

        if (!reportText) reportText = "Research completed but no report was generated.";

        // Capture full report via closure for use after harness completes
        rawReport = reportText;

        return {
          findings: [{
            goal: job.goal,
            summary: reportText.slice(0, 500),
            confidence: 0.7,
            sources: [],
          }],
          rawOutput: reportText,
        };
      },
    });

    // Log agent harness reflection in steps_log
    {
      const updatedJob = getResearchJob(ctx.storage, jobId);
      const currentSteps: string[] = updatedJob?.stepsLog ?? [];
      currentSteps.push(`Agent harness: confidence=${harnessResult.reflection.confidence}, ${harnessResult.reflection.completeness}`);
      currentSteps.push(`Agent harness: plan=[${harnessResult.plan.join("; ")}]`);
      currentSteps.push(`Agent harness: toolCalls=${harnessResult.usage.toolCallsUsed}, duration=${harnessResult.usage.durationMs}ms`);
      if (harnessResult.reflection.suggestSecondPass) {
        currentSteps.push("Agent harness: suggests deeper research on next run");
      }
      updateResearchJob(ctx.storage, jobId, { steps_log: JSON.stringify(currentSteps) });
    }
    let { report, structuredResult, renderSpec } = extractPresentationBlocks(rawReport);

    // Generate charts for stock research via sandbox (if available)
    if (job.resultType === "stock" && structuredResult) {
      try {
        const { resolveSandboxUrl, runInSandbox, storeArtifact, guessMimeType } = await import("@personal-ai/core");
        const sandboxUrl = resolveSandboxUrl(ctx.sandboxUrl);
        if (sandboxUrl) {
          const stockData = JSON.parse(structuredResult);
          const ticker = stockData.ticker ?? "STOCK";
          const chartCode = generateStockChartCode(ticker, stockData.metrics);

          const chartResult = await runInSandbox({
            language: "python",
            code: chartCode,
            timeout: 60,
          }, ctx.logger, ctx.sandboxUrl);

          if (chartResult.files.length > 0) {
            const charts: Array<{ id: string; type: string; title: string; artifactId: string }> = [];
            for (const file of chartResult.files) {
              const mimeType = guessMimeType(file.name);
              const artifactId = storeArtifact(ctx.storage, ctx.dataDir ?? "", {
                jobId: jobId,
                name: file.name,
                mimeType,
                data: Buffer.from(file.data, "base64"),
              });
              const chartType = file.name.includes("comparison") ? "comparison" : file.name.includes("volume") ? "volume" : "price";
              charts.push({
                id: artifactId,
                type: chartType,
                title: `${ticker} ${chartType} chart`,
                artifactId,
              });
            }

            // Inject charts into the structured result
            stockData.charts = charts;
            structuredResult = JSON.stringify(stockData);
          }

          ctx.logger.info("Generated stock charts via sandbox", { jobId, chartCount: chartResult.files.length });
        }
      } catch (err) {
        ctx.logger.warn(`Failed to generate stock charts: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const visuals = deriveReportVisuals(ctx.storage, jobId);
    const presentation = buildReportPresentation({
      report,
      ...(structuredResult ? { structuredResult } : {}),
      ...(renderSpec ? { renderSpec } : {}),
      visuals,
      resultType: job.resultType,
      execution: "research",
    });

    // Store report and mark done
    updateResearchJob(ctx.storage, jobId, {
      status: "done",
      report: presentation.report,
      completed_at: new Date().toISOString(),
    });

    updateJobStatus(ctx.storage, jobId, {
      status: "done",
      progress: "complete",
      result: presentation.report.slice(0, 200),
      resultType: job.resultType,
      ...(structuredResult ? { structuredResult } : {}),
      queuedAt: job.queuedAt,
      startedAt,
      attemptCount: nextAttempt,
      lastAttemptAt: startedAt,
      sourceKind: job.sourceKind,
      sourceScheduleId: job.sourceScheduleId,
    });

    const program = job.sourceScheduleId ? getProgramById(ctx.storage, job.sourceScheduleId) : null;
    const actionSummary = getProgramActionSummary(ctx.storage, job.sourceScheduleId);
    const briefSection = buildReportBriefSection({
      goal: job.goal,
      execution: "research",
      resultType: presentation.resultType,
      report: presentation.report,
      structuredResult: presentation.structuredResult,
      renderSpec: presentation.renderSpec,
      visuals: presentation.visuals,
      program: program
        ? {
          title: program.title,
          question: program.question,
          objective: program.objective,
          preferences: program.preferences,
          constraints: program.constraints,
        }
        : null,
      actionSummary,
    });
    const signalHash = buildBriefSignalHash(briefSection, {
      programId: job.sourceScheduleId,
      actionSummary,
      resultType: presentation.resultType,
      execution: "research",
    });

    const shouldDeliver = !program
      || program.deliveryMode !== "change-gated"
      || !program.lastSignalHash
      || program.lastSignalHash !== signalHash
      || !program.latestBriefId;

    const briefingId = shouldDeliver ? `research-${jobId}` : null;
    try {
      if (briefingId) {
        ctx.storage.run(
          `INSERT INTO briefings (
            id, generated_at, sections, raw_context, status, type, program_id, thread_id, source_job_id, source_job_kind, signal_hash
          ) VALUES (?, datetime('now'), ?, null, 'ready', 'research', ?, ?, ?, 'research', ?)`,
          [briefingId, JSON.stringify(briefSection), job.sourceScheduleId ?? null, job.threadId, jobId, signalHash],
        );
        updateResearchJob(ctx.storage, jobId, { briefing_id: briefingId });
      }
      // Ingest findings into Library so future runs can build on them
      try {
        // Extract clean summary — handle JSON objects, strip LLM preamble
        let summary = "";
        const rec = briefSection.recommendation;
        if (rec) {
          // recommendation.summary might be a string or the recommendation itself might be a JSON string
          const rawSummary = typeof rec === "string" ? rec : typeof rec.summary === "string" ? rec.summary : "";
          // If it looks like JSON, try to extract the summary field from it
          if (rawSummary.trim().startsWith("{")) {
            try {
              const parsed = JSON.parse(rawSummary) as Record<string, unknown>;
              summary = (parsed.summary as string) || (parsed.topic as string) || rawSummary.slice(0, 500);
            } catch {
              summary = rawSummary;
            }
          } else {
            summary = rawSummary;
          }
        }
        if (!summary || summary.length < 20) {
          // Fall back to first substantive line of the report
          const lines = presentation.report.split("\n").filter((l: string) => l.trim().length > 20 && !l.startsWith("#"));
          summary = lines[0]?.trim() || presentation.report.slice(0, 500);
        }
        // Truncate to reasonable length
        if (summary.length > 500) summary = summary.slice(0, 500);

        const completedJob = getResearchJob(ctx.storage, jobId) ?? job;
        const evidenceSources = extractEvidenceSources(
          briefSection.evidence ?? [],
          presentation.report,
          presentation.structuredResult,
        );
        let previousFinding: ResearchFinding | undefined;
        let previousFindingId: string | undefined;
        if (job.sourceScheduleId) {
          const { listFindingsForWatch } = await import("@personal-ai/library");
          const prev = listFindingsForWatch(ctx.storage, job.sourceScheduleId);
          previousFinding = prev[0];
          previousFindingId = previousFinding?.id;
        }
        const novelty = calculateNoveltySignals(previousFinding, summary, evidenceSources);
        const researchConfidence = calculateResearchConfidence({
          summary,
          sources: evidenceSources,
          searchesUsed: completedJob.searchesUsed || 0,
          pagesLearned: completedJob.pagesLearned || 0,
          budgetMaxSearches: completedJob.budgetMaxSearches || 0,
          budgetMaxPages: completedJob.budgetMaxPages || 0,
          structuredResult: presentation.structuredResult,
          recommendationConfidence: briefSection.recommendation?.confidence,
          previousFinding,
        });

        // Determine actual depth from budget
        const actualDepth = (job.budgetMaxSearches || 5) <= 2 ? "quick"
          : (job.budgetMaxSearches || 5) >= 10 ? "deep"
          : "standard";

        ingestResearchResult(ctx.storage, {
          goal: stripEnrichmentFromGoal(job.goal),
          domain: job.resultType || "general",
          summary,
          confidence: researchConfidence,
          agentName: "Researcher",
          depthLevel: actualDepth,
          sources: evidenceSources,
          watchId: job.sourceScheduleId ?? undefined,
          digestId: briefingId ?? undefined,
          previousFindingId,
          delta: novelty.delta,
        });

        const updatedJob = getResearchJob(ctx.storage, jobId);
        const currentSteps: string[] = updatedJob?.stepsLog ?? [];
        currentSteps.push(
          `Evidence calibration: sources=${evidenceSources.length}, searches=${completedJob.searchesUsed}/${completedJob.budgetMaxSearches}, pages=${completedJob.pagesLearned}/${completedJob.budgetMaxPages}, novelty=${novelty.noveltyScore.toFixed(2)}, delta=${novelty.deltaSignificance.toFixed(2)}, confidence=${researchConfidence.toFixed(2)}`,
        );
        updateResearchJob(ctx.storage, jobId, { steps_log: JSON.stringify(currentSteps) });
      } catch (ingestErr) {
        ctx.logger.warn(`Failed to ingest research finding: ${ingestErr instanceof Error ? ingestErr.message : String(ingestErr)}`);
      }

      if (job.sourceScheduleId) {

        recordProgramEvaluation(ctx.storage, job.sourceScheduleId, {
          latestBriefId: briefingId ?? undefined,
          lastDeliveredAt: briefingId ? new Date().toISOString() : undefined,
          lastEvaluatedAt: new Date().toISOString(),
          lastSignalHash: signalHash,
        });
      }
    } catch (err) {
      ctx.logger.warn(`Failed to create research briefing: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Learn the report into the knowledge base so future research builds on it.
    try {
      // Cap research knowledge entries — keep only 10 most recent
      const existingResearchSources = ctx.storage.query<{ id: string }>(
        "SELECT id FROM knowledge_sources WHERE url LIKE '/inbox/%' ORDER BY fetched_at DESC",
      );
      if (existingResearchSources.length > 9) {
        const { forgetSource } = await import("@personal-ai/core");
        for (const old of existingResearchSources.slice(9)) {
          forgetSource(ctx.storage, old.id);
        }
      }

      const reportUrl = `/inbox/${briefingId}`;
      const reportTitle = `Research Report: ${job.goal.slice(0, 100)}`;
      await learnFromContent(ctx.storage, ctx.llm, reportUrl, reportTitle, presentation.report, {
        force: true,
        maxAgeDays: 7,
      });
      ctx.logger.info(`Stored research report in knowledge base`, { jobId, goal: job.goal });
    } catch (err) {
      ctx.logger.warn(`Failed to store research report in knowledge: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Append summary to originating chat thread
    if (job.threadId && briefingId) {
      try {
        const summary = presentation.report.length > 500
          ? presentation.report.slice(0, 500) + "\n\n*Full report available in your Inbox.*"
          : presentation.report;
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
    updateResearchJob(ctx.storage, jobId, {
      status: "failed",
      completed_at: new Date().toISOString(),
    });

    updateJobStatus(ctx.storage, jobId, {
      status: "error",
      error: errorMsg,
      queuedAt: job.queuedAt,
      startedAt,
      attemptCount: nextAttempt,
      lastAttemptAt: startedAt,
      sourceKind: job.sourceKind,
      sourceScheduleId: job.sourceScheduleId,
    });

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

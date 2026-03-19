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
import { ingestResearchResult } from "@personal-ai/library";

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

          if (toolResults) {
            const { result: synthResult } = await instrumentedGenerateText(
              { storage: ctx.storage, logger: ctx.logger },
              {
                model: ctx.llm.getModel() as LanguageModel,
                system: systemPrompt,
                messages: [
                  { role: "user", content: `Research this topic thoroughly: ${job.goal}` },
                  { role: "assistant", content: `I've gathered the following research data:\n\n${toolResults}` },
                  { role: "user", content: "Now synthesize all findings into the structured markdown report." },
                ],
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
        // Extract actual sources from the brief's evidence section
        // Extract sources from evidence — try sourceUrl first, fall back to sourceLabel if it looks like a URL
        const evidenceSources = (briefSection.evidence || [])
          .filter((e: { sourceUrl?: string; sourceLabel?: string }) => e.sourceUrl || (e.sourceLabel && e.sourceLabel.startsWith("http")))
          .map((e: { sourceUrl?: string; title?: string; sourceLabel?: string }) => ({
            url: e.sourceUrl || e.sourceLabel || "",
            title: e.title || e.sourceLabel || "Source",
            fetchedAt: new Date().toISOString(),
            relevance: 0.8,
          }))
          .filter((s: { url: string }) => s.url.length > 0);

        // Derive confidence from research completeness
        const budgetUsed = (job.searchesUsed || 0) + (job.pagesLearned || 0);
        const budgetTotal = (job.budgetMaxSearches || 5) + (job.budgetMaxPages || 8);
        const researchConfidence = budgetTotal > 0
          ? Math.min(0.95, 0.5 + 0.45 * (budgetUsed / budgetTotal))
          : 0.6;

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

        // Determine actual depth from budget
        const actualDepth = (job.budgetMaxSearches || 5) <= 2 ? "quick"
          : (job.budgetMaxSearches || 5) >= 10 ? "deep"
          : "standard";

        // Find previous finding for this watch to link delta chain
        let previousFindingId: string | undefined;
        if (job.sourceScheduleId) {
          const { listFindingsForWatch } = await import("@personal-ai/library");
          const prev = listFindingsForWatch(ctx.storage, job.sourceScheduleId);
          if (prev.length > 0 && prev[0]) previousFindingId = prev[0].id;
        }

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
        });
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

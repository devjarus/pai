import type { FastifyInstance } from "fastify";
import type { ServerContext } from "../index.js";
import {
  listJobs,
  getJob,
  cancelBackgroundJob,
  forceDeleteBackgroundJob,
  clearCompletedBackgroundJobs,
  buildReportPresentation,
  deriveReportVisuals,
  extractPresentationBlocks,
} from "@personal-ai/core";
import { listResearchJobs, getResearchJob, cancelResearchJob, clearCompletedJobs } from "@personal-ai/plugin-research";
import { listSwarmJobs, getSwarmJob, getSwarmAgents, getBlackboardEntries, cancelSwarmJob, clearCompletedSwarmJobs } from "@personal-ai/plugin-swarm";
import { getBriefingById } from "../briefing.js";

function getStoredPresentation(
  serverCtx: ServerContext,
  jobId: string,
  briefingId: string | null,
  reportText: string | null | undefined,
  resultType: string | null | undefined,
  execution: "research" | "analysis",
) {
  const fallbackVisuals = deriveReportVisuals(serverCtx.ctx.storage, jobId);

  if (briefingId) {
    const briefing = getBriefingById(serverCtx.ctx.storage, briefingId);
    const sections = briefing?.sections as Record<string, unknown> | undefined;
    if (sections && typeof sections === "object") {
      const extracted = extractPresentationBlocks(
        typeof sections.report === "string" ? sections.report : reportText ?? "",
      );
      const storedVisuals: NonNullable<Parameters<typeof buildReportPresentation>[0]["visuals"]> = Array.isArray(sections.visuals)
        ? sections.visuals as NonNullable<Parameters<typeof buildReportPresentation>[0]["visuals"]>
        : [];
      const visuals = storedVisuals.length > 0 ? storedVisuals : fallbackVisuals;
      return buildReportPresentation({
        report: extracted.report,
        structuredResult: typeof sections.structuredResult === "string"
          ? sections.structuredResult
          : extracted.structuredResult,
        renderSpec: typeof sections.renderSpec === "string"
          ? sections.renderSpec
          : extracted.renderSpec,
        visuals,
        resultType: typeof sections.resultType === "string" ? sections.resultType : (resultType ?? "general"),
        execution: sections.execution === "analysis" ? "analysis" : execution,
      });
    }
  }

  const extracted = extractPresentationBlocks(reportText ?? "");
  return buildReportPresentation({
    report: extracted.report || reportText || "",
    structuredResult: extracted.structuredResult,
    renderSpec: extracted.renderSpec,
    visuals: fallbackVisuals,
    resultType: resultType ?? "general",
    execution,
  });
}

export function registerJobRoutes(app: FastifyInstance, serverCtx: ServerContext): void {
  const { backgroundDispatcher } = serverCtx;

  function queueState(id: string, status: string) {
    return status === "pending"
      ? backgroundDispatcher.getJobQueueMetadata(id)
      : { queuePosition: null, waitingReason: null };
  }

  // List all background jobs — DB-backed active + persisted research jobs
  app.get("/api/jobs", async () => {
    // Background jobs from DB (crawl + research status/progress)
    const active = listJobs(serverCtx.ctx.storage).map((j) => ({
      id: j.id,
      type: j.type,
      label: j.label,
      status: j.status,
      progress: j.progress,
      startedAt: j.startedAt,
      queuedAt: j.queuedAt ?? j.startedAt,
      attemptCount: j.attemptCount ?? 0,
      lastAttemptAt: j.lastAttemptAt ?? null,
      sourceKind: j.sourceKind ?? "manual",
      sourceScheduleId: j.sourceScheduleId ?? null,
      ...queueState(j.id, j.status),
      error: j.error ?? null,
      result: j.result ?? null,
      resultType: j.resultType ?? null,
    }));

    // Persisted research jobs from DB (with extra detail fields)
    const research = listResearchJobs(serverCtx.ctx.storage).map((j) => {
      const tracked = getJob(serverCtx.ctx.storage, j.id);
      return {
        id: j.id,
        type: "research" as const,
        label: j.goal,
        status: j.status,
        progress: tracked?.progress ?? `${j.searchesUsed}/${j.budgetMaxSearches} searches, ${j.pagesLearned}/${j.budgetMaxPages} pages`,
        startedAt: j.startedAt ?? j.createdAt,
        queuedAt: j.queuedAt,
        completedAt: j.completedAt,
        attemptCount: j.attemptCount,
        lastAttemptAt: j.lastAttemptAt,
        sourceKind: j.sourceKind,
        sourceScheduleId: j.sourceScheduleId,
        ...queueState(j.id, j.status),
        error: tracked?.error ?? null,
        result: j.report ? j.report.slice(0, 1000) : tracked?.result ?? null,
        resultType: j.resultType ?? null,
      };
    });

    // Persisted swarm jobs from DB
    const swarm = listSwarmJobs(serverCtx.ctx.storage).map((j) => {
      const tracked = getJob(serverCtx.ctx.storage, j.id);
      return {
        id: j.id,
        type: "swarm" as const,
        label: j.goal,
        status: j.status,
        progress: tracked?.progress ?? `${j.agentsDone}/${j.agentCount} agents`,
        startedAt: j.startedAt ?? j.createdAt,
        queuedAt: j.queuedAt,
        completedAt: j.completedAt,
        attemptCount: j.attemptCount,
        lastAttemptAt: j.lastAttemptAt,
        sourceKind: j.sourceKind,
        sourceScheduleId: j.sourceScheduleId,
        ...queueState(j.id, j.status),
        error: tracked?.error ?? null,
        result: j.synthesis ? j.synthesis.slice(0, 1000) : tracked?.result ?? null,
        resultType: j.resultType ?? null,
      };
    });

    // Merge: active jobs first, then persisted (dedup by id)
    const activeIds = new Set(active.map((j) => j.id));
    const combined = [
      ...active,
      ...research.filter((j) => !activeIds.has(j.id)),
      ...swarm.filter((j) => !activeIds.has(j.id)),
    ];

    return { jobs: combined };
  });

  // Get a single research or swarm job with full report
  app.get<{ Params: { id: string } }>("/api/jobs/:id", async (request, reply) => {
    const researchJob = getResearchJob(serverCtx.ctx.storage, request.params.id);
    if (researchJob) {
      return {
        job: {
          ...researchJob,
          ...queueState(researchJob.id, researchJob.status),
        },
        presentation: getStoredPresentation(
          serverCtx,
          researchJob.id,
          researchJob.briefingId,
          researchJob.report,
          researchJob.resultType,
          "research",
        ),
      };
    }

    const swarmJob = getSwarmJob(serverCtx.ctx.storage, request.params.id);
    if (swarmJob) {
      return {
        job: {
          ...swarmJob,
          ...queueState(swarmJob.id, swarmJob.status),
        },
        presentation: getStoredPresentation(
          serverCtx,
          swarmJob.id,
          swarmJob.briefingId,
          swarmJob.synthesis,
          swarmJob.resultType,
          "analysis",
        ),
      };
    }

    return reply.status(404).send({ error: "Job not found" });
  });

  // Get sub-agents for a swarm job
  app.get<{ Params: { id: string } }>("/api/jobs/:id/agents", async (request, reply) => {
    const job = getSwarmJob(serverCtx.ctx.storage, request.params.id);
    if (!job) return reply.status(404).send({ error: "Swarm job not found" });
    const agents = getSwarmAgents(serverCtx.ctx.storage, request.params.id);
    return { agents };
  });

  // Get blackboard entries for a swarm job
  app.get<{ Params: { id: string } }>("/api/jobs/:id/blackboard", async (request, reply) => {
    const job = getSwarmJob(serverCtx.ctx.storage, request.params.id);
    if (!job) return reply.status(404).send({ error: "Swarm job not found" });
    const entries = getBlackboardEntries(serverCtx.ctx.storage, request.params.id);
    return { entries };
  });

  // Cancel a running/stuck job
  app.post<{ Params: { id: string } }>("/api/jobs/:id/cancel", async (request, reply) => {
    const { id } = request.params;

    // Try cancelling in each table
    const researchCancelled = cancelResearchJob(serverCtx.ctx.storage, id);
    const swarmCancelled = cancelSwarmJob(serverCtx.ctx.storage, id);

    // Also mark the background_jobs tracker as cancelled
    cancelBackgroundJob(serverCtx.ctx.storage, id);

    if (researchCancelled || swarmCancelled) {
      return { ok: true, cancelled: true };
    }

    // If not found as active research/swarm, try force-deleting from background_jobs
    const bgDeleted = forceDeleteBackgroundJob(serverCtx.ctx.storage, id);
    if (bgDeleted) {
      return { ok: true, cancelled: true };
    }

    return reply.status(404).send({ error: "Job not found or not cancellable" });
  });

  // Clear completed/failed jobs from all tables
  app.post("/api/jobs/clear", async () => {
    const bgCleared = clearCompletedBackgroundJobs(serverCtx.ctx.storage);
    const dbCleared = clearCompletedJobs(serverCtx.ctx.storage);
    const swarmCleared = clearCompletedSwarmJobs(serverCtx.ctx.storage);
    return { ok: true, cleared: bgCleared + dbCleared + swarmCleared };
  });
}

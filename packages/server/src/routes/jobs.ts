import type { FastifyInstance } from "fastify";
import type { ServerContext } from "../index.js";
import { listJobs, cancelBackgroundJob, forceDeleteBackgroundJob, clearCompletedBackgroundJobs } from "@personal-ai/core";
import { listResearchJobs, getResearchJob, cancelResearchJob, clearCompletedJobs } from "@personal-ai/plugin-research";
import { listSwarmJobs, getSwarmJob, getSwarmAgents, getBlackboardEntries, cancelSwarmJob, clearCompletedSwarmJobs } from "@personal-ai/plugin-swarm";

export function registerJobRoutes(app: FastifyInstance, serverCtx: ServerContext): void {
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
      error: j.error ?? null,
      result: j.result ?? null,
      resultType: j.resultType ?? null,
    }));

    // Persisted research jobs from DB (with extra detail fields)
    const research = listResearchJobs(serverCtx.ctx.storage).map((j) => ({
      id: j.id,
      type: "research" as const,
      label: j.goal,
      status: j.status,
      progress: `${j.searchesUsed}/${j.budgetMaxSearches} searches, ${j.pagesLearned}/${j.budgetMaxPages} pages`,
      startedAt: j.createdAt,
      completedAt: j.completedAt,
      error: null,
      result: j.report ? j.report.slice(0, 300) : null,
      resultType: j.resultType ?? null,
    }));

    // Persisted swarm jobs from DB
    const swarm = listSwarmJobs(serverCtx.ctx.storage).map((j) => ({
      id: j.id,
      type: "swarm" as const,
      label: j.goal,
      status: j.status,
      progress: `${j.agentsDone}/${j.agentCount} agents`,
      startedAt: j.createdAt,
      completedAt: j.completedAt,
      error: null,
      result: j.synthesis ? j.synthesis.slice(0, 300) : null,
      resultType: j.resultType ?? null,
    }));

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
    if (researchJob) return { job: researchJob };

    const swarmJob = getSwarmJob(serverCtx.ctx.storage, request.params.id);
    if (swarmJob) return { job: swarmJob };

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

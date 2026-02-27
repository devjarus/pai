import type { FastifyInstance } from "fastify";
import type { ServerContext } from "../index.js";
import { activeJobs } from "@personal-ai/core";
import { listResearchJobs, getResearchJob, clearCompletedJobs } from "@personal-ai/plugin-research";

export function registerJobRoutes(app: FastifyInstance, serverCtx: ServerContext): void {
  // List all background jobs — in-memory active + persisted research jobs
  app.get("/api/jobs", async () => {
    // In-memory active jobs (crawl + research currently running/recent)
    const active = [...activeJobs.values()].map((j) => ({
      id: j.id,
      type: j.type,
      label: j.label,
      status: j.status,
      progress: j.progress,
      startedAt: j.startedAt,
      error: j.error ?? null,
      result: j.result ?? null,
    }));

    // Persisted research jobs from DB
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
    }));

    // Merge: active jobs first, then persisted (dedup by id)
    const activeIds = new Set(active.map((j) => j.id));
    const combined = [...active, ...research.filter((j) => !activeIds.has(j.id))];

    return { jobs: combined };
  });

  // Get a single research job with full report
  app.get<{ Params: { id: string } }>("/api/jobs/:id", async (request, reply) => {
    const job = getResearchJob(serverCtx.ctx.storage, request.params.id);
    if (!job) return reply.status(404).send({ error: "Job not found" });
    return { job };
  });

  // Clear completed/failed jobs from DB + in-memory tracker
  app.post("/api/jobs/clear", async () => {
    const dbCleared = clearCompletedJobs(serverCtx.ctx.storage);
    // Also clear completed/errored from in-memory tracker
    let memCleared = 0;
    for (const [id, job] of activeJobs) {
      if (job.status === "done" || job.status === "error") {
        activeJobs.delete(id);
        memCleared++;
      }
    }
    return { ok: true, cleared: dbCleared + memCleared };
  });
}

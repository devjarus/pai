import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  recordProductEvent,
} from "@personal-ai/core";
import {
  listWatches,
  getWatch,
  ensureWatch,
  updateWatch,
  deleteWatch,
  pauseWatch,
  resumeWatch,
  listTemplates,
  applyTemplate,
  resolveDepthForWatch,
  type Watch,
} from "@personal-ai/watches";
import { listTasks } from "@personal-ai/plugin-tasks";

import type { ServerContext } from "../index.js";
import { validate } from "../validate.js";

const createWatchSchema = z.object({
  title: z.string().min(1, "title is required").max(200),
  question: z.string().min(1, "question is required").max(4000),
  family: z.enum(["general", "work", "travel", "buying"]).optional(),
  executionMode: z.enum(["research", "analysis"]).optional(),
  intervalHours: z.number().int().positive().max(720).optional(),
  startAt: z.string().max(30).optional(),
  chatId: z.number().int().nullable().optional(),
  threadId: z.string().min(1).max(255).nullable().optional(),
  preferences: z.array(z.string().min(1).max(500)).max(10).optional(),
  constraints: z.array(z.string().min(1).max(500)).max(10).optional(),
  openQuestions: z.array(z.string().min(1).max(500)).max(10).optional(),
  objective: z.string().max(500).nullable().optional(),
  phase: z.enum(["monitor", "explore", "decide", "act", "prepare"]).optional(),
  deliveryMode: z.enum(["interval", "change-gated"]).optional(),
  sourceRefs: z.array(z.string().min(1).max(500)).max(20).optional(),
});

const updateWatchSchema = createWatchSchema.partial();

const patchWatchStatusSchema = z.object({
  action: z.enum(["pause", "resume"]),
});

const createFromTemplateSchema = z.object({
  templateId: z.string().min(1, "templateId is required").max(100),
  subject: z.string().min(1, "subject is required").max(500),
});

interface WatchBriefSummaryRow {
  id: string;
  generated_at: string;
  type: string;
  sections: string;
  source_job_id: string | null;
  source_job_kind: string | null;
}

function parseRecommendationSummary(sectionsRaw: string): string | null {
  try {
    const parsed = JSON.parse(sectionsRaw) as Record<string, unknown>;
    const recommendation = parsed.recommendation as Record<string, unknown> | undefined;
    if (recommendation && typeof recommendation.summary === "string" && recommendation.summary.trim().length > 0) {
      return recommendation.summary;
    }
    if (typeof parsed.goal === "string" && parsed.goal.trim().length > 0) {
      return parsed.goal;
    }
    if (typeof parsed.report === "string") {
      const firstMeaningfulLine = parsed.report
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0 && !line.startsWith("#") && !line.startsWith(">") && !line.startsWith("|"));
      return firstMeaningfulLine ?? null;
    }
  } catch {
    return null;
  }
  return null;
}

function buildWatchActionSummary(serverCtx: ServerContext, watchId: string) {
  const tasks = listTasks(serverCtx.ctx.storage, "all").filter(
    (task) => task.source_type === "program" && task.source_id === watchId,
  );
  const open = tasks.filter((task) => task.status === "open");
  const completed = tasks.filter((task) => task.status === "done");
  const staleOpen = open.filter((task) => {
    const createdAt = task.created_at ? Date.parse(task.created_at) : Number.NaN;
    const dueAt = task.due_date ? Date.parse(task.due_date) : Number.NaN;
    const referenceTs = Number.isFinite(dueAt) ? dueAt : createdAt;
    if (!Number.isFinite(referenceTs)) return false;
    return Date.now() - referenceTs > 3 * 24 * 60 * 60 * 1000;
  });
  return {
    openCount: open.length,
    completedCount: completed.length,
    staleOpenCount: staleOpen.length,
  };
}

function buildLatestBriefSummary(serverCtx: ServerContext, watch: Watch) {
  if (!watch.latestBriefId) return null;

  const rows = serverCtx.ctx.storage.query<WatchBriefSummaryRow>(
    "SELECT id, generated_at, type, sections, source_job_id, source_job_kind FROM briefings WHERE id = ?",
    [watch.latestBriefId],
  );
  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    generatedAt: row.generated_at,
    type: row.type,
    recommendationSummary: parseRecommendationSummary(row.sections),
    sourceJobId: row.source_job_id,
    sourceJobKind: row.source_job_kind,
  };
}

function enrichWatch(serverCtx: ServerContext, watch: Watch) {
  return {
    ...watch,
    actionSummary: buildWatchActionSummary(serverCtx, watch.id),
    latestBriefSummary: buildLatestBriefSummary(serverCtx, watch),
  };
}

export function registerWatchesRoutes(app: FastifyInstance, serverCtx: ServerContext): void {
  const { ctx, backgroundDispatcher } = serverCtx;

  // --- Templates (static, must be registered before :id routes) ---

  app.get("/api/watches/templates", async () => {
    return listTemplates();
  });

  app.post("/api/watches/from-template", async (request, reply) => {
    const body = validate(createFromTemplateSchema, request.body);
    const applied = applyTemplate(body.templateId, { subject: body.subject });
    if (!applied) {
      return reply.status(404).send({ error: "Template not found" });
    }

    const result = ensureWatch(ctx.storage, {
      title: applied.label,
      question: applied.goal,
      intervalHours: applied.intervalHours,
      deliveryMode: applied.deliveryMode === "always" ? "interval" : "change-gated",
    });

    if (result.created) {
      recordProductEvent(ctx.storage, {
        eventType: "program_created",
        channel: "web",
        programId: result.program.id,
        threadId: result.program.threadId,
        metadata: {
          executionMode: result.program.executionMode,
          family: result.program.family,
          templateId: body.templateId,
        },
      });
    }

    return {
      watch: enrichWatch(serverCtx, result.program),
      created: result.created,
      duplicateReason: result.duplicateReason,
      template: { id: body.templateId, depthLevel: applied.depthLevel },
    };
  });

  // --- CRUD ---

  app.get("/api/watches", async () => {
    return listWatches(ctx.storage).map((watch) => enrichWatch(serverCtx, watch));
  });

  app.get<{ Params: { id: string } }>("/api/watches/:id", async (request, reply) => {
    const watch = getWatch(ctx.storage, request.params.id);
    if (!watch) {
      return reply.status(404).send({ error: "Watch not found" });
    }
    return enrichWatch(serverCtx, watch);
  });

  app.get<{ Params: { id: string } }>("/api/watches/:id/history", async (request, reply) => {
    const watch = getWatch(ctx.storage, request.params.id);
    if (!watch) {
      return reply.status(404).send({ error: "Watch not found" });
    }

    const actions = listTasks(ctx.storage, "all")
      .filter((task) => task.source_type === "program" && task.source_id === watch.id)
      .map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        priority: task.priority,
        dueDate: task.due_date,
        createdAt: task.created_at,
        completedAt: task.completed_at,
      }));

    const briefings = ctx.storage.query<{
      id: string;
      generated_at: string;
      type: string;
      status: string;
      signal_hash: string | null;
      source_job_id: string | null;
      source_job_kind: string | null;
      sections: string;
    }>(
      `SELECT id, generated_at, type, status, signal_hash, source_job_id, source_job_kind, sections
       FROM briefings
       WHERE program_id = ?
       ORDER BY generated_at DESC
       LIMIT 20`,
      [watch.id],
    ).map((briefing) => ({
      id: briefing.id,
      generatedAt: briefing.generated_at,
      type: briefing.type,
      status: briefing.status,
      signalHash: briefing.signal_hash,
      sourceJobId: briefing.source_job_id,
      sourceJobKind: briefing.source_job_kind,
      recommendationSummary: parseRecommendationSummary(briefing.sections),
    }));

    const researchJobs = ctx.storage.query<{
      id: string;
      status: string;
      goal: string;
      created_at: string;
      queued_at: string | null;
      completed_at: string | null;
      briefing_id: string | null;
      result_type: string | null;
    }>(
      `SELECT id, status, goal, created_at, queued_at, completed_at, briefing_id, result_type
       FROM research_jobs
       WHERE source_schedule_id = ?
       ORDER BY created_at DESC
       LIMIT 20`,
      [watch.id],
    );

    const analysisJobs = ctx.storage.query<{
      id: string;
      status: string;
      goal: string;
      created_at: string;
      queued_at: string | null;
      completed_at: string | null;
      briefing_id: string | null;
      result_type: string | null;
    }>(
      `SELECT id, status, goal, created_at, queued_at, completed_at, briefing_id, result_type
       FROM swarm_jobs
       WHERE source_schedule_id = ?
       ORDER BY created_at DESC
       LIMIT 20`,
      [watch.id],
    );

    return {
      watch: enrichWatch(serverCtx, watch),
      history: {
        briefings,
        actions,
        researchJobs: researchJobs.map((job) => ({
          id: job.id,
          status: job.status,
          goal: job.goal,
          createdAt: job.created_at,
          queuedAt: job.queued_at,
          completedAt: job.completed_at,
          briefingId: job.briefing_id,
          resultType: job.result_type,
        })),
        analysisJobs: analysisJobs.map((job) => ({
          id: job.id,
          status: job.status,
          goal: job.goal,
          createdAt: job.created_at,
          queuedAt: job.queued_at,
          completedAt: job.completed_at,
          briefingId: job.briefing_id,
          resultType: job.result_type,
        })),
      },
    };
  });

  app.post("/api/watches", async (request) => {
    const body = validate(createWatchSchema, request.body);
    const result = ensureWatch(ctx.storage, body);
    if (result.created) {
      recordProductEvent(ctx.storage, {
        eventType: "program_created",
        channel: body.chatId ? "telegram" : "web",
        programId: result.program.id,
        threadId: result.program.threadId,
        metadata: { executionMode: result.program.executionMode, family: result.program.family },
      });
    }
    return {
      watch: enrichWatch(serverCtx, result.program),
      created: result.created,
      duplicateReason: result.duplicateReason,
    };
  });

  app.patch<{ Params: { id: string } }>("/api/watches/:id", async (request, reply) => {
    const body = validate(updateWatchSchema, request.body);
    const watch = updateWatch(ctx.storage, request.params.id, body);
    if (!watch) {
      return reply.status(404).send({ error: "Watch not found" });
    }
    return enrichWatch(serverCtx, watch);
  });

  app.patch<{ Params: { id: string } }>("/api/watches/:id/status", async (request) => {
    const { action } = validate(patchWatchStatusSchema, request.body);
    if (action === "pause") {
      return { ok: pauseWatch(ctx.storage, request.params.id) };
    }
    return { ok: resumeWatch(ctx.storage, request.params.id) };
  });

  app.delete<{ Params: { id: string } }>("/api/watches/:id", async (request) => {
    const ok = deleteWatch(ctx.storage, request.params.id);
    return { ok };
  });

  // --- Trigger immediate research ---

  app.post<{ Params: { id: string } }>("/api/watches/:id/run", async (request, reply) => {
    const watch = getWatch(ctx.storage, request.params.id);
    if (!watch) {
      return reply.status(404).send({ error: "Watch not found" });
    }

    const depth = resolveDepthForWatch({}, /* isManualTrigger */ true);
    const execution = watch.executionMode === "analysis" ? "analysis" : "research";

    let jobId: string;
    if (execution === "analysis") {
      jobId = await backgroundDispatcher.enqueueSwarm({
        goal: watch.question,
        threadId: watch.threadId ?? null,
        sourceKind: "manual",
        sourceScheduleId: watch.id,
      });
    } else {
      jobId = await backgroundDispatcher.enqueueResearch({
        goal: watch.question,
        threadId: watch.threadId ?? null,
        sourceKind: "manual",
        sourceScheduleId: watch.id,
      });
    }

    return { ok: true, jobId, depth };
  });
}

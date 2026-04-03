import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  recordProductEvent,
  isBriefContentLine,
} from "@personal-ai/core";
import {
  listPrograms,
  getProgramById,
  ensureProgram,
  updateProgram,
  deleteProgram,
  pauseProgram,
  resumeProgram,
  type Program,
} from "@personal-ai/plugin-schedules";
import { listTasks } from "@personal-ai/plugin-tasks";

import type { ServerContext } from "../index.js";
import { validate } from "../validate.js";

const createProgramSchema = z.object({
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

const updateProgramSchema = createProgramSchema.partial();

const patchProgramStatusSchema = z.object({
  action: z.enum(["pause", "resume"]),
});

interface ProgramBriefSummaryRow {
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
      const summary = recommendation.summary.trim();
      if (isBriefContentLine(summary)) return summary;
    }
    if (typeof parsed.goal === "string" && parsed.goal.trim().length > 0) {
      return parsed.goal;
    }
    if (typeof parsed.report === "string") {
      const firstMeaningfulLine = parsed.report
        .split("\n")
        .map((line) => line.trim())
        .find((line) => isBriefContentLine(line));
      return firstMeaningfulLine ?? null;
    }
  } catch {
    return null;
  }
  return null;
}

function buildProgramActionSummary(serverCtx: ServerContext, programId: string) {
  const tasks = listTasks(serverCtx.ctx.storage, "all").filter(
    (task) => task.source_type === "program" && task.source_id === programId,
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

function buildLatestBriefSummary(serverCtx: ServerContext, program: Program) {
  if (!program.latestBriefId) return null;

  const rows = serverCtx.ctx.storage.query<ProgramBriefSummaryRow>(
    "SELECT id, generated_at, type, sections, source_job_id, source_job_kind FROM briefings WHERE id = ?",
    [program.latestBriefId],
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

function enrichProgram(serverCtx: ServerContext, program: Program) {
  return {
    ...program,
    actionSummary: buildProgramActionSummary(serverCtx, program.id),
    latestBriefSummary: buildLatestBriefSummary(serverCtx, program),
  };
}

export function registerProgramRoutes(app: FastifyInstance, serverCtx: ServerContext): void {
  const { ctx } = serverCtx;

  app.get("/api/programs", async () => {
    return listPrograms(ctx.storage).map((program) => enrichProgram(serverCtx, program));
  });

  app.get<{ Params: { id: string } }>("/api/programs/:id", async (request, reply) => {
    const program = getProgramById(ctx.storage, request.params.id);
    if (!program) {
      return reply.status(404).send({ error: "Program not found" });
    }
    return enrichProgram(serverCtx, program);
  });

  app.get<{ Params: { id: string } }>("/api/programs/:id/history", async (request, reply) => {
    const program = getProgramById(ctx.storage, request.params.id);
    if (!program) {
      return reply.status(404).send({ error: "Program not found" });
    }

    const actions = listTasks(ctx.storage, "all")
      .filter((task) => task.source_type === "program" && task.source_id === program.id)
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
      [program.id],
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
      [program.id],
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
      [program.id],
    );

    return {
      program: enrichProgram(serverCtx, program),
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

  app.post("/api/programs", async (request) => {
    const body = validate(createProgramSchema, request.body);
    const result = ensureProgram(ctx.storage, body);
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
      program: enrichProgram(serverCtx, result.program),
      created: result.created,
      duplicateReason: result.duplicateReason,
    };
  });

  app.patch<{ Params: { id: string } }>("/api/programs/:id", async (request, reply) => {
    const body = validate(updateProgramSchema, request.body);
    const program = updateProgram(ctx.storage, request.params.id, body);
    if (!program) {
      return reply.status(404).send({ error: "Program not found" });
    }
    return enrichProgram(serverCtx, program);
  });

  app.patch<{ Params: { id: string } }>("/api/programs/:id/status", async (request) => {
    const { action } = validate(patchProgramStatusSchema, request.body);
    if (action === "pause") {
      return { ok: pauseProgram(ctx.storage, request.params.id) };
    }
    return { ok: resumeProgram(ctx.storage, request.params.id) };
  });

  app.delete<{ Params: { id: string } }>("/api/programs/:id", async (request) => {
    const ok = deleteProgram(ctx.storage, request.params.id);
    return { ok };
  });
}

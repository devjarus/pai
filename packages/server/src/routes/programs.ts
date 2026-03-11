import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  listPrograms,
  createProgram,
  updateProgram,
  deleteProgram,
  pauseProgram,
  resumeProgram,
} from "@personal-ai/plugin-schedules";

import type { ServerContext } from "../index.js";
import { validate } from "../validate.js";

const createProgramSchema = z.object({
  title: z.string().min(1, "title is required").max(200),
  question: z.string().min(1, "question is required").max(4000),
  family: z.enum(["general", "work", "travel", "buying"]).optional(),
  executionMode: z.enum(["research", "analysis"]).optional(),
  intervalHours: z.number().int().positive().max(720).optional(),
  startAt: z.string().max(30).optional(),
  preferences: z.array(z.string().min(1).max(500)).max(10).optional(),
  constraints: z.array(z.string().min(1).max(500)).max(10).optional(),
  openQuestions: z.array(z.string().min(1).max(500)).max(10).optional(),
});

const updateProgramSchema = createProgramSchema.partial();

const patchProgramStatusSchema = z.object({
  action: z.enum(["pause", "resume"]),
});

export function registerProgramRoutes(app: FastifyInstance, { ctx }: ServerContext): void {
  app.get("/api/programs", async () => {
    return listPrograms(ctx.storage);
  });

  app.post("/api/programs", async (request) => {
    const body = validate(createProgramSchema, request.body);
    return createProgram(ctx.storage, body);
  });

  app.patch<{ Params: { id: string } }>("/api/programs/:id", async (request, reply) => {
    const body = validate(updateProgramSchema, request.body);
    const program = updateProgram(ctx.storage, request.params.id, body);
    if (!program) {
      return reply.status(404).send({ error: "Program not found" });
    }
    return program;
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

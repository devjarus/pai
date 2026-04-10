import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ServerContext } from "../index.js";
import { validate } from "../validate.js";
import { recordProductEvent } from "@personal-ai/core";
import {
  addTask,
  listTasks,
  completeTask,
  editTask,
  reopenTask,
  snoozeTask,
  unsnoozeTask,
  deleteTask,
  clearAllTasks,
  addGoal,
  listGoals,
  completeGoal,
  deleteGoal,
} from "@personal-ai/plugin-tasks";
import type { TaskStatusFilter } from "@personal-ai/plugin-tasks";

const createTaskSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  dueDate: z.string().optional(),
  goalId: z.string().optional(),
  sourceType: z.enum(["briefing", "program"]).optional(),
  sourceId: z.string().min(1).optional(),
  sourceLabel: z.string().min(1).max(255).optional(),
}).refine((value) => !value.sourceType || !!value.sourceId, {
  message: "sourceId is required when sourceType is provided",
  path: ["sourceId"],
});

const editTaskSchema = z.object({
  title: z.string().min(1).optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  dueDate: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  goalId: z.string().nullable().optional(),
});

const snoozeTaskSchema = z.object({
  until: z.string().min(1, "until is required (ISO datetime or date)"),
});

const createGoalSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
});

export function registerTaskRoutes(app: FastifyInstance, { ctx }: ServerContext): void {
  app.get<{ Querystring: { status?: string; goalId?: string; sourceType?: string; sourceId?: string } }>("/api/tasks", async (request) => {
    const status = (request.query.status ?? "open") as TaskStatusFilter;
    let tasks = listTasks(ctx.storage, status);
    if (request.query.goalId) {
      tasks = tasks.filter((t) => t.goal_id === request.query.goalId);
    }
    if (request.query.sourceType) {
      tasks = tasks.filter((t) => t.source_type === request.query.sourceType);
    }
    if (request.query.sourceId) {
      tasks = tasks.filter((t) => t.source_id === request.query.sourceId);
    }
    return tasks;
  });

  app.post<{ Body: { title: string; description?: string; priority?: string; dueDate?: string; goalId?: string; sourceType?: "briefing" | "program"; sourceId?: string; sourceLabel?: string } }>(
    "/api/tasks",
    async (request, reply) => {
      try {
        const body = validate(createTaskSchema, request.body);
        const task = addTask(ctx.storage, body);
        if (body.sourceType === "briefing") {
          recordProductEvent(ctx.storage, {
            eventType: "brief_action_created",
            briefId: body.sourceId ?? null,
            actionId: task.id,
            channel: "web",
            metadata: { sourceLabel: body.sourceLabel ?? null },
          });
        }
        return reply.status(201).send(task);
      } catch (err) {
        return reply.status(400).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.patch<{ Params: { id: string }; Body: { title?: string; priority?: string; dueDate?: string; description?: string; goalId?: string | null } }>(
    "/api/tasks/:id",
    async (request, reply) => {
      try {
        const body = validate(editTaskSchema, request.body);
        editTask(ctx.storage, request.params.id, {
          ...body,
          dueDate: body.dueDate ?? undefined,
          description: body.description ?? undefined,
          goalId: body.goalId,
        });
        return { ok: true };
      } catch (err) {
        return reply.status(400).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.post<{ Params: { id: string } }>("/api/tasks/:id/done", async (request, reply) => {
    try {
      const task = listTasks(ctx.storage, "all").find((entry) => entry.id === request.params.id);
      completeTask(ctx.storage, request.params.id);
      if (task?.source_type === "briefing") {
        recordProductEvent(ctx.storage, {
          eventType: "brief_action_completed",
          briefId: task.source_id,
          actionId: task.id,
          channel: "web",
        });
      }
      return { ok: true };
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post<{ Params: { id: string } }>("/api/tasks/:id/reopen", async (request, reply) => {
    try {
      reopenTask(ctx.storage, request.params.id);
      return { ok: true };
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post<{ Params: { id: string }; Body: { until: string } }>(
    "/api/tasks/:id/snooze",
    async (request, reply) => {
      try {
        const body = validate(snoozeTaskSchema, request.body);
        const snoozedUntil = snoozeTask(ctx.storage, request.params.id, body.until);
        return { ok: true, snoozed_until: snoozedUntil };
      } catch (err) {
        return reply.status(400).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.post<{ Params: { id: string } }>("/api/tasks/:id/unsnooze", async (request, reply) => {
    try {
      unsnoozeTask(ctx.storage, request.params.id);
      return { ok: true };
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.delete<{ Params: { id: string } }>("/api/tasks/:id", async (request, reply) => {
    try {
      deleteTask(ctx.storage, request.params.id);
      return { ok: true };
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/tasks/clear", async () => {
    const cleared = clearAllTasks(ctx.storage);
    return { ok: true, cleared };
  });

  // ---- Goals ----

  app.get<{ Querystring: { status?: string } }>("/api/goals", async (request) => {
    const status = (request.query.status ?? "active") as "active" | "done" | "all";
    return listGoals(ctx.storage, status);
  });

  app.post<{ Body: { title: string; description?: string } }>("/api/goals", async (request, reply) => {
    try {
      const body = validate(createGoalSchema, request.body);
      const goal = addGoal(ctx.storage, body);
      return reply.status(201).send(goal);
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post<{ Params: { id: string } }>("/api/goals/:id/done", async (request, reply) => {
    try {
      completeGoal(ctx.storage, request.params.id);
      return { ok: true };
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.delete<{ Params: { id: string } }>("/api/goals/:id", async (request, reply) => {
    try {
      deleteGoal(ctx.storage, request.params.id);
      return { ok: true };
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}

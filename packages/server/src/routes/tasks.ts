import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ServerContext } from "../index.js";
import { validate } from "../validate.js";
import {
  addTask,
  listTasks,
  completeTask,
  editTask,
  reopenTask,
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
});

const editTaskSchema = z.object({
  title: z.string().min(1).optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  dueDate: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  goalId: z.string().nullable().optional(),
});

const createGoalSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
});

export function registerTaskRoutes(app: FastifyInstance, { ctx }: ServerContext): void {
  app.get<{ Querystring: { status?: string; goalId?: string } }>("/api/tasks", async (request) => {
    const status = (request.query.status ?? "open") as TaskStatusFilter;
    let tasks = listTasks(ctx.storage, status);
    if (request.query.goalId) {
      tasks = tasks.filter((t) => t.goal_id === request.query.goalId);
    }
    return tasks;
  });

  app.post<{ Body: { title: string; description?: string; priority?: string; dueDate?: string; goalId?: string } }>(
    "/api/tasks",
    async (request, reply) => {
      try {
        const body = validate(createTaskSchema, request.body);
        const task = addTask(ctx.storage, body);
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
      completeTask(ctx.storage, request.params.id);
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

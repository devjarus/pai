import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ServerContext } from "../index.js";
import { validate } from "../validate.js";
import {
  listBeliefs,
  searchBeliefs,
  semanticSearch,
  forgetBelief,
  updateBeliefContent,
  memoryStats,
  remember,
} from "@personal-ai/core";
import type { Belief } from "@personal-ai/core";

const rememberSchema = z.object({
  text: z.string().min(1, "text is required").max(10_000, "Text too long (max 10,000 characters)"),
});

const updateBeliefSchema = z.object({
  statement: z.string().min(1, "statement is required").max(10_000, "Statement too long"),
});

export function registerMemoryRoutes(app: FastifyInstance, { ctx }: ServerContext): void {
  app.get<{ Querystring: { status?: string; type?: string } }>("/api/beliefs", async (request) => {
    const status = request.query.status ?? "active";
    let beliefs = listBeliefs(ctx.storage, status);
    if (request.query.type) {
      beliefs = beliefs.filter((b: Belief) => b.type === request.query.type);
    }
    return beliefs;
  });

  app.get<{ Params: { id: string } }>("/api/beliefs/:id", async (request, reply) => {
    const beliefs = listBeliefs(ctx.storage, "all");
    const belief = beliefs.find((b: Belief) => b.id === request.params.id || b.id.startsWith(request.params.id));
    if (!belief) return reply.status(404).send({ error: "Belief not found" });
    return belief;
  });

  app.patch<{ Params: { id: string } }>("/api/beliefs/:id", async (request, reply) => {
    const { statement } = validate(updateBeliefSchema, request.body);
    try {
      const updated = await updateBeliefContent(ctx.storage, ctx.llm, request.params.id, statement);
      return updated;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update belief";
      return reply.status(404).send({ error: message });
    }
  });

  app.get<{ Querystring: { q: string } }>("/api/search", async (request) => {
    const query = request.query.q;
    if (!query) return [];

    try {
      const { embedding } = await ctx.llm.embed(query);
      const results = semanticSearch(ctx.storage, embedding, 20, query);
      return results.map((r) => {
        const full = ctx.storage.query<Belief>(
          "SELECT * FROM beliefs WHERE id = ?", [r.beliefId],
        )[0];
        return full ? { ...full, similarity: r.similarity } : null;
      }).filter(Boolean);
    } catch {
      return searchBeliefs(ctx.storage, query);
    }
  });

  app.get("/api/stats", async () => {
    return memoryStats(ctx.storage);
  });

  app.post("/api/remember", async (request) => {
    const { text } = validate(rememberSchema, request.body);
    const result = await remember(ctx.storage, ctx.llm, text, ctx.logger);
    return result;
  });

  app.post<{ Params: { id: string } }>("/api/forget/:id", async (request) => {
    forgetBelief(ctx.storage, request.params.id);
    return { ok: true };
  });

  app.post("/api/memory/clear", async () => {
    const active = listBeliefs(ctx.storage, "active");
    let cleared = 0;
    for (const belief of active) {
      try {
        forgetBelief(ctx.storage, belief.id);
        cleared++;
      } catch {
        // skip beliefs that fail
      }
    }
    return { ok: true, cleared };
  });
}

import type { FastifyInstance } from "fastify";
import type { ServerContext } from "../index.js";
import {
  listBeliefs,
  searchBeliefs,
  semanticSearch,
  forgetBelief,
  memoryStats,
  remember,
} from "@personal-ai/core";
import type { Belief } from "@personal-ai/core";

export function registerMemoryRoutes(app: FastifyInstance, { ctx }: ServerContext): void {
  // List beliefs
  app.get<{ Querystring: { status?: string; type?: string } }>("/api/beliefs", async (request) => {
    const status = request.query.status ?? "active";
    let beliefs = listBeliefs(ctx.storage, status);
    if (request.query.type) {
      beliefs = beliefs.filter((b: Belief) => b.type === request.query.type);
    }
    return beliefs;
  });

  // Get single belief by ID
  app.get<{ Params: { id: string } }>("/api/beliefs/:id", async (request, reply) => {
    const beliefs = listBeliefs(ctx.storage, "all");
    const belief = beliefs.find((b: Belief) => b.id === request.params.id || b.id.startsWith(request.params.id));
    if (!belief) return reply.status(404).send({ error: "Belief not found" });
    return belief;
  });

  // Search beliefs — returns full Belief objects enriched with similarity score
  app.get<{ Querystring: { q: string } }>("/api/search", async (request) => {
    const query = request.query.q;
    if (!query) return [];

    try {
      const { embedding } = await ctx.llm.embed(query);
      const results = semanticSearch(ctx.storage, embedding, 20, query);
      // Enrich with full belief data so the UI can render BeliefCards
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

  // Memory stats
  app.get("/api/stats", async () => {
    return memoryStats(ctx.storage);
  });

  // Remember
  app.post<{ Body: { text: string } }>("/api/remember", async (request, reply) => {
    const { text } = request.body ?? {};
    if (!text) return reply.status(400).send({ error: "text is required" });
    const result = await remember(ctx.storage, ctx.llm, text, ctx.logger);
    return result;
  });

  // Forget
  app.post<{ Params: { id: string } }>("/api/forget/:id", async (request) => {
    forgetBelief(ctx.storage, request.params.id);
    return { ok: true };
  });

  // Clear all memory — forgets all active beliefs
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

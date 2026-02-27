import type { FastifyInstance } from "fastify";
import type { ServerContext } from "../index.js";
import { getLatestBriefing, getBriefingById, listBriefings, listAllBriefings, generateBriefing, clearAllBriefings, getResearchBriefings } from "../briefing.js";

export function registerInboxRoutes(app: FastifyInstance, { ctx }: ServerContext): void {
  app.get("/api/inbox", async () => {
    const briefing = getLatestBriefing(ctx.storage);
    if (!briefing) return { briefing: null };
    return { briefing };
  });

  app.post("/api/inbox/refresh", async () => {
    generateBriefing(ctx).catch((err) => {
      ctx.logger.error("Briefing refresh failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    });
    return { ok: true, message: "Briefing generation started" };
  });

  app.get("/api/inbox/history", async () => {
    return { briefings: listBriefings(ctx.storage) };
  });

  // Clear all briefings
  app.post("/api/inbox/clear", async () => {
    const cleared = clearAllBriefings(ctx.storage);
    return { ok: true, cleared };
  });

  // Unified feed — all briefing types in chronological order
  app.get("/api/inbox/all", async () => {
    const briefings = listAllBriefings(ctx.storage);
    // Check if a briefing is currently being generated
    const generating = ctx.storage.query<{ id: string }>(
      "SELECT id FROM briefings WHERE status = 'generating' LIMIT 1",
    );
    return { briefings, generating: generating.length > 0 };
  });

  app.get("/api/inbox/research", async () => {
    const briefings = getResearchBriefings(ctx.storage);
    return { briefings };
  });

  app.get<{ Params: { id: string } }>("/api/inbox/:id", async (request, reply) => {
    const briefing = getBriefingById(ctx.storage, request.params.id);
    if (!briefing) return reply.status(404).send({ error: "Briefing not found" });
    return { briefing };
  });
}

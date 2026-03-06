import type { FastifyInstance } from "fastify";
import type { ServerContext } from "../index.js";
import { getLatestBriefing, getBriefingById, listBriefings, listAllBriefings, clearAllBriefings, getResearchBriefings, getDailyBriefingState } from "../briefing.js";
import type { ResearchResultType } from "@personal-ai/core";

export function registerInboxRoutes(app: FastifyInstance, { ctx, backgroundDispatcher }: ServerContext): void {
  app.get("/api/inbox", async () => {
    const briefing = getLatestBriefing(ctx.storage);
    if (!briefing) return { briefing: null };
    return { briefing };
  });

  app.post("/api/inbox/refresh", async () => {
    const briefingId = backgroundDispatcher.enqueueBriefing({ sourceKind: "manual", reason: "inbox-refresh" });
    return { ok: true, briefingId, message: "Briefing queued" };
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
    const state = getDailyBriefingState(ctx.storage);
    return { briefings, generating: state.generating, pending: state.pending };
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

  // Rerun a research report — creates a new research job with the same goal
  app.post<{ Params: { id: string } }>("/api/inbox/:id/rerun", async (request, reply) => {
    const briefing = getBriefingById(ctx.storage, request.params.id);
    if (!briefing) return reply.status(404).send({ error: "Briefing not found" });

    // Extract goal from research briefing sections
    let sections: Record<string, unknown>;
    try {
      sections = typeof briefing.sections === "string"
        ? JSON.parse(briefing.sections)
        : briefing.sections;
    } catch {
      return reply.status(400).send({ error: "Invalid briefing data" });
    }

    const goal = sections.goal as string | undefined;
    if (!goal) return reply.status(400).send({ error: "No research goal found in briefing" });

    const resultType = (sections.resultType as string | undefined) ?? "general";

    const execution = sections.execution === "analysis" || briefing.id.startsWith("swarm-")
      ? "analysis"
      : "research";

    let jobId: string;
    if (execution === "analysis") {
      jobId = await backgroundDispatcher.enqueueSwarm({
        goal,
        threadId: null,
        resultType,
        sourceKind: "manual",
      });
    } else {
      jobId = await backgroundDispatcher.enqueueResearch({
        goal,
        threadId: null,
        resultType: resultType as ResearchResultType,
        sourceKind: "manual",
      });
    }

    return { ok: true, jobId };
  });
}

import type { FastifyInstance } from "fastify";
import type { ServerContext } from "../index.js";
import { getLatestBriefing, getBriefingById, listBriefings, listAllBriefings, generateBriefing, clearAllBriefings, getResearchBriefings } from "../briefing.js";
import { createResearchJob, runResearchInBackground } from "@personal-ai/plugin-research";
import { webSearch, formatSearchResults } from "@personal-ai/plugin-assistant/web-search";
import { fetchPageAsMarkdown } from "@personal-ai/plugin-assistant/page-fetch";
import type { ResearchResultType } from "@personal-ai/core";

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

    // Create new research job
    const jobId = createResearchJob(ctx.storage, {
      goal,
      threadId: null,
      resultType: resultType as ResearchResultType,
    });

    runResearchInBackground(
      {
        storage: ctx.storage,
        llm: ctx.llm,
        logger: ctx.logger,
        timezone: ctx.config.timezone,
        provider: ctx.config.llm.provider,
        model: ctx.config.llm.model,
        contextWindow: ctx.config.llm.contextWindow,
        webSearch,
        formatSearchResults,
        fetchPage: fetchPageAsMarkdown,
      },
      jobId,
    ).catch((err) => {
      ctx.logger.error(`Rerun research failed: ${err instanceof Error ? err.message : String(err)}`);
    });

    return { ok: true, jobId };
  });
}

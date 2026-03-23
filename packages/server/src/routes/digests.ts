import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ServerContext } from "../index.js";
import { validate } from "../validate.js";
import {
  getLatestBriefing,
  getBriefingById,
  listAllBriefings,
  getDailyBriefingState,
  getBriefBeliefs,
} from "../briefing.js";
import { rateDigest } from "../digest-ratings.js";
import { ingestCorrection } from "@personal-ai/library";
import { recordProductEvent } from "@personal-ai/core";

const correctSchema = z.object({
  beliefId: z.string().min(1, "beliefId is required"),
  correctedStatement: z.string().min(1, "correctedStatement is required").max(5000),
  note: z.string().max(2000).optional(),
});

const rateSchema = z.object({
  rating: z.number().int().min(1).max(5),
  feedback: z.string().max(2000).optional(),
});

export function registerDigestRoutes(app: FastifyInstance, { ctx, backgroundDispatcher }: ServerContext): void {
  // List all digests (wraps GET /api/inbox/all)
  app.get("/api/digests", async () => {
    const briefings = listAllBriefings(ctx.storage);
    const state = getDailyBriefingState(ctx.storage);
    return { briefings, generating: state.generating, pending: state.pending };
  });

  // Latest digest (wraps GET /api/inbox)
  app.get("/api/digests/latest", async () => {
    const briefing = getLatestBriefing(ctx.storage);
    if (!briefing) return { briefing: null };
    return { briefing };
  });

  // Refresh / generate new digest (wraps POST /api/inbox/refresh)
  app.post("/api/digests/refresh", async () => {
    const briefingId = backgroundDispatcher.enqueueBriefing({ sourceKind: "manual", reason: "digest-refresh" });
    return { ok: true, briefingId, message: "Digest queued" };
  });

  // Get digest by ID (wraps GET /api/inbox/:id)
  app.get<{ Params: { id: string } }>("/api/digests/:id", async (request, reply) => {
    const briefing = getBriefingById(ctx.storage, request.params.id);
    if (!briefing) return reply.status(404).send({ error: "Digest not found" });
    recordProductEvent(ctx.storage, {
      eventType: "brief_opened",
      briefId: briefing.id,
      programId: typeof briefing.programId === "string" ? briefing.programId : null,
      threadId: typeof briefing.threadId === "string" ? briefing.threadId : null,
      channel: "web",
      metadata: { type: briefing.type },
    });
    return { briefing };
  });

  // Get digest sources / provenance (beliefs that shaped the digest)
  app.get<{ Params: { id: string } }>("/api/digests/:id/sources", async (request, reply) => {
    const briefing = getBriefingById(ctx.storage, request.params.id);
    if (!briefing) return reply.status(404).send({ error: "Digest not found" });
    const beliefs = getBriefBeliefs(ctx.storage, request.params.id);
    return { sources: beliefs };
  });

  // Correct a belief referenced in the digest
  app.post<{ Params: { id: string } }>("/api/digests/:id/correct", async (request, reply) => {
    const briefing = getBriefingById(ctx.storage, request.params.id);
    if (!briefing) return reply.status(404).send({ error: "Digest not found" });

    const body = validate(correctSchema, request.body);
    const result = await ingestCorrection(ctx.storage, ctx.llm, {
      beliefId: body.beliefId,
      correctedStatement: body.correctedStatement,
      digestId: request.params.id,
      note: body.note,
    });
    if (!result.corrected) {
      const message = result.error ?? "Failed to correct belief";
      const normalized = message.toLowerCase();
      const status = normalized.includes("not found") || normalized.includes("no match found")
        ? 404
        : normalized.includes("ambiguous") || normalized.includes("must change")
          ? 400
          : 500;
      return reply.status(status).send({ error: message });
    }

    recordProductEvent(ctx.storage, {
      eventType: "belief_corrected",
      channel: "web",
      programId: typeof briefing.programId === "string" ? briefing.programId : null,
      briefId: request.params.id,
      beliefId: result.replacementBeliefId ?? body.beliefId,
      threadId: typeof briefing.threadId === "string" ? briefing.threadId : null,
    });

    return { ok: true };
  });

  // Rate a digest
  app.post<{ Params: { id: string } }>("/api/digests/:id/rate", async (request, reply) => {
    const briefing = getBriefingById(ctx.storage, request.params.id);
    if (!briefing) return reply.status(404).send({ error: "Digest not found" });

    const body = validate(rateSchema, request.body);
    const rating = rateDigest(ctx.storage, request.params.id, body.rating, body.feedback);
    return rating;
  });

  // Explicit recommendation-accept action for web digest UX
  app.post<{ Params: { id: string } }>("/api/digests/:id/accept", async (request, reply) => {
    const briefing = getBriefingById(ctx.storage, request.params.id);
    if (!briefing) return reply.status(404).send({ error: "Digest not found" });

    const existing = ctx.storage.query<{ id: string }>(
      "SELECT id FROM product_events WHERE event_type = 'recommendation_accepted' AND brief_id = ? LIMIT 1",
      [request.params.id],
    )[0];
    if (existing) {
      return { ok: true, alreadyAccepted: true };
    }

    recordProductEvent(ctx.storage, {
      eventType: "recommendation_accepted",
      channel: "web",
      programId: typeof briefing.programId === "string" ? briefing.programId : null,
      briefId: request.params.id,
      threadId: typeof briefing.threadId === "string" ? briefing.threadId : null,
      metadata: { type: briefing.type },
    });

    return { ok: true, alreadyAccepted: false };
  });

  // Rerun a digest (wraps POST /api/inbox/:id/rerun)
  app.post<{ Params: { id: string } }>("/api/digests/:id/rerun", async (request, reply) => {
    const briefing = getBriefingById(ctx.storage, request.params.id);
    if (!briefing) return reply.status(404).send({ error: "Digest not found" });

    let sections: Record<string, unknown>;
    try {
      sections = typeof briefing.sections === "string"
        ? JSON.parse(briefing.sections)
        : briefing.sections;
    } catch {
      return reply.status(400).send({ error: "Invalid briefing data" });
    }

    const goal = sections.goal as string | undefined;
    if (!goal) return reply.status(400).send({ error: "No research goal found in digest" });

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
        resultType: resultType as "general" | "comparison" | "timeline" | "analysis",
        sourceKind: "manual",
      });
    }

    return { ok: true, jobId };
  });

  // Extract suggestions (next_actions) from a digest
  app.get<{ Params: { id: string } }>("/api/digests/:id/suggestions", async (request, reply) => {
    const briefing = getBriefingById(ctx.storage, request.params.id);
    if (!briefing) return reply.status(404).send({ error: "Digest not found" });

    let sections: Record<string, unknown>;
    try {
      sections = typeof briefing.sections === "string"
        ? JSON.parse(briefing.sections)
        : briefing.sections;
    } catch {
      return reply.status(400).send({ error: "Invalid briefing data" });
    }

    const nextActions = Array.isArray(sections.next_actions) ? sections.next_actions : [];
    const suggestions = nextActions
      .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
      .map((item) => ({
        title: typeof item.title === "string" ? item.title : "",
        timing: typeof item.timing === "string" ? item.timing : "",
        detail: typeof item.detail === "string" ? item.detail : "",
        owner: typeof item.owner === "string" ? item.owner : undefined,
      }))
      .filter((s) => s.title.length > 0);

    return { suggestions };
  });
}

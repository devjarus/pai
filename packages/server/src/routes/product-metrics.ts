import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { getProductMetricsOverview, recordProductEvent } from "@personal-ai/core";

import type { ServerContext } from "../index.js";
import { validate } from "../validate.js";

const productEventSchema = z.object({
  eventType: z.enum([
    "program_created",
    "brief_opened",
    "brief_followup_asked",
    "brief_action_created",
    "brief_action_completed",
    "belief_corrected",
    "recommendation_accepted",
    "telegram_brief_interaction",
  ]),
  channel: z.string().max(32).optional(),
  programId: z.string().max(255).nullable().optional(),
  briefId: z.string().max(255).nullable().optional(),
  beliefId: z.string().max(255).nullable().optional(),
  actionId: z.string().max(255).nullable().optional(),
  threadId: z.string().max(255).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export function registerProductMetricRoutes(app: FastifyInstance, { ctx }: ServerContext): void {
  app.get<{ Querystring: { rangeDays?: string } }>("/api/product-metrics/overview", async (request) => {
    const rangeDays = Number.parseInt(request.query.rangeDays ?? "30", 10);
    return getProductMetricsOverview(ctx.storage, Number.isFinite(rangeDays) && rangeDays > 0 ? rangeDays : 30);
  });

  app.post("/api/product-events", async (request) => {
    const body = validate(productEventSchema, request.body);
    return recordProductEvent(ctx.storage, body);
  });
}

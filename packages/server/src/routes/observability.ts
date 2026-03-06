import type { FastifyInstance } from "fastify";
import {
  getJobDiagnostics,
  getLlmTrafficSnapshot,
  getObservabilityOverview,
  getThreadDiagnostics,
  getTraceSpans,
  listProcessAggregates,
  listRecentErrors,
  getThread,
} from "@personal-ai/core";
import { z } from "zod";
import type { ServerContext } from "../index.js";
import { validate } from "../validate.js";

const rangeSchema = z.object({
  range: z.enum(["24h", "7d", "30d"]).optional(),
});

export function registerObservabilityRoutes(app: FastifyInstance, serverCtx: ServerContext): void {
  const { ctx, backgroundDispatcher } = serverCtx;

  app.get<{ Querystring: { range?: "24h" | "7d" | "30d" } }>("/api/observability/overview", async (request) => {
    const { range } = validate(rangeSchema, request.query ?? {});
    const overview = getObservabilityOverview(ctx.storage, range ?? "24h");
    const traffic = getLlmTrafficSnapshot();
    const dispatcherState = backgroundDispatcher.getWorkState();
    return {
      ...overview,
      live: {
        activeRequests: traffic.activeTotal,
        queuedRequests: traffic.queuedTotal,
        lanes: {
          interactive: {
            active: traffic.active.interactive,
            queued: traffic.queued.interactive,
          },
          deferred: {
            active: traffic.active.deferred,
            queued: traffic.queued.deferred,
          },
        background: {
          active: traffic.active.background,
          queued: traffic.queued.background,
        },
      },
      startupDelayUntil: dispatcherState.startupDelayUntil ? new Date(dispatcherState.startupDelayUntil).toISOString() : null,
      backgroundActiveWorkId: dispatcherState.activeWorkId,
      backgroundActiveKind: dispatcherState.activeKind,
      pendingBackgroundJobs: dispatcherState.pending.length,
      },
    };
  });

  app.get<{ Querystring: { range?: "24h" | "7d" | "30d" } }>("/api/observability/processes", async (request) => {
    const { range } = validate(rangeSchema, request.query ?? {});
    return {
      range: range ?? "24h",
      processes: listProcessAggregates(ctx.storage, range ?? "24h"),
    };
  });

  app.get<{ Params: { threadId: string } }>("/api/observability/threads/:threadId", async (request, reply) => {
    const thread = getThread(ctx.storage, request.params.threadId);
    if (!thread) return reply.status(404).send({ error: "Thread not found" });
    return getThreadDiagnostics(ctx.storage, request.params.threadId);
  });

  app.get<{ Params: { jobId: string } }>("/api/observability/jobs/:jobId", async (request) => {
    return getJobDiagnostics(ctx.storage, request.params.jobId);
  });

  app.get<{ Params: { traceId: string } }>("/api/observability/traces/:traceId", async (request) => {
    return {
      traceId: request.params.traceId,
      spans: getTraceSpans(ctx.storage, request.params.traceId),
    };
  });

  app.get<{ Querystring: { range?: "24h" | "7d" | "30d" } }>("/api/observability/recent-errors", async (request) => {
    const { range } = validate(rangeSchema, request.query ?? {});
    return {
      range: range ?? "24h",
      errors: listRecentErrors(ctx.storage, range ?? "24h"),
    };
  });
}

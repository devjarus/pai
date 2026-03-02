import type { FastifyInstance } from "fastify";
import type { ServerContext } from "../index.js";
import { listLearningRuns } from "../learning.js";

export function registerLearningRoutes(app: FastifyInstance, serverCtx: ServerContext): void {
  app.get("/api/learning/runs", async () => {
    return { runs: listLearningRuns(serverCtx.ctx.storage) };
  });
}

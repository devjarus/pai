import type { FastifyInstance } from "fastify";
import type { ServerContext } from "../index.js";
import { getArtifact, listArtifacts } from "@personal-ai/core";

export function registerArtifactRoutes(app: FastifyInstance, serverCtx: ServerContext): void {
  // Serve an artifact by ID (images, charts, files)
  app.get<{ Params: { id: string } }>("/api/artifacts/:id", async (request, reply) => {
    const artifact = getArtifact(serverCtx.ctx.storage, request.params.id);
    if (!artifact) return reply.status(404).send({ error: "Artifact not found" });

    return reply
      .header("Content-Type", artifact.mimeType)
      .header("Content-Disposition", `inline; filename="${artifact.name}"`)
      .header("Cache-Control", "public, max-age=86400")
      .send(artifact.data);
  });

  // List artifacts for a job
  app.get<{ Params: { jobId: string } }>("/api/jobs/:jobId/artifacts", async (request) => {
    const artifacts = listArtifacts(serverCtx.ctx.storage, request.params.jobId);
    return { artifacts };
  });
}

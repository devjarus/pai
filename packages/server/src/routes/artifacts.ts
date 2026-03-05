import type { FastifyInstance } from "fastify";
import type { ServerContext } from "../index.js";
import { getArtifact, listArtifacts } from "@personal-ai/core";

export function registerArtifactRoutes(app: FastifyInstance, serverCtx: ServerContext): void {
  // Serve an artifact by ID (images, charts, files)
  app.get<{ Params: { id: string } }>("/api/artifacts/:id", async (request, reply) => {
    const artifact = getArtifact(serverCtx.ctx.storage, request.params.id);
    if (!artifact) return reply.status(404).send({ error: "Artifact not found" });

    // Sanitize filename to prevent header injection (strip quotes, newlines, control chars)
    const safeName = artifact.name.replace(/["\r\n\x00-\x1f]/g, "_");
    // Whitelist safe MIME types for inline display; force download for everything else.
    // NOTE: SVG is excluded — it can contain embedded JavaScript, enabling stored XSS.
    const safeMimeTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"]);
    const disposition = safeMimeTypes.has(artifact.mimeType) ? "inline" : "attachment";

    // Defense-in-depth: sandbox SVG/HTML content to prevent script execution
    const needsSandbox = artifact.mimeType.includes("svg") || artifact.mimeType.includes("html");
    if (needsSandbox) {
      reply.header("Content-Security-Policy", "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'");
    }

    return reply
      .header("Content-Type", artifact.mimeType)
      .header("Content-Disposition", `${disposition}; filename="${safeName}"`)
      .header("Cache-Control", "public, max-age=86400")
      .header("X-Content-Type-Options", "nosniff")
      .send(artifact.data);
  });

  // List artifacts for a job
  app.get<{ Params: { jobId: string } }>("/api/jobs/:jobId/artifacts", async (request) => {
    const artifacts = listArtifacts(serverCtx.ctx.storage, request.params.jobId);
    return { artifacts };
  });
}

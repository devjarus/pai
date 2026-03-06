import type { FastifyInstance } from "fastify";
import type { ServerContext } from "../index.js";
import { getArtifact, listArtifacts } from "@personal-ai/core";
import { marked } from "marked";

/** Escape HTML entities in user-supplied text */
function escapeHTML(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Strip json/jsonrender fenced blocks that are meant for the UI renderer, not humans */
function stripRenderBlocks(md: string): string {
  return md.replace(/```(?:json|jsonrender)\n[\s\S]*?```/g, "");
}

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

  // Render a markdown artifact as a styled HTML page (for viewing & printing)
  app.get<{ Params: { id: string } }>("/api/artifacts/:id/view", async (request, reply) => {
    const artifact = getArtifact(serverCtx.ctx.storage, request.params.id);
    if (!artifact) return reply.status(404).send({ error: "Artifact not found" });

    if (!artifact.mimeType.includes("markdown") && !artifact.name.endsWith(".md")) {
      // Non-markdown: redirect to raw download
      return reply.redirect(`/api/artifacts/${request.params.id}`);
    }

    const rawMd = artifact.data.toString("utf-8");
    const cleaned = stripRenderBlocks(rawMd);
    const htmlBody = await marked.parse(cleaned, { gfm: true, breaks: false });

    // Extract title from first H1 or filename
    const titleMatch = cleaned.match(/^#\s+(.+)/m);
    const title = titleMatch?.[1]?.trim() || artifact.name.replace(/\.md$/, "");

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHTML(title)}</title>
<style>
  :root { --bg: #fff; --fg: #1a1a2e; --muted: #6b7280; --border: #e5e7eb; --accent: #2563eb; --accent-bg: #eff6ff; --code-bg: #f3f4f6; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #0f172a; --fg: #e2e8f0; --muted: #94a3b8; --border: #334155; --accent: #60a5fa; --accent-bg: #1e293b; --code-bg: #1e293b; }
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: var(--fg); background: var(--bg); max-width: 900px; margin: 0 auto; padding: 2rem 1.5rem; line-height: 1.7; font-size: 15px; }
  h1 { font-size: 1.8rem; font-weight: 700; margin: 0 0 0.5rem; border-bottom: 2px solid var(--accent); padding-bottom: 0.5rem; }
  h2 { font-size: 1.4rem; font-weight: 600; margin: 2rem 0 0.75rem; color: var(--accent); }
  h3 { font-size: 1.15rem; font-weight: 600; margin: 1.5rem 0 0.5rem; }
  h4 { font-size: 1rem; font-weight: 600; margin: 1.2rem 0 0.4rem; color: var(--muted); }
  p { margin: 0.75rem 0; }
  ul, ol { margin: 0.5rem 0 0.5rem 1.5rem; }
  li { margin: 0.25rem 0; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  strong { font-weight: 600; }
  em { font-style: italic; }
  blockquote { border-left: 3px solid var(--accent); padding: 0.5rem 1rem; margin: 1rem 0; background: var(--accent-bg); border-radius: 0 6px 6px 0; }
  code { font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace; font-size: 0.9em; background: var(--code-bg); padding: 0.15em 0.4em; border-radius: 4px; }
  pre { background: var(--code-bg); padding: 1rem; border-radius: 8px; overflow-x: auto; margin: 1rem 0; }
  pre code { background: none; padding: 0; }
  hr { border: none; border-top: 1px solid var(--border); margin: 2rem 0; }
  table { width: 100%; border-collapse: collapse; margin: 1rem 0; font-size: 0.92em; }
  thead { background: var(--accent-bg); }
  th { font-weight: 600; text-align: left; padding: 0.6rem 0.8rem; border-bottom: 2px solid var(--accent); }
  td { padding: 0.5rem 0.8rem; border-bottom: 1px solid var(--border); }
  tr:hover { background: var(--accent-bg); }
  .report-meta { color: var(--muted); font-size: 0.85em; margin-bottom: 1.5rem; }
  .download-bar { display: flex; gap: 0.5rem; margin-bottom: 1.5rem; }
  .download-bar a { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.4rem 0.8rem; border: 1px solid var(--border); border-radius: 6px; font-size: 0.85em; color: var(--fg); transition: background 0.15s; }
  .download-bar a:hover { background: var(--accent-bg); text-decoration: none; }
  @media print {
    body { max-width: 100%; padding: 0; font-size: 12pt; }
    .download-bar { display: none; }
    h1 { font-size: 18pt; }
    h2 { font-size: 14pt; break-after: avoid; }
    table { font-size: 10pt; }
    tr { break-inside: avoid; }
  }
</style>
</head>
<body>
<div class="download-bar">
  <a href="/api/artifacts/${escapeHTML(request.params.id)}" download>Download Markdown</a>
  <a href="javascript:window.print()">Print / Save as PDF</a>
</div>
${htmlBody}
</body>
</html>`;

    return reply
      .header("Content-Type", "text/html; charset=utf-8")
      .header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'")
      .header("Cache-Control", "public, max-age=3600")
      .send(html);
  });

  // List artifacts for a job
  app.get<{ Params: { jobId: string } }>("/api/jobs/:jobId/artifacts", async (request) => {
    const artifacts = listArtifacts(serverCtx.ctx.storage, request.params.jobId);
    return { artifacts };
  });
}

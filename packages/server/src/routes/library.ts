import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ServerContext } from "../index.js";
import { validate } from "../validate.js";
import {
  unifiedSearch,
  listBeliefs,
  getBeliefHistory,
  forgetBelief,
  remember,
  memoryStats,
  listSources,
  forgetSource,
  learnFromContent,
  listFindings,
  listFindingsForWatch,
  getFinding,
  deleteFinding,
} from "@personal-ai/library";
import type { Belief } from "@personal-ai/library";
import { fetchPageAsMarkdown } from "@personal-ai/plugin-assistant/page-fetch";

const rememberSchema = z.object({
  text: z.string().min(1, "text is required").max(10_000, "Text too long (max 10,000 characters)"),
});

const learnUrlSchema = z.object({
  url: z
    .string()
    .min(1, "URL is required")
    .max(2048, "URL too long (max 2,048 characters)")
    .url("Invalid URL format")
    .refine((u) => {
      try { return ["http:", "https:"].includes(new URL(u).protocol); } catch { return false; }
    }, "URL must use http or https"),
  force: z.boolean().optional(),
});

export function registerLibraryRoutes(app: FastifyInstance, { ctx }: ServerContext): void {
  // --- Unified search ---
  app.get<{ Querystring: { q: string; limit?: string } }>("/api/library/search", async (request) => {
    const query = request.query.q;
    if (!query) return [];
    const limit = request.query.limit ? parseInt(request.query.limit, 10) : 20;
    return unifiedSearch(ctx.storage, query, limit);
  });

  // --- Memories (beliefs) ---
  app.get<{ Querystring: { status?: string } }>("/api/library/memories", async (request) => {
    const status = request.query.status ?? "active";
    return listBeliefs(ctx.storage, status);
  });

  app.get<{ Params: { id: string } }>("/api/library/memories/:id", async (request, reply) => {
    const beliefs = listBeliefs(ctx.storage, "all");
    const belief = beliefs.find((b: Belief) => b.id === request.params.id || b.id.startsWith(request.params.id));
    if (!belief) return reply.status(404).send({ error: "Belief not found" });
    const history = getBeliefHistory(ctx.storage, belief.id);
    return { ...belief, history };
  });

  app.post("/api/library/memories", async (request) => {
    const { text } = validate(rememberSchema, request.body);
    const result = await remember(ctx.storage, ctx.llm, text, ctx.logger);
    return result;
  });

  app.delete<{ Params: { id: string } }>("/api/library/memories/:id", async (request) => {
    forgetBelief(ctx.storage, request.params.id);
    return { ok: true };
  });

  // --- Documents (knowledge sources) ---
  app.get("/api/library/documents", async () => {
    return listSources(ctx.storage).map((s) => ({
      id: s.id,
      title: s.title,
      url: s.url,
      chunks: s.chunk_count,
      learnedAt: s.fetched_at,
      tags: s.tags ?? null,
      maxAgeDays: s.max_age_days ?? null,
    }));
  });

  app.post<{ Body: { url: string; force?: boolean } }>("/api/library/documents/url", async (request, reply) => {
    const { url, force } = validate(learnUrlSchema, request.body);

    try {
      const page = await fetchPageAsMarkdown(url);
      if (!page) return reply.status(422).send({ error: "Could not extract content from URL" });

      const result = await learnFromContent(ctx.storage, ctx.llm, url, page.title, page.markdown, { force });
      const response: Record<string, unknown> = {
        ok: true,
        title: result.source.title,
        url: result.source.url,
      };

      if (result.skipped) {
        response.skipped = true;
      } else {
        response.chunks = result.chunksStored;
      }

      return response;
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : "Failed to learn from URL" });
    }
  });

  app.delete<{ Params: { id: string } }>("/api/library/documents/:id", async (request, reply) => {
    const removed = forgetSource(ctx.storage, request.params.id);
    if (!removed) return reply.status(404).send({ error: "Source not found" });
    return { ok: true };
  });

  // --- Findings ---
  app.get<{ Querystring: { watchId?: string } }>("/api/library/findings", async (request) => {
    if (request.query.watchId) {
      return listFindingsForWatch(ctx.storage, request.query.watchId);
    }
    return listFindings(ctx.storage);
  });

  app.get<{ Params: { id: string } }>("/api/library/findings/:id", async (request, reply) => {
    const finding = getFinding(ctx.storage, request.params.id);
    if (!finding) return reply.status(404).send({ error: "Finding not found" });
    return finding;
  });

  app.delete<{ Params: { id: string } }>("/api/library/findings/:id", async (request, reply) => {
    const finding = getFinding(ctx.storage, request.params.id);
    if (!finding) return reply.status(404).send({ error: "Finding not found" });
    deleteFinding(ctx.storage, request.params.id);
    return { ok: true };
  });

  // --- Stats ---
  app.get("/api/library/stats", async () => {
    const stats = memoryStats(ctx.storage);
    const documents = listSources(ctx.storage);
    const findings = listFindings(ctx.storage);
    return {
      ...stats,
      documentsCount: documents.length,
      findingsCount: findings.length,
    };
  });

  // --- 301 Redirects from old paths ---
  // When the legacy memory.ts and knowledge.ts route files are removed,
  // uncomment these redirects to preserve backward compatibility:
  //
  // GET  /api/beliefs          -> /api/library/memories
  // POST /api/remember         -> /api/library/memories
  // GET  /api/stats            -> /api/library/stats
  // GET  /api/knowledge/sources -> /api/library/documents
  // POST /api/knowledge/learn   -> /api/library/documents/url
  // GET  /api/knowledge/search  -> /api/library/search
}

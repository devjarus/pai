import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ServerContext } from "../index.js";
import { validate } from "../validate.js";
import { learnFromContent, knowledgeSearch, listSources, getSourceChunks, forgetSource, reindexSource, reindexAllSources } from "@personal-ai/core";
import { fetchPageAsMarkdown, discoverSubPages } from "@personal-ai/plugin-assistant/page-fetch";
import { runCrawlInBackground } from "@personal-ai/plugin-assistant/tools";
import { activeJobs } from "@personal-ai/core";

const learnSchema = z.object({
  url: z
    .string()
    .min(1, "URL is required")
    .max(2048, "URL too long (max 2,048 characters)")
    .url("Invalid URL format")
    .refine((u) => {
      try { return ["http:", "https:"].includes(new URL(u).protocol); } catch { return false; }
    }, "URL must use http or https"),
  crawl: z.boolean().optional(),
  force: z.boolean().optional(),
});

const patchSourceSchema = z.object({
  tags: z.string().nullable(),
});

export function registerKnowledgeRoutes(app: FastifyInstance, { ctx }: ServerContext): void {
  // List learned sources
  app.get("/api/knowledge/sources", async () => {
    return listSources(ctx.storage).map((s) => ({
      id: s.id,
      title: s.title,
      url: s.url,
      chunks: s.chunk_count,
      learnedAt: s.fetched_at,
      tags: s.tags ?? null,
    }));
  });

  // Update source tags
  app.patch<{ Params: { id: string }; Body: { tags: string | null } }>("/api/knowledge/sources/:id", async (request, reply) => {
    const { id } = request.params;
    const { tags } = validate(patchSourceSchema, request.body);
    const sources = listSources(ctx.storage);
    const source = sources.find((s) => s.id === id);
    if (!source) return reply.status(404).send({ error: "Source not found" });
    ctx.storage.run("UPDATE knowledge_sources SET tags = ? WHERE id = ?", [tags ?? null, id]);
    return { ok: true };
  });

  // Search knowledge base
  app.get<{ Querystring: { q: string } }>("/api/knowledge/search", async (request) => {
    const query = request.query.q;
    if (!query) return [];
    try {
      const results = await knowledgeSearch(ctx.storage, ctx.llm, query);
      return results.map((r) => ({
        content: r.chunk.content.slice(0, 1000),
        source: r.source.title,
        url: r.source.url,
        sourceId: r.source.id,
        relevance: Math.round(r.score * 100),
      }));
    } catch {
      return [];
    }
  });

  // Learn from URL (with optional crawl and force re-learn)
  app.post<{ Body: { url: string; crawl?: boolean; force?: boolean } }>("/api/knowledge/learn", async (request, reply) => {
    const { url, crawl, force } = validate(learnSchema, request.body);

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

      // Optionally crawl sub-pages in background
      if (crawl) {
        const subPages = await discoverSubPages(url);
        if (subPages.length > 0) {
          runCrawlInBackground(ctx.storage, ctx.llm, url, subPages).catch(() => {});
          response.crawling = true;
          response.subPages = Math.min(subPages.length, 30);
        }
      }

      return response;
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : "Failed to learn from URL" });
    }
  });

  // Crawl sub-pages for an existing source
  app.post<{ Params: { id: string } }>("/api/knowledge/sources/:id/crawl", async (request, reply) => {
    const { id } = request.params;
    const sources = listSources(ctx.storage);
    const source = sources.find((s) => s.id === id);
    if (!source) return reply.status(404).send({ error: "Source not found" });

    try {
      const subPages = await discoverSubPages(source.url);
      if (subPages.length === 0) {
        return { ok: true, subPages: 0, message: "No sub-pages found" };
      }
      runCrawlInBackground(ctx.storage, ctx.llm, source.url, subPages).catch(() => {});
      return { ok: true, subPages: Math.min(subPages.length, 30), crawling: true };
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : "Failed to discover sub-pages" });
    }
  });

  // Crawl status — check progress and get failed URLs
  app.get("/api/knowledge/crawl-status", async () => {
    const crawlJobs = [...activeJobs.entries()]
      .filter(([, j]) => j.type === "crawl")
      .map(([_id, j]) => ({
        url: j.label,
        status: j.status,
        progress: j.progress,
        startedAt: j.startedAt,
        ...(j.error ? { error: j.error } : {}),
        ...(j.result ? { result: j.result } : {}),
      }));

    // Clean up completed jobs older than 30 minutes
    const cutoff = Date.now() - 30 * 60 * 1000;
    for (const [id, j] of activeJobs) {
      if (j.type === "crawl" && j.status !== "running" && new Date(j.startedAt).getTime() < cutoff) {
        activeJobs.delete(id);
      }
    }

    return { jobs: crawlJobs };
  });

  // Get chunks for a source
  app.get<{ Params: { id: string } }>("/api/knowledge/sources/:id/chunks", async (request, reply) => {
    const { id } = request.params;
    const chunks = getSourceChunks(ctx.storage, id);
    if (chunks.length === 0) {
      const sources = listSources(ctx.storage);
      if (!sources.some((s) => s.id === id)) {
        return reply.status(404).send({ error: "Source not found" });
      }
    }
    return chunks.map((c) => ({
      id: c.id,
      content: c.content,
      chunkIndex: c.chunk_index,
    }));
  });

  // Re-index all sources with contextual chunk headers
  app.post("/api/knowledge/reindex", async (_request, reply) => {
    try {
      const count = await reindexAllSources(ctx.storage, ctx.llm);
      return { ok: true, reindexed: count };
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : "Failed to re-index" });
    }
  });

  // Re-index a single source
  app.post<{ Params: { id: string } }>("/api/knowledge/sources/:id/reindex", async (request, reply) => {
    const { id } = request.params;
    try {
      const chunks = await reindexSource(ctx.storage, ctx.llm, id);
      return { ok: true, chunks };
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Source not found")) {
        return reply.status(404).send({ error: "Source not found" });
      }
      return reply.status(500).send({ error: err instanceof Error ? err.message : "Failed to re-index source" });
    }
  });

  // Delete a learned source
  app.delete<{ Params: { id: string } }>("/api/knowledge/sources/:id", async (request, reply) => {
    const { id } = request.params;
    const removed = forgetSource(ctx.storage, id);
    if (!removed) return reply.status(404).send({ error: "Source not found" });
    return { ok: true };
  });
}

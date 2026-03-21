import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ServerContext } from "../index.js";
import { validate } from "../validate.js";
import {
  unifiedSearch,
  listBeliefs,
  getBeliefHistory,
  listBeliefProvenance,
  searchBeliefs,
  semanticSearch,
  forgetBelief,
  correctBelief,
  remember,
  memoryStats,
  listSources,
  getSourceChunks,
  forgetSource,
  learnFromContent,
  listFindings,
  listFindingsForWatch,
  getFinding,
  deleteFinding,
} from "@personal-ai/library";
import type { Belief } from "@personal-ai/library";
import {
  recordProductEvent,
  updateBeliefContent,
  knowledgeSearch,
  reindexSource,
  reindexAllSources,
  isBinaryDocument,
  parseBinaryDocument,
  listJobs,
  clearCompletedBackgroundJobs,
} from "@personal-ai/core";
import { fetchPageAsMarkdown, discoverSubPages } from "@personal-ai/plugin-assistant/page-fetch";
import { runCrawlInBackground } from "@personal-ai/plugin-assistant/tools";

// --- Schemas ---

const rememberSchema = z.object({
  text: z.string().min(1, "text is required").max(10_000, "Text too long (max 10,000 characters)"),
});

const updateBeliefSchema = z.object({
  statement: z.string().min(1, "statement is required").max(10_000, "Statement too long"),
});

const correctBeliefSchema = z.object({
  statement: z.string().min(1, "statement is required").max(10_000, "Statement too long"),
  note: z.string().max(5_000, "Note too long").optional(),
  briefId: z.string().max(255).optional(),
  programId: z.string().max(255).optional(),
  threadId: z.string().max(255).optional(),
  channel: z.string().max(32).optional(),
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
  crawl: z.boolean().optional(),
  force: z.boolean().optional(),
});

const uploadSchema = z.object({
  fileName: z.string().min(1, "File name is required").max(255, "File name too long"),
  content: z.string().min(1, "File content is required").max(5_000_000, "File too large (max 5MB)"),
  mimeType: z.string().optional(),
  analyze: z.boolean().optional(),
});

const patchSourceSchema = z.object({
  tags: z.string().nullable().optional(),
  maxAgeDays: z.number().int().positive().nullable().optional(),
});

export function registerLibraryRoutes(app: FastifyInstance, { ctx }: ServerContext): void {
  // --- Unified search ---
  app.get<{ Querystring: { q: string; limit?: string } }>("/api/library/search", async (request) => {
    const query = request.query.q;
    if (!query) return [];
    const limit = request.query.limit ? parseInt(request.query.limit, 10) : 20;
    return unifiedSearch(ctx.storage, query, limit);
  });

  // --- Document-specific search (knowledge base only, with freshness decay) ---
  app.get<{ Querystring: { q: string } }>("/api/library/documents/search", async (request) => {
    const query = request.query.q;
    if (!query) return [];
    try {
      const results = await knowledgeSearch(ctx.storage, ctx.llm, query, 5, {
        freshnessDecayDays: ctx.config.knowledge?.freshnessDecayDays,
      });
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

  // =============================================
  // Memories (beliefs) — static routes first
  // =============================================

  // Semantic search for memories
  app.get<{ Querystring: { q: string } }>("/api/library/memories/search", async (request) => {
    const query = request.query.q;
    if (!query) return [];

    try {
      const { embedding } = await ctx.llm.embed(query, {
        telemetry: { process: "embed.memory", surface: "web", route: "/api/library/memories/search" },
      });
      const results = semanticSearch(ctx.storage, embedding, 20, query);
      return results.map((r) => {
        const full = ctx.storage.query<Belief>(
          "SELECT * FROM beliefs WHERE id = ?", [r.beliefId],
        )[0];
        return full ? { ...full, similarity: r.similarity } : null;
      }).filter(Boolean);
    } catch {
      return searchBeliefs(ctx.storage, query);
    }
  });

  // Clear all active beliefs
  app.post("/api/library/memories/clear", async () => {
    const active = listBeliefs(ctx.storage, "active");
    let cleared = 0;
    for (const belief of active) {
      try {
        forgetBelief(ctx.storage, belief.id);
        cleared++;
      } catch {
        // skip beliefs that fail
      }
    }
    return { ok: true, cleared };
  });

  // List memories with optional status and type filters
  app.get<{ Querystring: { status?: string; type?: string } }>("/api/library/memories", async (request) => {
    const status = request.query.status ?? "active";
    let beliefs = listBeliefs(ctx.storage, status);
    if (request.query.type) {
      beliefs = beliefs.filter((b: Belief) => b.type === request.query.type);
    }
    return beliefs;
  });

  // Create a memory
  app.post("/api/library/memories", async (request) => {
    const { text } = validate(rememberSchema, request.body);
    const result = await remember(ctx.storage, ctx.llm, text, ctx.logger);
    return result;
  });

  // Get single memory with history
  app.get<{ Params: { id: string } }>("/api/library/memories/:id", async (request, reply) => {
    const beliefs = listBeliefs(ctx.storage, "all");
    const belief = beliefs.find((b: Belief) => b.id === request.params.id || b.id.startsWith(request.params.id));
    if (!belief) return reply.status(404).send({ error: "Belief not found" });
    const history = getBeliefHistory(ctx.storage, belief.id);
    return { ...belief, history };
  });

  // Get memory history
  app.get<{ Params: { id: string } }>("/api/library/memories/:id/history", async (request, reply) => {
    const beliefs = listBeliefs(ctx.storage, "all");
    const belief = beliefs.find((entry: Belief) => entry.id === request.params.id || entry.id.startsWith(request.params.id));
    if (!belief) return reply.status(404).send({ error: "Belief not found" });
    return { history: getBeliefHistory(ctx.storage, belief.id) };
  });

  // Get memory provenance
  app.get<{ Params: { id: string } }>("/api/library/memories/:id/provenance", async (request, reply) => {
    const beliefs = listBeliefs(ctx.storage, "all");
    const belief = beliefs.find((entry: Belief) => entry.id === request.params.id || entry.id.startsWith(request.params.id));
    if (!belief) return reply.status(404).send({ error: "Belief not found" });
    return { provenance: listBeliefProvenance(ctx.storage, belief.id) };
  });

  // Update belief statement
  app.patch<{ Params: { id: string } }>("/api/library/memories/:id", async (request, reply) => {
    const { statement } = validate(updateBeliefSchema, request.body);
    try {
      const updated = await updateBeliefContent(ctx.storage, ctx.llm, request.params.id, statement);
      return updated;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update belief";
      const status = message.includes("not found") ? 404 : 500;
      return reply.status(status).send({ error: message });
    }
  });

  // Correct a belief
  app.post<{ Params: { id: string } }>("/api/library/memories/:id/correct", async (request, reply) => {
    const { statement, note, briefId, programId, threadId, channel } = validate(correctBeliefSchema, request.body);
    try {
      const result = await correctBelief(ctx.storage, ctx.llm, request.params.id, { statement, note });
      recordProductEvent(ctx.storage, {
        eventType: "belief_corrected",
        channel: channel ?? "web",
        programId: programId ?? null,
        briefId: briefId ?? null,
        beliefId: result.replacementBelief.id,
        threadId: threadId ?? null,
      });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to correct belief";
      const normalized = message.toLowerCase();
      const status = normalized.includes("not found")
        ? 404
        : normalized.includes("ambiguous") || normalized.includes("must change")
          ? 400
          : 500;
      return reply.status(status).send({ error: message });
    }
  });

  // Delete a memory
  app.delete<{ Params: { id: string } }>("/api/library/memories/:id", async (request) => {
    forgetBelief(ctx.storage, request.params.id);
    return { ok: true };
  });

  // =============================================
  // Documents (knowledge sources) — static routes first
  // =============================================

  // Upload a document (text, PDF, Excel)
  app.post<{ Body: { fileName: string; content: string; mimeType?: string; analyze?: boolean } }>("/api/library/documents/upload", { bodyLimit: 5_242_880 }, async (request, reply) => {
    const { fileName, content, mimeType, analyze } = validate(uploadSchema, request.body);
    const ext = fileName.split(".").pop()?.toLowerCase();
    const textSupported = new Set(["txt", "md", "markdown", "csv", "json", "xml", "html"]);
    const binarySupported = new Set(["pdf", "xlsx", "xls", "xlsm", "xlsb"]);
    if (ext && !textSupported.has(ext) && !binarySupported.has(ext)) {
      return reply.status(415).send({
        error: "Unsupported file type. Supported: .txt, .md, .csv, .json, .xml, .html, .pdf, .xlsx, .xls",
      });
    }

    const safeName = fileName.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 120);
    const sourceUrl = `upload://${Date.now()}-${safeName}`;

    try {
      // For binary formats, decode base64 and extract text
      let textContent: string;
      const mime = mimeType ?? "text/plain";
      if (isBinaryDocument(mime, fileName)) {
        const buffer = Buffer.from(content, "base64");
        textContent = await parseBinaryDocument(buffer, mime, fileName);
        if (!textContent.trim()) {
          return reply.status(422).send({ error: "Could not extract text content from the document" });
        }
      } else {
        textContent = content;
      }

      const result = await learnFromContent(ctx.storage, ctx.llm, sourceUrl, fileName, textContent, { force: true });
      let analysis: string | undefined;
      if (analyze) {
        const snippet = textContent.length > 12_000 ? `${textContent.slice(0, 12_000)}\n\n[truncated]` : textContent;
        const response = await ctx.llm.chat([
          {
            role: "system",
            content: "You analyze uploaded documents. Return concise markdown with: Summary, Key points (3-7 bullets), and Suggested follow-up questions.",
          },
          {
            role: "user",
            content: `Analyze this document. File: ${fileName}. MIME: ${mime}\n\n${snippet}`,
          },
        ], {
          telemetry: {
            process: "memory.summarize",
            surface: "web",
            route: "/api/library/documents/upload",
          },
        });
        analysis = response.text;
      }

      return {
        ok: true,
        title: result.source.title,
        sourceId: result.source.id,
        chunks: result.chunksStored,
        analysis,
      };
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : "Failed to process uploaded document" });
    }
  });

  // Crawl status
  app.get("/api/library/documents/crawl-status", async () => {
    // Clean up completed jobs older than 30 minutes
    clearCompletedBackgroundJobs(ctx.storage, 30 * 60 * 1000);

    const crawlJobs = listJobs(ctx.storage)
      .filter((j) => j.type === "crawl")
      .map((j) => ({
        url: j.label,
        status: j.status,
        progress: j.progress,
        startedAt: j.startedAt,
        ...(j.error ? { error: j.error } : {}),
        ...(j.result ? { result: j.result } : {}),
      }));

    return { jobs: crawlJobs };
  });

  // Re-index all sources
  app.post("/api/library/documents/reindex", async (_request, reply) => {
    try {
      const count = await reindexAllSources(ctx.storage, ctx.llm);
      return { ok: true, reindexed: count };
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : "Failed to re-index" });
    }
  });

  // Learn from URL (with optional crawl and force re-learn)
  app.post<{ Body: { url: string; crawl?: boolean; force?: boolean } }>("/api/library/documents/url", async (request, reply) => {
    const { url, crawl, force } = validate(learnUrlSchema, request.body);

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

  // List documents
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

  // Get chunks for a source
  app.get<{ Params: { id: string } }>("/api/library/documents/:id/chunks", async (request, reply) => {
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

  // Update source metadata (tags, maxAgeDays)
  app.patch<{ Params: { id: string }; Body: { tags?: string | null; maxAgeDays?: number | null } }>("/api/library/documents/:id", async (request, reply) => {
    const { id } = request.params;
    const body = validate(patchSourceSchema, request.body);
    const sources = listSources(ctx.storage);
    const source = sources.find((s) => s.id === id);
    if (!source) return reply.status(404).send({ error: "Source not found" });

    const sets: string[] = [];
    const params: unknown[] = [];
    if (body.tags !== undefined) { sets.push("tags = ?"); params.push(body.tags ?? null); }
    if (body.maxAgeDays !== undefined) { sets.push("max_age_days = ?"); params.push(body.maxAgeDays ?? null); }

    if (sets.length > 0) {
      params.push(id);
      ctx.storage.run(`UPDATE knowledge_sources SET ${sets.join(", ")} WHERE id = ?`, params);
    }
    return { ok: true };
  });

  // Crawl sub-pages for an existing source
  app.post<{ Params: { id: string } }>("/api/library/documents/:id/crawl", async (request, reply) => {
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

  // Re-index a single source
  app.post<{ Params: { id: string } }>("/api/library/documents/:id/reindex", async (request, reply) => {
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

  // Delete a document
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

  // --- Profile summary ---
  app.get("/api/library/profile", async () => {
    const allBeliefs = listBeliefs(ctx.storage, "active");

    // Build profile from beliefs, grouped by category
    const categories = {
      identity: [] as string[],
      interests: [] as string[],
      style: [] as string[],
      situation: [] as string[],
      relationships: [] as string[],
    };

    for (const belief of allBeliefs) {
      const stmt = belief.statement.toLowerCase();
      const s = belief.statement;

      // Identity: name, profession, location
      if (/\b(name|lives? in|works? at|engineer|developer|citizen|from)\b/i.test(stmt)) {
        categories.identity.push(s);
      }
      // Relationships: wife, family, people
      else if (/\b(wife|husband|married|family|friend|monica|relationship)\b/i.test(stmt)) {
        categories.relationships.push(s);
      }
      // Style: communication preferences
      else if (/\b(prefer|concise|brief|actionable|format|style|tone|delta|report)\b/i.test(stmt) && belief.type === "preference") {
        categories.style.push(s);
      }
      // Situation: current events, pending items
      else if (/\b(visa|appointment|waiting|tracking|planning|pending)\b/i.test(stmt)) {
        categories.situation.push(s);
      }
      // Interests: topics they care about
      else if (/\b(interest|crypto|bitcoin|news|immigration|AI|stock|invest)\b/i.test(stmt)) {
        categories.interests.push(s);
      }
    }

    // Build summary lines — take top 3 per category, join
    const lines: string[] = [];

    if (categories.identity.length > 0) {
      lines.push(`**Identity:** ${categories.identity.slice(0, 3).join(". ")}`);
    }
    if (categories.relationships.length > 0) {
      lines.push(`**Relationships:** ${categories.relationships.slice(0, 3).join(". ")}`);
    }
    if (categories.interests.length > 0) {
      lines.push(`**Interests:** ${categories.interests.slice(0, 4).join(". ")}`);
    }
    if (categories.style.length > 0) {
      lines.push(`**Style:** ${categories.style.slice(0, 3).join(". ")}`);
    }
    if (categories.situation.length > 0) {
      lines.push(`**Current:** ${categories.situation.slice(0, 3).join(". ")}`);
    }

    return {
      summary: lines.join("\n"),
      categories: Object.fromEntries(
        Object.entries(categories).map(([k, v]) => [k, v.length]),
      ),
      totalBeliefs: allBeliefs.length,
      coreBeliefs: Object.values(categories).reduce((sum, arr) => sum + Math.min(arr.length, 3), 0),
    };
  });

  // --- Topic Insights ---
  app.get<{ Querystring: { watchId?: string } }>("/api/library/insights", async (request) => {
    const { listInsights: listInsightsFn } = await import("@personal-ai/library");
    return listInsightsFn(ctx.storage, request.query.watchId);
  });

  // Manually trigger compounding (generates insights from existing findings)
  app.post("/api/library/insights/refresh", async () => {
    const { runWeeklyCompounding } = await import("../compounding.js");
    const result = await runWeeklyCompounding(ctx as never);
    return result;
  });

  app.delete<{ Params: { id: string } }>("/api/library/insights/:id", async (request, reply) => {
    const { deleteInsight: deleteInsightFn } = await import("@personal-ai/library");
    const ok = deleteInsightFn(ctx.storage, request.params.id);
    if (!ok) return reply.status(404).send({ error: "Insight not found" });
    return { ok: true };
  });

  // --- Quality Score ---
  app.get("/api/library/quality", async () => {
    const allBeliefs = listBeliefs(ctx.storage, "active");
    const neverAccessed = allBeliefs.filter((b) => b.access_count === 0).length;
    const reinforced = allBeliefs.filter((b) => b.confidence > 0.6).length;
    const forgotten = listBeliefs(ctx.storage, "forgotten").length;
    const invalidated = listBeliefs(ctx.storage, "invalidated").length;

    let avgRating: number | null = null;
    let digetsRated = 0;
    try {
      const { getAverageRating: getAvg } = await import("../digest-ratings.js");
      avgRating = getAvg(ctx.storage, 20);
      digetsRated = ctx.storage.query<{ cnt: number }>("SELECT COUNT(*) as cnt FROM digest_ratings")[0]?.cnt ?? 0;
    } catch { /* table may not exist */ }

    let corrections = 0;
    try {
      corrections = ctx.storage.query<{ cnt: number }>("SELECT COUNT(*) as cnt FROM belief_changes WHERE change_type = 'invalidated'")[0]?.cnt ?? 0;
    } catch { /* table may not exist */ }

    let insightsCount = 0;
    try {
      const { listInsights: li } = await import("@personal-ai/library");
      insightsCount = li(ctx.storage).length;
    } catch { /* table may not exist */ }

    let findingsCount = 0;
    try { findingsCount = listFindings(ctx.storage).length; } catch { /* */ }

    const programs = ctx.storage.query<{ status: string }>("SELECT status FROM scheduled_jobs WHERE status != 'deleted'");
    const watchesActive = programs.filter((p) => p.status === "active").length;

    // Compute quality scores (0-100)
    const memoryUtilization = allBeliefs.length > 0 ? Math.round(((allBeliefs.length - neverAccessed) / allBeliefs.length) * 100) : 0;
    const reinforcementRate = allBeliefs.length > 0 ? Math.round((reinforced / allBeliefs.length) * 100) : 0;
    const feedbackActivity = Math.min(100, digetsRated * 10 + corrections * 20);
    const knowledgeGrowth = Math.min(100, insightsCount * 5 + findingsCount);
    const overallScore = Math.round((memoryUtilization + reinforcementRate + feedbackActivity + knowledgeGrowth) / 4);

    return {
      score: overallScore,
      memory: {
        total: allBeliefs.length,
        neverAccessed,
        reinforced,
        forgotten,
        invalidated,
        utilization: memoryUtilization,
        reinforcementRate,
      },
      feedback: {
        digestsRated: digetsRated,
        avgRating,
        corrections,
        activity: feedbackActivity,
      },
      knowledge: {
        insights: insightsCount,
        findings: findingsCount,
        watchesActive,
        growth: knowledgeGrowth,
      },
    };
  });

  // --- Stats ---
  app.get("/api/library/stats", async () => {
    const stats = memoryStats(ctx.storage);
    const documents = listSources(ctx.storage);
    const findings = listFindings(ctx.storage);
    let insightsCount = 0;
    try {
      const { listInsights: listInsightsFn } = await import("@personal-ai/library");
      insightsCount = listInsightsFn(ctx.storage).length;
    } catch { /* table may not exist yet */ }
    return {
      ...stats,
      documentsCount: documents.length,
      findingsCount: findings.length,
      insightsCount,
    };
  });
}

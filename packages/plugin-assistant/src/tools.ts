import { tool } from "ai";
import { z } from "zod";
import type { AgentContext } from "@personal-ai/core";
import { retrieveContext, remember, listBeliefs, searchBeliefs, forgetBelief, learnFromContent, knowledgeSearch, listSources, forgetSource } from "@personal-ai/core";
import type { Storage, LLMClient } from "@personal-ai/core";
import { activeJobs } from "@personal-ai/core";
import type { BackgroundJob } from "@personal-ai/core";
import { addTask, listTasks, completeTask } from "@personal-ai/plugin-tasks";
import { webSearch, formatSearchResults } from "./web-search.js";
import { fetchPageAsMarkdown, discoverSubPages } from "./page-fetch.js";

export async function runCrawlInBackground(storage: Storage, llm: LLMClient, rootUrl: string, subPages: string[]): Promise<void> {
  const maxPages = Math.min(subPages.length, 30);
  const jobId = `crawl-${rootUrl}`;
  const job: BackgroundJob = {
    id: jobId,
    type: "crawl",
    label: rootUrl,
    status: "running",
    progress: `0/${maxPages}`,
    startedAt: new Date().toISOString(),
  };
  activeJobs.set(jobId, job);

  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let learned = 0;
  let skipped = 0;
  let failed = 0;

  try {
    for (let i = 0; i < maxPages; i++) {
      // Spread requests: wait 1s between pages to avoid overwhelming target server
      if (i > 0) await delay(1000);
      try {
        const pageUrl = subPages[i]!;
        const subPage = await fetchPageAsMarkdown(pageUrl);
        if (!subPage) { failed++; continue; }
        const result = await learnFromContent(storage, llm, pageUrl, subPage.title, subPage.markdown);
        if (result.skipped) skipped++;
        else learned++;
      } catch {
        failed++;
      }
      job.progress = `${learned + skipped + failed}/${maxPages}`;
    }
    job.status = "done";
    job.result = `Learned: ${learned}, Skipped: ${skipped}, Failed: ${failed}`;
  } catch (err) {
    job.status = "error";
    job.error = err instanceof Error ? err.message : String(err);
  }
}

export function createAgentTools(ctx: AgentContext) {
  return {
    memory_recall: tool({
      description: "Search your memory for beliefs, preferences, and past observations relevant to a query. This searches ONLY memory (beliefs + episodes), not the knowledge base. Use knowledge_search separately for learned web pages.",
      inputSchema: z.object({
        query: z.string().describe("What to look up in memory"),
      }),
      execute: async ({ query }) => {
        const result = await retrieveContext(ctx.storage, query, { llm: ctx.llm, knowledgeLimit: 0 });

        // Supplement with direct text search for short/name queries that embeddings miss
        const ftsResults = searchBeliefs(ctx.storage, query, 5);
        if (ftsResults.length > 0) {
          const ftsSection = ftsResults
            .map((b) => {
              const subj = b.subject && b.subject !== "owner" ? ` [about: ${b.subject}]` : "";
              return `- [${b.type}|${b.confidence.toFixed(1)}]${subj} ${b.statement}`;
            })
            .join("\n");
          // Avoid duplicating if FTS results are already in the formatted context
          if (!ftsSection.split("\n").every(line => result.formatted.includes(line.replace(/^- /, "").trim()))) {
            return `${result.formatted}\n\n## Text search matches\n${ftsSection}`;
          }
        }

        return result.formatted || "[empty] No memories match this query. Try knowledge_search or answer from conversation context.";
      },
    }),

    memory_remember: tool({
      description: "Store a new fact, preference, or decision in long-term memory. Use this when the user shares something worth remembering for future conversations.",
      inputSchema: z.object({
        text: z.string().describe("The observation, fact, or preference to store"),
      }),
      execute: async ({ text }) => {
        try {
          const result = await remember(ctx.storage, ctx.llm, text, ctx.logger);
          if (result.isReinforcement) {
            return "Stored successfully. This reinforced an existing memory, making it stronger.";
          }
          return `Stored successfully. ${result.beliefIds.length} new belief(s) saved to memory.`;
        } catch (err) {
          return `Failed to store memory: ${err instanceof Error ? err.message : "unknown error"}`;
        }
      },
    }),

    memory_beliefs: tool({
      description: "List all active beliefs stored in memory. Use this to see what has been remembered.",
      inputSchema: z.object({
        status: z.enum(["active", "forgotten"]).default("active").describe("Filter by belief status"),
      }),
      execute: async ({ status }) => {
        const beliefs = listBeliefs(ctx.storage, status);
        if (beliefs.length === 0) return "No beliefs found.";
        return beliefs.map((b) => ({
          id: b.id.slice(0, 8),
          type: b.type,
          statement: b.statement,
          confidence: Math.round(b.confidence * 100) + "%",
        }));
      },
    }),

    memory_forget: tool({
      description: "Forget (soft-delete) a belief by its ID or ID prefix. Use this when you discover a memory is incorrect, outdated, corrupted, or the user asks you to remove something from memory. The belief is preserved in history but won't be used for future recall.",
      inputSchema: z.object({
        beliefId: z.string().describe("Belief ID or prefix (first 8 characters)"),
        reason: z.string().optional().describe("Why this belief is being forgotten"),
      }),
      execute: async ({ beliefId, reason }) => {
        try {
          forgetBelief(ctx.storage, beliefId);
          return { ok: true, message: `Belief forgotten.${reason ? ` Reason: ${reason}` : ""}` };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : "Failed to forget belief" };
        }
      },
    }),

    web_search: tool({
      description: "Search the web for current information, news, prices, or facts. Use this when the user asks about recent events, current data, or anything you're unsure about.",
      inputSchema: z.object({
        query: z.string().describe("The search query"),
      }),
      execute: async ({ query }) => {
        if (ctx.config.webSearchEnabled === false) {
          return "Web search is disabled in settings. Answer based on your existing knowledge.";
        }
        try {
          const results = await webSearch(query, 5);
          if (results.length === 0) return "[empty] No web results found. Answer from your existing knowledge and conversation context.";
          return formatSearchResults(results);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "unknown error";
          return `Web search unavailable (${msg}). Answer based on your existing knowledge and note that you could not verify with a web search.`;
        }
      },
    }),

    task_list: tool({
      description: "List the user's tasks. Use when they ask about their tasks, to-dos, or what they need to work on.",
      inputSchema: z.object({
        status: z.enum(["open", "done", "all"]).default("open").describe("Filter by task status"),
      }),
      execute: async ({ status }) => {
        const tasks = listTasks(ctx.storage, status);
        if (tasks.length === 0) return `No ${status === "all" ? "" : status + " "}tasks found.`;
        return tasks.map((t) => ({
          id: t.id.slice(0, 8),
          title: t.title,
          priority: t.priority,
          status: t.status,
          dueDate: t.due_date,
        }));
      },
    }),

    task_add: tool({
      description: "Create a new task for the user. Use when they want to add something to their to-do list.",
      inputSchema: z.object({
        title: z.string().describe("Task title"),
        priority: z.enum(["low", "medium", "high"]).default("medium").describe("Task priority"),
        dueDate: z.string().optional().describe("Due date in YYYY-MM-DD format"),
      }),
      execute: async ({ title, priority, dueDate }) => {
        try {
          const task = addTask(ctx.storage, { title, priority, dueDate });
          return { ok: true, id: task.id.slice(0, 8), title: task.title, priority: task.priority };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : "Failed to add task" };
        }
      },
    }),

    task_done: tool({
      description: "Mark a task as complete by its ID or ID prefix.",
      inputSchema: z.object({
        taskId: z.string().describe("Task ID or prefix"),
      }),
      execute: async ({ taskId }) => {
        try {
          completeTask(ctx.storage, taskId);
          return { ok: true, message: "Task completed." };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : "Failed to complete task" };
        }
      },
    }),

    learn_from_url: tool({
      description: "Learn from a web page — fetch it, extract content, and store in the knowledge base. Use when the user shares a URL and wants you to learn from it. Set crawl=true to also discover and learn from sub-pages (for doc sites) — crawling runs in the background. Use label to tag the source (e.g. person's name, topic, category).",
      inputSchema: z.object({
        url: z.string().url().describe("The URL to learn from"),
        crawl: z.boolean().default(false).describe("If true, discover and learn from sub-pages in the background (for doc sites)"),
        label: z.string().optional().describe("A label or tag for this source (e.g. 'Monica article', 'React docs', 'cooking recipe'). Helps find it later."),
      }),
      execute: async ({ url, crawl, label }) => {
        try {
          // Learn from the main page synchronously (fast enough)
          const page = await fetchPageAsMarkdown(url);
          if (!page) return "Could not extract content from that URL. The page may require JavaScript or is not an article.";

          const mainResult = await learnFromContent(ctx.storage, ctx.llm, url, page.title, page.markdown, { tags: label });
          const mainMsg = mainResult.skipped
            ? `Already learned from "${mainResult.source.title}".`
            : `Learned from "${mainResult.source.title}" — ${mainResult.chunksStored} chunks.`;

          if (!crawl) return mainMsg;

          // Discover sub-pages
          const subPages = await discoverSubPages(url);
          if (subPages.length === 0) {
            return `${mainMsg} No sub-pages found to crawl.`;
          }

          const maxPages = Math.min(subPages.length, 30);

          // Kick off crawling in background — don't await
          runCrawlInBackground(ctx.storage, ctx.llm, url, subPages).catch(() => {});

          return `${mainMsg}\n\nStarted crawling ${maxPages} sub-pages in the background. Use job_status to check progress.`;
        } catch (err) {
          return `Failed to learn from URL: ${err instanceof Error ? err.message : "unknown error"}`;
        }
      },
    }),

    knowledge_search: tool({
      description: "Search the knowledge base for information learned from web pages. Use this when the user asks about topics they've asked you to learn about. Call ONCE per question — do NOT call multiple times with different queries. One good search is enough.",
      inputSchema: z.object({
        query: z.string().describe("What to search for in the knowledge base"),
      }),
      execute: async ({ query }) => {
        try {
          const results = await knowledgeSearch(ctx.storage, ctx.llm, query, 3);
          if (results.length === 0) return "[empty] No knowledge matches this query. Answer from conversation context or try web_search.";

          // Return top 3 results with truncated content to keep context small
          return results.slice(0, 3).map((r) => ({
            content: r.chunk.content.slice(0, 300),
            source: r.source.title,
          }));
        } catch (err) {
          return `Knowledge search failed: ${err instanceof Error ? err.message : "unknown error"}`;
        }
      },
    }),

    knowledge_sources: tool({
      description: "List all URLs/pages stored in the knowledge base. Only use this when the user explicitly asks to see their sources — NOT for answering content questions (use knowledge_search for that).",
      inputSchema: z.object({}),
      execute: async () => {
        const sources = listSources(ctx.storage);
        if (sources.length === 0) return "Knowledge base is empty. Use learn_from_url to add content.";
        return sources.map((s) => ({
          id: s.id.slice(0, 8),
          title: s.title,
          url: s.url,
          ...(s.tags ? { tags: s.tags } : {}),
          chunks: s.chunk_count,
          learnedAt: s.fetched_at,
        }));
      },
    }),

    knowledge_forget: tool({
      description: "Remove a learned source and all its chunks from the knowledge base by source ID.",
      inputSchema: z.object({
        sourceId: z.string().describe("Source ID or prefix"),
      }),
      execute: async ({ sourceId }) => {
        // Support prefix matching
        const sources = listSources(ctx.storage);
        const match = sources.find((s) => s.id.startsWith(sourceId));
        if (!match) return { ok: false, error: "Source not found" };
        forgetSource(ctx.storage, match.id);
        return { ok: true, message: `Removed "${match.title}" and its ${match.chunk_count} chunks from knowledge base.` };
      },
    }),

    job_status: tool({
      description: "Check the status of background jobs (crawl, research). Use when the user asks about crawl progress, research status, or background tasks.",
      inputSchema: z.object({}),
      execute: async () => {
        if (activeJobs.size === 0) return "No background jobs running or recently completed.";

        const jobs = [...activeJobs.entries()].map(([id, j]) => ({
          id,
          type: j.type,
          label: j.label,
          status: j.status,
          progress: j.progress,
          startedAt: j.startedAt,
          ...(j.error ? { error: j.error } : {}),
          ...(j.result ? { result: j.result } : {}),
        }));

        // Clean up completed jobs older than 10 minutes
        const cutoff = Date.now() - 10 * 60 * 1000;
        for (const [id, j] of activeJobs) {
          if (j.status !== "running" && new Date(j.startedAt).getTime() < cutoff) {
            activeJobs.delete(id);
          }
        }

        return jobs;
      },
    }),
  };
}

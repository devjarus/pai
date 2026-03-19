import { tool } from "ai";
import { z } from "zod";
import { knowledgeSearch, createBrowserTools } from "@personal-ai/core";
import type { ResearchContext } from "./types.js";
import { updateResearchJob } from "./repository.js";

// ---- Budget-Limited Tool Factories ----

export function createResearchTools(
  ctx: ResearchContext,
  jobId: string,
  job: { budgetMaxSearches: number; budgetMaxPages: number },
) {
  let searchesUsed = 0;
  let pagesRead = 0;

  return {
    web_search: tool({
      description: "Search the web for information. Budget-limited.",
      inputSchema: z.object({
        query: z.string().describe("Search query"),
      }),
      execute: async ({ query }: { query: string }) => {
        if (searchesUsed >= job.budgetMaxSearches) {
          return "Budget exhausted — you've used all your web searches. Synthesize your findings into the report now.";
        }
        searchesUsed++;
        updateResearchJob(ctx.storage, jobId, { searches_used: searchesUsed });

        try {
          const results = await ctx.webSearch(query, 5);
          if (results.length === 0) return "No results found for this query.";
          return ctx.formatSearchResults(results);
        } catch (err) {
          return `Search failed: ${err instanceof Error ? err.message : "unknown error"}`;
        }
      },
    }),

    read_page: tool({
      description: "Fetch and read a web page to get detailed content. Budget-limited.",
      inputSchema: z.object({
        url: z.string().url().describe("URL to read"),
      }),
      execute: async ({ url }: { url: string }) => {
        if (pagesRead >= job.budgetMaxPages) {
          return "Budget exhausted — you've used all your page reads. Synthesize your findings into the report now.";
        }
        pagesRead++;
        updateResearchJob(ctx.storage, jobId, { pages_learned: pagesRead });

        try {
          const page = await ctx.fetchPage(url);
          if (!page) return "Could not extract content from this page.";
          return `# ${page.title}\n\n${page.markdown.slice(0, 3000)}`;
        } catch (err) {
          return `Failed to read page: ${err instanceof Error ? err.message : "unknown error"}`;
        }
      },
    }),

    knowledge_search: tool({
      description: "Search existing knowledge base for relevant information already learned.",
      inputSchema: z.object({
        query: z.string().describe("What to search for"),
      }),
      execute: async ({ query }: { query: string }) => {
        try {
          const results = await knowledgeSearch(ctx.storage, ctx.llm, query, 3);
          if (results.length === 0) return "No existing knowledge on this topic.";
          return results.slice(0, 3).map((r) => ({
            content: r.chunk.content.slice(0, 500),
            source: r.source.title,
          }));
        } catch {
          return "Knowledge search unavailable.";
        }
      },
    }),

    // Browser tools for JS-rendered pages (no screenshot — research doesn't need artifacts)
    ...createBrowserTools({ logger: ctx.logger, browserUrl: ctx.browserUrl }),
  };
}

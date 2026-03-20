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

    // Code execution — only available when sandbox is configured
    ...(ctx.sandboxUrl ? {
      run_code: tool({
        description: "Execute Python or Node.js code in a sandboxed environment. Use for data analysis, calculations, scraping dynamic pages, processing API responses, or generating charts. Python has matplotlib, pandas, numpy, requests available. Save output files to OUTPUT_DIR for artifacts.",
        inputSchema: z.object({
          language: z.enum(["python", "node"]).describe("Programming language"),
          code: z.string().describe("Code to execute"),
        }),
        execute: async ({ language, code }: { language: "python" | "node"; code: string }) => {
          try {
            const { runInSandbox, storeArtifact, guessMimeType } = await import("@personal-ai/core");
            const result = await runInSandbox({ language, code, timeout: 30 }, ctx.logger, ctx.sandboxUrl);

            let output = "";
            if (result.stdout) output += result.stdout.slice(0, 5000);
            if (result.stderr) output += `\nSTDERR: ${result.stderr.slice(0, 1000)}`;
            if (result.exitCode !== 0) output += `\nExit code: ${result.exitCode}`;

            // Store output files as artifacts
            if (result.files.length > 0 && ctx.dataDir) {
              for (const file of result.files) {
                const mimeType = guessMimeType(file.name);
                storeArtifact(ctx.storage, ctx.dataDir, {
                  jobId,
                  name: file.name,
                  mimeType,
                  data: Buffer.from(file.data, "base64"),
                });
              }
              output += `\n${result.files.length} file(s) saved as artifacts.`;
            }

            return output || "Code executed successfully (no output).";
          } catch (err) {
            return `Code execution failed: ${err instanceof Error ? err.message : "unknown error"}`;
          }
        },
      }),
    } : {}),
  };
}

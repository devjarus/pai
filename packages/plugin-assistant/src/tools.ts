import { tool } from "ai";
import { z } from "zod";
import type { AgentContext } from "@personal-ai/core";
import { retrieveContext, remember, listBeliefs, searchBeliefs, forgetBelief, learnFromContent, knowledgeSearch, listSources, forgetSource, runInSandbox, resolveSandboxUrl, storeArtifact, guessMimeType } from "@personal-ai/core";
import type { Storage, LLMClient } from "@personal-ai/core";
import { upsertJob, updateJobStatus, listJobs, clearCompletedBackgroundJobs, formatDateTime } from "@personal-ai/core";
import type { BackgroundJob } from "@personal-ai/core";
import { createResearchJob, runResearchInBackground } from "@personal-ai/plugin-research";
import { createSwarmJob, runSwarmInBackground } from "@personal-ai/plugin-swarm";
import { addTask, listTasks, completeTask } from "@personal-ai/plugin-tasks";
import { createSchedule, listSchedules, deleteSchedule } from "@personal-ai/plugin-schedules";
import { webSearch, formatSearchResults, type SearchCategory } from "./web-search.js";
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
  upsertJob(storage, job);

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
      updateJobStatus(storage, jobId, { progress: `${learned + skipped + failed}/${maxPages}` });
    }
    updateJobStatus(storage, jobId, { status: "done", result: `Learned: ${learned}, Skipped: ${skipped}, Failed: ${failed}` });
  } catch (err) {
    updateJobStatus(storage, jobId, { status: "error", error: err instanceof Error ? err.message : String(err) });
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
        let output = result.formatted;
        if (ftsResults.length > 0) {
          const ftsSection = ftsResults
            .map((b) => {
              const subj = b.subject && b.subject !== "owner" ? ` [about: ${b.subject}]` : "";
              return `- [${b.type}|${b.confidence.toFixed(1)}]${subj} ${b.statement}`;
            })
            .join("\n");
          // Avoid duplicating if FTS results are already in the formatted context
          if (!ftsSection.split("\n").every(line => output.includes(line.replace(/^- /, "").trim()))) {
            output = `${output}\n\n## Text search matches\n${ftsSection}`;
          }
        }

        if (!output) return "[empty] No memories match this query. Try knowledge_search or answer from conversation context.";

        // Cap output to prevent context overfill (~2000 chars ≈ ~500 tokens)
        if (output.length > 2000) {
          output = output.slice(0, 2000) + "\n\n[truncated — use a more specific query for details]";
        }
        return output;
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
      description: "Search the web for current information, news, prices, or facts. Use this when the user asks about recent events, current data, or anything you're unsure about. Pick the best category for the query: 'general' (default), 'news' (recent events, headlines), 'it' (programming, tech docs), 'images', 'videos', 'social media', or 'files'.",
      inputSchema: z.object({
        query: z.string().describe("The search query"),
        category: z.enum(["general", "news", "it", "images", "videos", "social media", "files"]).default("general").describe("Search category — pick the best fit for the query"),
      }),
      execute: async ({ query, category }) => {
        if (ctx.config.webSearchEnabled === false) {
          return "Web search is disabled in settings. Answer based on your existing knowledge.";
        }
        try {
          const results = await webSearch(query, 5, category as SearchCategory);
          if (results.length === 0) return "[empty] No web results found. Answer from your existing knowledge and conversation context.";
          const text = formatSearchResults(results);
          // Return structured JSON string — LLM reads the text field, UI card parses the full object
          return JSON.stringify({ text, results, query, category });
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

          // Return top 3 results with truncated content to keep context small (~1500 chars total)
          return results.slice(0, 3).map((r) => ({
            content: r.chunk.content.slice(0, 500),
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

    research_start: tool({
      description: "Start a deep research task that runs in the background. Use when the user asks you to research a topic thoroughly, investigate something in depth, or compile a report. The research runs autonomously and delivers results to the Inbox. You MUST classify the research type correctly: 'flight' for travel/flight searches, 'stock' for stock/crypto/investment analysis, 'general' for everything else (news, topics, people, tech, etc.).",
      inputSchema: z.object({
        goal: z.string().describe("What to research — be specific about the topic and what kind of information to find"),
        type: z.enum(["flight", "stock", "general"]).describe("Research domain: 'flight' = flight/travel search, 'stock' = stock/crypto/investment analysis, 'general' = news, topics, people, tech, or anything else"),
      }),
      execute: async ({ goal, type }) => {
        try {
          // Get thread ID from extended context (set by server route)
          const threadId = (ctx as unknown as Record<string, unknown>).threadId as string | undefined;

          const resultType = type;
          const jobId = createResearchJob(ctx.storage, {
            goal,
            threadId: threadId ?? null,
            resultType,
          });

          // Fire and forget — pass injected dependencies
          runResearchInBackground(
            {
              storage: ctx.storage,
              llm: ctx.llm,
              logger: ctx.logger,
              timezone: ctx.config.timezone,
              webSearch,
              formatSearchResults,
              fetchPage: fetchPageAsMarkdown,
            },
            jobId,
          ).catch((err) => {
            ctx.logger.error(`Research background execution failed: ${err instanceof Error ? err.message : String(err)}`);
          });

          const domainLabel = resultType === "flight" ? "flight search" : resultType === "stock" ? "stock analysis" : "research";
          return `Research started! I'm running a ${domainLabel} for "${goal.slice(0, 80)}". The report will appear in your Inbox when it's done. Use job_status to check progress.`;
        } catch (err) {
          return `Failed to start research: ${err instanceof Error ? err.message : "unknown error"}`;
        }
      },
    }),

    swarm_start: tool({
      description: "Start a multi-agent swarm analysis that runs in the background. Use when the user asks for a complex analysis involving multiple perspectives, comparisons, or tasks that benefit from parallel investigation. The swarm decomposes the goal into subtasks, runs specialized sub-agents in parallel with a shared blackboard, and synthesizes results into a unified report delivered to the Inbox.",
      inputSchema: z.object({
        goal: z.string().describe("What to analyze — be specific about the topic, comparison, or question to investigate"),
        type: z.enum(["flight", "stock", "crypto", "news", "comparison", "general"]).describe("Research domain: 'flight' = travel/flights, 'stock' = stocks/equities, 'crypto' = cryptocurrency, 'news' = current events, 'comparison' = comparing entities, 'general' = everything else"),
      }),
      execute: async ({ goal, type }) => {
        try {
          const threadId = (ctx as unknown as Record<string, unknown>).threadId as string | undefined;

          const jobId = createSwarmJob(ctx.storage, {
            goal,
            threadId: threadId ?? null,
            resultType: type,
          });

          // Fire and forget
          runSwarmInBackground(
            {
              storage: ctx.storage,
              llm: ctx.llm,
              logger: ctx.logger,
              timezone: ctx.config.timezone,
              webSearch,
              formatSearchResults,
              fetchPage: fetchPageAsMarkdown,
            },
            jobId,
          ).catch((err) => {
            ctx.logger.error(`Swarm background execution failed: ${err instanceof Error ? err.message : String(err)}`);
          });

          return `Swarm analysis started! I'm spawning multiple sub-agents for a ${type} analysis of "${goal.slice(0, 80)}" in parallel. The synthesized report will appear in your Inbox when done. Use job_status to check progress.`;
        } catch (err) {
          return `Failed to start swarm: ${err instanceof Error ? err.message : "unknown error"}`;
        }
      },
    }),

    schedule_create: tool({
      description: "Create a recurring scheduled job. Use when the user wants periodic/recurring tasks (e.g., 'research AI news every day at 8am', 'send me a weekly report on crypto'). The schedule will automatically run at the specified interval and deliver results. Use start_at to schedule the first run at a specific date/time (e.g., 'tomorrow at 8am').",
      inputSchema: z.object({
        label: z.string().describe("Short name for the schedule (e.g., 'AI news daily')"),
        goal: z.string().describe("Detailed goal — what to do each time the schedule runs"),
        interval_hours: z.number().optional().describe("Hours between runs (default: 24 = daily). Use 168 for weekly, 12 for twice daily."),
        start_at: z.string().optional().describe("ISO 8601 date-time for the first run (e.g., '2026-02-27T08:00:00'). If omitted, first run is interval_hours from now."),
      }),
      execute: async ({ label, goal, interval_hours, start_at }) => {
        try {
          const threadId = (ctx as unknown as Record<string, unknown>).threadId as string | undefined;
          const chatId = (ctx as unknown as Record<string, unknown>).chatId as number | undefined;
          const schedule = createSchedule(ctx.storage, {
            label,
            goal,
            intervalHours: interval_hours,
            startAt: start_at,
            chatId: chatId ?? null,
            threadId: threadId ?? null,
          });
          return `Schedule created! "${label}" will run every ${schedule.intervalHours} hours. First run at ${formatDateTime(ctx.config.timezone, new Date(schedule.nextRunAt)).full}. Reports will be delivered ${chatId ? "to this chat" : "to your Inbox"}.`;
        } catch (err) {
          return `Failed to create schedule: ${err instanceof Error ? err.message : "unknown error"}`;
        }
      },
    }),

    schedule_list: tool({
      description: "List all active scheduled jobs. Use when the user asks about their schedules or recurring tasks.",
      inputSchema: z.object({}),
      execute: async () => {
        const schedules = listSchedules(ctx.storage, "active");
        if (schedules.length === 0) return "No active schedules. You can create one by asking me to schedule a recurring task.";
        return schedules.map((s) => ({
          id: s.id,
          label: s.label,
          goal: s.goal.slice(0, 100),
          intervalHours: s.intervalHours,
          nextRunAt: s.nextRunAt,
          lastRunAt: s.lastRunAt,
        }));
      },
    }),

    schedule_delete: tool({
      description: "Delete a scheduled job. Use when the user wants to stop/cancel a recurring schedule.",
      inputSchema: z.object({
        id: z.string().describe("Schedule ID to delete"),
      }),
      execute: async ({ id }) => {
        const ok = deleteSchedule(ctx.storage, id);
        return ok ? "Schedule deleted." : "Schedule not found or already deleted.";
      },
    }),

    job_status: tool({
      description: "Check the status of background jobs (crawl, research, swarm). Use when the user asks about crawl progress, research status, swarm analysis, or background tasks.",
      inputSchema: z.object({}),
      execute: async () => {
        // Clean up completed jobs older than 10 minutes
        clearCompletedBackgroundJobs(ctx.storage, 10 * 60 * 1000);

        const jobs = listJobs(ctx.storage);
        if (jobs.length === 0) return "No background jobs running or recently completed.";

        return jobs.map((j) => ({
          id: j.id,
          type: j.type,
          label: j.label,
          status: j.status,
          progress: j.progress,
          startedAt: j.startedAt,
          ...(j.error ? { error: j.error } : {}),
          ...(j.result ? { result: j.result } : {}),
        }));
      },
    }),

    // Conditionally add sandbox tool
    ...(resolveSandboxUrl() ? {
      run_code: tool({
        description: "Execute Python or JavaScript code in an isolated sandbox. Use for data analysis, chart generation, calculations, or file processing. Files written to the OUTPUT_DIR directory will be saved as artifacts. Available packages: matplotlib, pandas, numpy, plotly, yfinance.",
        inputSchema: z.object({
          language: z.enum(["python", "node"]).describe("Programming language to execute"),
          code: z.string().describe("The code to execute"),
          purpose: z.string().describe("Brief description of what this code does (for audit logging)"),
          timeout: z.number().optional().describe("Execution timeout in seconds (default 30, max 120)"),
        }),
        execute: async ({ language, code, purpose, timeout }) => {
          try {
            ctx.logger.info("Sandbox execution", { purpose, language });
            const result = await runInSandbox({ language, code, timeout });

            // Store any output files as artifacts
            const savedArtifacts: Array<{ id: string; name: string; mimeType: string }> = [];
            if (result.files.length > 0) {
              const jobId = (ctx as unknown as Record<string, unknown>).threadId as string ?? "sandbox";
              for (const file of result.files) {
                const mimeType = guessMimeType(file.name);
                const artifactId = storeArtifact(ctx.storage, {
                  jobId,
                  name: file.name,
                  mimeType,
                  data: Buffer.from(file.data, "base64"),
                });
                savedArtifacts.push({ id: artifactId, name: file.name, mimeType });
              }
            }

            return {
              stdout: result.stdout,
              stderr: result.stderr,
              exitCode: result.exitCode,
              artifacts: savedArtifacts,
              ...(result.exitCode !== 0 ? { error: `Code exited with code ${result.exitCode}` } : {}),
            };
          } catch (err) {
            return { error: `Sandbox execution failed: ${err instanceof Error ? err.message : "unknown error"}` };
          }
        },
      }),
    } : {}),
  };
}

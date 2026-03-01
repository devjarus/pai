import { generateText, tool, stepCountIs } from "ai";
import type { LanguageModel } from "ai";
import { z } from "zod";
import { nanoid } from "nanoid";
import type { Storage, LLMClient, Logger } from "@personal-ai/core";
import { knowledgeSearch, appendMessages, learnFromContent } from "@personal-ai/core";
import { upsertJob, updateJobStatus } from "@personal-ai/core";
import type { BackgroundJob } from "@personal-ai/core";
import {
  getSwarmJob,
  updateSwarmJob,
  insertSwarmAgent,
  updateSwarmAgent,
  getSwarmAgents,
  insertBlackboardEntry,
  getBlackboardEntries,
} from "./index.js";
import type { SwarmPlanItem } from "./index.js";
import {
  getPlannerPrompt,
  getResearcherPrompt,
  getCoderPrompt,
  getAnalystPrompt,
  getSynthesizerPrompt,
  getFlightResearcherPrompt,
  getStockResearcherPrompt,
  getCryptoResearcherPrompt,
} from "./prompts.js";

// ---- Types ----

export interface SwarmContext {
  storage: Storage;
  llm: LLMClient;
  logger: Logger;
  timezone?: string;
  webSearch: (query: string, maxResults?: number) => Promise<Array<{ title: string; url: string; snippet: string }>>;
  formatSearchResults: (results: Array<{ title: string; url: string; snippet: string }>) => string;
  fetchPage: (url: string) => Promise<{ title: string; markdown: string; url: string } | null>;
}

function getSubAgentPrompt(role: string, resultType: string, timezone?: string): string {
  // Domain-specific roles first
  if (role === "flight_researcher") return getFlightResearcherPrompt(timezone);
  if (role === "stock_researcher") return getStockResearcherPrompt(timezone);
  if (role === "crypto_researcher") return getCryptoResearcherPrompt(timezone);
  if (role === "chart_generator") return getCoderPrompt(timezone);
  if (role === "comparator" || role === "fact_checker" || role === "market_analyst" || role === "price_analyst") return getAnalystPrompt(timezone);
  if (role === "news_researcher") return getResearcherPrompt(timezone);

  // Generic roles — use domain-aware defaults when resultType is specific
  if (role === "researcher") {
    if (resultType === "flight") return getFlightResearcherPrompt(timezone);
    if (resultType === "stock") return getStockResearcherPrompt(timezone);
    if (resultType === "crypto") return getCryptoResearcherPrompt(timezone);
    return getResearcherPrompt(timezone);
  }
  if (role === "analyst") return getAnalystPrompt(timezone);
  if (role === "coder") return getCoderPrompt(timezone);
  return getResearcherPrompt(timezone);
}

const MAX_AGENTS = 5;
const MAX_SEARCHES_PER_AGENT = 3;
const MAX_PAGES_PER_AGENT = 2;
const AGENT_STEP_LIMIT = 6;

// ---- Background Execution ----

export async function runSwarmInBackground(
  ctx: SwarmContext,
  jobId: string,
): Promise<void> {
  const job = getSwarmJob(ctx.storage, jobId);
  if (!job) {
    ctx.logger.error(`Swarm job ${jobId} not found`);
    return;
  }

  // Register in shared background_jobs tracker
  const tracked: BackgroundJob = {
    id: jobId,
    type: "swarm" as BackgroundJob["type"],
    label: job.goal.slice(0, 100),
    status: "running",
    progress: "planning",
    startedAt: new Date().toISOString(),
  };
  upsertJob(ctx.storage, tracked);

  try {
    // Phase 1: Plan — decompose goal into subtasks
    updateSwarmJob(ctx.storage, jobId, { status: "planning" });
    updateJobStatus(ctx.storage, jobId, { progress: "planning subtasks" });

    const plan = await planSwarm(ctx, job.goal, job.resultType);
    if (!plan || plan.length === 0) {
      // Fallback: single-agent execution
      ctx.logger.warn(`Swarm planning failed for ${jobId}, falling back to single agent`);
      const fallbackPlan: SwarmPlanItem[] = [
        { role: "researcher", task: job.goal, tools: ["web_search", "read_page", "knowledge_search"] },
      ];
      await executePlan(ctx, jobId, fallbackPlan, job.resultType);
    } else {
      const limited = plan.slice(0, MAX_AGENTS);
      updateSwarmJob(ctx.storage, jobId, {
        plan: JSON.stringify(limited),
        agent_count: limited.length,
        status: "running",
      });
      await executePlan(ctx, jobId, limited, job.resultType);
    }

    // Phase 3: Synthesize
    updateSwarmJob(ctx.storage, jobId, { status: "synthesizing" });
    updateJobStatus(ctx.storage, jobId, { progress: "synthesizing results" });

    const { synthesis: rawSynthesis, structuredResult } = await synthesize(ctx, jobId, job.goal, job.resultType);
    const report = rawSynthesis || "Swarm completed but no synthesis was generated.";

    updateSwarmJob(ctx.storage, jobId, {
      synthesis: report,
      status: "done",
      completed_at: new Date().toISOString(),
    });

    updateJobStatus(ctx.storage, jobId, {
      status: "done",
      progress: "complete",
      result: report.slice(0, 200),
    });

    // Create Inbox briefing
    const briefingId = `swarm-${jobId}`;
    try {
      const sections = JSON.stringify({
        report,
        goal: job.goal,
        resultType: job.resultType || "general",
        structuredResult: structuredResult ?? undefined,
      });
      ctx.storage.run(
        "INSERT INTO briefings (id, generated_at, sections, raw_context, status, type) VALUES (?, datetime('now'), ?, null, 'ready', 'research')",
        [briefingId, sections],
      );
      updateSwarmJob(ctx.storage, jobId, { briefing_id: briefingId });
    } catch (err) {
      ctx.logger.warn(`Failed to create swarm briefing: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Learn report into knowledge base
    try {
      const reportUrl = `/inbox/${briefingId}`;
      const reportTitle = `Swarm Report: ${job.goal.slice(0, 100)}`;
      await learnFromContent(ctx.storage, ctx.llm, reportUrl, reportTitle, report);
    } catch (err) {
      ctx.logger.warn(`Failed to store swarm report in knowledge: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Append summary to originating chat thread
    if (job.threadId) {
      try {
        const summary = report.length > 500
          ? report.slice(0, 500) + "\n\n*Full report available in your Inbox.*"
          : report;
        appendMessages(ctx.storage, job.threadId, [
          { role: "assistant", content: `Swarm analysis complete: "${job.goal}"\n\n${summary}` },
        ]);
      } catch (err) {
        ctx.logger.warn(`Failed to append swarm results to thread: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    ctx.logger.info(`Swarm job ${jobId} completed`, { goal: job.goal });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    updateSwarmJob(ctx.storage, jobId, {
      status: "failed",
      completed_at: new Date().toISOString(),
    });

    updateJobStatus(ctx.storage, jobId, { status: "error", error: errorMsg });

    if (job.threadId) {
      try {
        appendMessages(ctx.storage, job.threadId, [
          { role: "assistant", content: `Swarm analysis failed: "${job.goal}"\n\nError: ${errorMsg}` },
        ]);
      } catch {
        // ignore
      }
    }

    ctx.logger.error(`Swarm job ${jobId} failed: ${errorMsg}`);
  }
}

// ---- Phase 1: Planning ----

async function planSwarm(ctx: SwarmContext, goal: string, resultType?: string): Promise<SwarmPlanItem[] | null> {
  try {
    const domainHint = resultType && resultType !== "general"
      ? `\n\nResearch domain: ${resultType}. Tailor subtasks for ${resultType} analysis.`
      : "";
    const result = await generateText({
      model: ctx.llm.getModel() as LanguageModel,
      system: getPlannerPrompt(resultType, ctx.timezone),
      messages: [
        { role: "user", content: `Decompose this goal into parallel subtasks:\n\n${goal}${domainHint}` },
      ],
      maxRetries: 1,
    });

    const jsonMatch = result.text.match(/```json\s*([\s\S]*?)```/);
    if (!jsonMatch?.[1]) return null;

    const parsed = JSON.parse(jsonMatch[1].trim()) as SwarmPlanItem[];
    if (!Array.isArray(parsed) || parsed.length === 0) return null;

    // Validate structure
    return parsed.filter(
      (item) =>
        typeof item.role === "string" &&
        typeof item.task === "string" &&
        Array.isArray(item.tools),
    ).slice(0, MAX_AGENTS);
  } catch (err) {
    ctx.logger.warn(`Swarm planning failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// ---- Phase 2: Parallel Execution ----

async function executePlan(ctx: SwarmContext, jobId: string, plan: SwarmPlanItem[], resultType?: string): Promise<void> {
  // Insert all agent rows
  const agentIds: string[] = [];
  for (const item of plan) {
    const agentId = nanoid();
    agentIds.push(agentId);
    insertSwarmAgent(ctx.storage, {
      id: agentId,
      swarmId: jobId,
      role: item.role,
      task: item.task,
      tools: item.tools,
    });
  }

  updateJobStatus(ctx.storage, jobId, {
    progress: `running ${plan.length} agents`,
  });

  // Execute all agents in parallel
  const promises = plan.map((item, i) =>
    runSubAgent(ctx, jobId, agentIds[i]!, item, resultType).catch((err) => {
      const errorMsg = err instanceof Error ? err.message : String(err);
      updateSwarmAgent(ctx.storage, agentIds[i]!, {
        status: "failed",
        error: errorMsg,
        completed_at: new Date().toISOString(),
      });
    }),
  );

  await Promise.allSettled(promises);

  // Update agents_done count
  const agents = getSwarmAgents(ctx.storage, jobId);
  const doneCount = agents.filter((a) => a.status === "done" || a.status === "failed").length;
  updateSwarmJob(ctx.storage, jobId, { agents_done: doneCount });

  updateJobStatus(ctx.storage, jobId, {
    progress: `${doneCount}/${plan.length} agents complete`,
  });
}

async function runSubAgent(
  ctx: SwarmContext,
  swarmId: string,
  agentId: string,
  plan: SwarmPlanItem,
  resultType?: string,
): Promise<void> {
  updateSwarmAgent(ctx.storage, agentId, { status: "running" });

  // Select system prompt based on role and domain
  const systemPrompt = getSubAgentPrompt(plan.role, resultType ?? "general", ctx.timezone);

  // Build budget-limited tools
  const tools = createSubAgentTools(ctx, swarmId, agentId, plan.tools);

  const result = await generateText({
    model: ctx.llm.getModel() as LanguageModel,
    system: systemPrompt,
    messages: [
      { role: "user", content: `Your task: ${plan.task}` },
    ],
    tools,
    toolChoice: "auto",
    stopWhen: stepCountIs(AGENT_STEP_LIMIT),
    maxRetries: 1,
  });

  const agentResult = result.text || "Agent completed but produced no text output.";

  // Post final result to blackboard if not already posted
  insertBlackboardEntry(ctx.storage, {
    swarmId,
    agentId,
    type: "finding",
    content: `[Final result from ${plan.role}]: ${agentResult.slice(0, 2000)}`,
  });

  updateSwarmAgent(ctx.storage, agentId, {
    status: "done",
    result: agentResult,
    steps_used: result.steps.length,
    completed_at: new Date().toISOString(),
  });
}

// ---- Sub-Agent Tools ----

function createSubAgentTools(
  ctx: SwarmContext,
  swarmId: string,
  agentId: string,
  allowedTools: string[],
) {
  let searchesUsed = 0;
  let pagesRead = 0;
  const allowed = new Set(allowedTools);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allTools: Record<string, any> = {
    web_search: tool({
      description: "Search the web for information. Budget-limited.",
      inputSchema: z.object({
        query: z.string().describe("Search query"),
      }),
      execute: async ({ query }: { query: string }) => {
        if (searchesUsed >= MAX_SEARCHES_PER_AGENT) {
          return "Budget exhausted — you've used all your web searches. Post your findings to the blackboard now.";
        }
        searchesUsed++;
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
      description: "Fetch and read a web page. Budget-limited.",
      inputSchema: z.object({
        url: z.string().url().describe("URL to read"),
      }),
      execute: async ({ url }: { url: string }) => {
        if (pagesRead >= MAX_PAGES_PER_AGENT) {
          return "Budget exhausted — you've used all your page reads. Post your findings to the blackboard now.";
        }
        pagesRead++;
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
      description: "Search existing knowledge base for relevant information.",
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

    blackboard_write: tool({
      description: "Post a finding, question, or artifact to the shared blackboard for other agents to see.",
      inputSchema: z.object({
        type: z.enum(["finding", "question", "answer", "artifact"]).describe("Type of entry"),
        content: z.string().describe("The content to post"),
      }),
      execute: async ({ type, content }: { type: string; content: string }) => {
        insertBlackboardEntry(ctx.storage, {
          swarmId,
          agentId,
          type,
          content,
        });
        return "Posted to blackboard.";
      },
    }),

    blackboard_read: tool({
      description: "Read all entries on the shared blackboard from all agents in this swarm.",
      inputSchema: z.object({}),
      execute: async () => {
        const entries = getBlackboardEntries(ctx.storage, swarmId);
        if (entries.length === 0) return "Blackboard is empty — no entries yet from any agent.";
        return entries.map((e) => ({
          type: e.type,
          agent: e.agentId.slice(0, 8),
          content: e.content.slice(0, 500),
          time: e.createdAt,
        }));
      },
    }),
  };

  // Conditionally add run_code if sandbox is available and tools include it
  if (allowed.has("run_code")) {
    try {
      const sandboxUrl = process.env.PAI_SANDBOX_URL;
      if (sandboxUrl) {
        allTools.run_code = tool({
          description: "Execute Python or JavaScript code in an isolated sandbox.",
          inputSchema: z.object({
            language: z.enum(["python", "node"]).describe("Programming language"),
            code: z.string().describe("The code to execute"),
          }),
          execute: async ({ language, code }: { language: string; code: string }) => {
            try {
              const { runInSandbox } = await import("@personal-ai/core");
              const result = await runInSandbox({ language: language as "python" | "node", code, timeout: 30 });
              // Post artifacts to blackboard
              if (result.files.length > 0) {
                insertBlackboardEntry(ctx.storage, {
                  swarmId,
                  agentId,
                  type: "artifact",
                  content: `Generated ${result.files.length} file(s): ${result.files.map((f) => f.name).join(", ")}`,
                });
              }
              return {
                stdout: result.stdout,
                stderr: result.stderr,
                exitCode: result.exitCode,
                files: result.files.map((f) => f.name),
              };
            } catch (err) {
              return { error: `Sandbox execution failed: ${err instanceof Error ? err.message : "unknown error"}` };
            }
          },
        });
      }
    } catch {
      // sandbox not available
    }
  }

  // Filter to only allowed tools + always include blackboard tools
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: Record<string, any> = {};
  for (const [name, t] of Object.entries(allTools)) {
    if (name === "blackboard_write" || name === "blackboard_read" || allowed.has(name)) {
      result[name] = t;
    }
  }
  return result;
}

// ---- Phase 3: Synthesis ----

async function synthesize(
  ctx: SwarmContext,
  jobId: string,
  goal: string,
  resultType?: string,
): Promise<{ synthesis: string; structuredResult: string | null }> {
  const agents = getSwarmAgents(ctx.storage, jobId);
  const blackboard = getBlackboardEntries(ctx.storage, jobId);

  // Build context for synthesizer
  const agentResults = agents.map((a) => {
    const statusLabel = a.status === "done" ? "completed" : `failed: ${a.error ?? "unknown"}`;
    return `### ${a.role} — ${statusLabel}\n**Task:** ${a.task}\n**Result:**\n${a.result?.slice(0, 2000) ?? "(no output)"}`;
  }).join("\n\n---\n\n");

  const blackboardText = blackboard.length > 0
    ? blackboard.map((e) => `- [${e.type}] (agent ${e.agentId.slice(0, 8)}): ${e.content.slice(0, 500)}`).join("\n")
    : "(no blackboard entries)";

  const result = await generateText({
    model: ctx.llm.getModel() as LanguageModel,
    system: getSynthesizerPrompt(resultType, ctx.timezone),
    messages: [
      {
        role: "user",
        content: `## Original Goal\n${goal}\n\n## Sub-Agent Results\n${agentResults}\n\n## Blackboard Entries\n${blackboardText}\n\nSynthesize these findings into a unified report.`,
      },
    ],
    maxRetries: 1,
  });

  const text = result.text || "Synthesis produced no output.";

  // Extract structured JSON from code fence if present
  let structuredResult: string | null = null;
  let synthesis = text;

  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/);
  if (jsonMatch?.[1]) {
    try {
      // Validate it's parseable JSON
      JSON.parse(jsonMatch[1].trim());
      structuredResult = jsonMatch[1].trim();
      // Remove the JSON code fence from the markdown report
      synthesis = text.replace(/```json\s*[\s\S]*?```/, "").trim();
    } catch {
      // Invalid JSON — keep original text, no structured result
      ctx.logger.warn("Synthesizer produced invalid JSON in code fence, ignoring structured output");
    }
  }

  return { synthesis, structuredResult };
}

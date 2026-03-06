import { generateText, tool, stepCountIs } from "ai";
import type { LanguageModel } from "ai";
import { z } from "zod";
import { nanoid } from "nanoid";
import type { Storage, LLMClient, Logger } from "@personal-ai/core";
import {
  knowledgeSearch,
  appendMessages,
  learnFromContent,
  resolveSandboxUrl,
  getContextBudget,
  getProviderOptions,
  createBrowserTools,
  buildReportPresentation,
  deriveReportVisuals,
  extractPresentationBlocks,
} from "@personal-ai/core";
import { upsertJob, updateJobStatus } from "@personal-ai/core";
import { storeArtifact, guessMimeType } from "@personal-ai/core";
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
  provider?: string;
  model?: string;
  contextWindow?: number;
  /** Sandbox URL from config (passed through to resolveSandboxUrl) */
  sandboxUrl?: string;
  /** Browser automation URL from config (passed through to resolveBrowserUrl) */
  browserUrl?: string;
  /** Data directory for artifact file storage */
  dataDir?: string;
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
const MAX_SEARCHES_PER_AGENT = 4;
const MAX_PAGES_PER_AGENT = 3;
const AGENT_STEP_LIMIT = 8;

function getDefaultResearchRole(resultType?: string): string {
  switch (resultType) {
    case "flight":
      return "flight_researcher";
    case "stock":
      return "stock_researcher";
    case "crypto":
      return "crypto_researcher";
    case "news":
      return "news_researcher";
    default:
      return "researcher";
  }
}

function getDefaultAnalystRole(resultType?: string): string {
  switch (resultType) {
    case "flight":
      return "price_analyst";
    case "crypto":
      return "market_analyst";
    case "comparison":
      return "comparator";
    case "news":
      return "fact_checker";
    default:
      return "analyst";
  }
}

function buildDefaultAnalysisPlan(goal: string, resultType?: string): SwarmPlanItem[] {
  return [
    {
      role: getDefaultResearchRole(resultType),
      task: `Research authoritative facts, source evidence, and key quantitative data for: ${goal}`,
      tools: ["web_search", "read_page", "knowledge_search"],
    },
    {
      role: getDefaultAnalystRole(resultType),
      task: `Analyze the evidence, quantify important trends, compare competing signals, and surface caveats for: ${goal}`,
      tools: ["web_search", "read_page", "knowledge_search"],
    },
    {
      role: "chart_generator",
      task: `Using only real data from the blackboard or authoritative sources, generate at least one PNG visual for: ${goal}. Write image files to OUTPUT_DIR and optionally write visuals.json describing titles, captions, kinds, and order. Do not fabricate, simulate, or synthesize data.`,
      tools: ["web_search", "read_page", "knowledge_search", "run_code"],
    },
  ];
}

function ensureAnalysisPlan(plan: SwarmPlanItem[] | null, goal: string, resultType?: string): SwarmPlanItem[] {
  const current = plan && plan.length > 0 ? [...plan] : [];
  const normalized = current.slice(0, MAX_AGENTS);
  const required = buildDefaultAnalysisPlan(goal, resultType);

  const hasResearcher = normalized.some((item) => item.role === "researcher" || item.role.endsWith("_researcher"));
  const hasAnalyst = normalized.some((item) =>
    ["analyst", "comparator", "fact_checker", "market_analyst", "price_analyst"].includes(item.role),
  );
  const hasCoder = normalized.some((item) => item.role === "coder" || item.role === "chart_generator");

  if (!hasResearcher) normalized.unshift(required[0]!);
  if (!hasAnalyst) normalized.push(required[1]!);
  if (!hasCoder) normalized.push(required[2]!);

  const deduped: SwarmPlanItem[] = [];
  const seen = new Set<string>();
  for (const item of normalized) {
    const key = `${item.role}:${item.task}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  const requiredRoles = new Set(required.map((item) => item.role));
  const requiredItems = deduped.filter((item) => requiredRoles.has(item.role));
  const optionalItems = deduped.filter((item) => !requiredRoles.has(item.role));

  return [...requiredItems, ...optionalItems].slice(0, MAX_AGENTS);
}

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

    const planned = await planSwarm(ctx, job.goal, job.resultType);
    const executablePlan = ensureAnalysisPlan(planned, job.goal, job.resultType);
    if (!planned || planned.length === 0) {
      ctx.logger.warn(`Swarm planning failed for ${jobId}, falling back to default analysis plan`);
    }

    updateSwarmJob(ctx.storage, jobId, {
      plan: JSON.stringify(executablePlan),
      agent_count: executablePlan.length,
      status: "running",
    });
    await executePlan(ctx, jobId, executablePlan, job.resultType);

    // Phase 3: Synthesize
    updateSwarmJob(ctx.storage, jobId, { status: "synthesizing" });
    updateJobStatus(ctx.storage, jobId, { progress: "synthesizing results" });

    const { synthesis: rawSynthesis, structuredResult, renderSpec } = await synthesize(ctx, jobId, job.goal, job.resultType);
    const report = rawSynthesis || "Swarm completed but no synthesis was generated.";
    const visuals = deriveReportVisuals(ctx.storage, jobId);
    const presentation = buildReportPresentation({
      report,
      ...(structuredResult ? { structuredResult } : {}),
      ...(renderSpec ? { renderSpec } : {}),
      visuals,
      resultType: job.resultType || "general",
      execution: "analysis",
    });

    updateSwarmJob(ctx.storage, jobId, {
      synthesis: presentation.report,
      status: "done",
      completed_at: new Date().toISOString(),
    });

    updateJobStatus(ctx.storage, jobId, {
      status: "done",
      progress: "complete",
      result: presentation.report.slice(0, 200),
      resultType: job.resultType || "general",
      ...(structuredResult ? { structuredResult } : {}),
    });

    // Create Inbox briefing
    const briefingId = `swarm-${jobId}`;
    try {
      const sections = JSON.stringify({
        report: presentation.report,
        goal: job.goal,
        resultType: presentation.resultType,
        execution: presentation.execution,
        visuals: presentation.visuals,
        structuredResult: presentation.structuredResult ?? undefined,
        renderSpec: presentation.renderSpec ?? undefined,
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
      await learnFromContent(ctx.storage, ctx.llm, reportUrl, reportTitle, presentation.report);
    } catch (err) {
      ctx.logger.warn(`Failed to store swarm report in knowledge: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Append summary to originating chat thread
    if (job.threadId) {
      try {
        const summary = presentation.report.length > 500
          ? presentation.report.slice(0, 500) + "\n\n*Full report available in your Inbox.*"
          : presentation.report;
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
    const budget = getContextBudget(ctx.provider ?? "ollama", ctx.model ?? "", ctx.contextWindow);
    const result = await generateText({
      model: ctx.llm.getModel() as LanguageModel,
      system: getPlannerPrompt(resultType, ctx.timezone),
      messages: [
        { role: "user", content: `Decompose this goal into parallel subtasks:\n\n${goal}${domainHint}` },
      ],
      maxRetries: 1,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      providerOptions: getProviderOptions(ctx.provider ?? "ollama", budget.contextWindow) as any,
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

  const agentBudget = getContextBudget(ctx.provider ?? "ollama", ctx.model ?? "", ctx.contextWindow);
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    providerOptions: getProviderOptions(ctx.provider ?? "ollama", agentBudget.contextWindow) as any,
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

  // Browser tools for JS-rendered pages (with artifact storage for screenshots)
  const browserTools = createBrowserTools({
    logger: ctx.logger,
    browserUrl: ctx.browserUrl,
    storeArtifact: (name, mimeType, data) => storeArtifact(ctx.storage, ctx.dataDir ?? "", { jobId: swarmId, name, mimeType, data }),
  });
  Object.assign(allTools, browserTools);

  // Conditionally add run_code if sandbox is available and tools include it
  if (allowed.has("run_code")) {
    try {
      const sandboxUrl = resolveSandboxUrl(ctx.sandboxUrl);
      if (sandboxUrl) {
        allTools.run_code = tool({
          description: "Execute Python or JavaScript code in an isolated sandbox.",
          inputSchema: z.object({
            language: z.enum(["python", "node"]).describe("Programming language"),
            code: z.string().describe("The code to execute"),
          }),
          execute: async ({ language, code }: { language: string; code: string }) => {
            try {
              ctx.logger.info("Swarm sandbox execution", { agentId, language, codeLength: code.length });
              const { runInSandbox } = await import("@personal-ai/core");
              const result = await runInSandbox({ language: language as "python" | "node", code, timeout: 30 }, ctx.logger, ctx.sandboxUrl);

              // Persist each output file as an artifact
              const artifactIds: Array<{ name: string; id: string }> = [];
              for (const f of result.files) {
                try {
                  const id = storeArtifact(ctx.storage, ctx.dataDir ?? "", {
                    jobId: swarmId,
                    name: f.name,
                    mimeType: guessMimeType(f.name),
                    data: Buffer.from(f.data, "base64"),
                  });
                  artifactIds.push({ name: f.name, id });
                } catch (err) {
                  ctx.logger.warn(`Failed to store artifact ${f.name}: ${err instanceof Error ? err.message : String(err)}`);
                }
              }

              // Post structured blackboard entry
              const filesLine = artifactIds.length > 0
                ? `\nFiles: ${artifactIds.map((a) => `${a.name} (artifact:${a.id})`).join(", ")}`
                : "";
              insertBlackboardEntry(ctx.storage, {
                swarmId,
                agentId,
                type: "artifact",
                content: `[code_execution] Language: ${language} | Exit: ${result.exitCode}\nCode:\n\`\`\`${language}\n${code.slice(0, 500)}\n\`\`\`\nStdout: ${(result.stdout || "(none)").slice(0, 1000)}\nStderr: ${(result.stderr || "(none)").slice(0, 1000)}${filesLine}`,
              });

              return {
                stdout: result.stdout,
                stderr: result.stderr,
                exitCode: result.exitCode,
                files: artifactIds.map((a) => ({ name: a.name, artifactId: a.id })),
              };
            } catch (err) {
              ctx.logger.error("Swarm sandbox run_code failed", {
                agentId,
                language,
                error: err instanceof Error ? err.message : String(err),
              });
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
): Promise<{ synthesis: string; structuredResult?: string; renderSpec?: string }> {
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

  const synthBudget = getContextBudget(ctx.provider ?? "ollama", ctx.model ?? "", ctx.contextWindow);
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    providerOptions: getProviderOptions(ctx.provider ?? "ollama", synthBudget.contextWindow) as any,
  });

  const text = result.text || "Synthesis produced no output.";
  const extracted = extractPresentationBlocks(text);
  return {
    synthesis: extracted.report,
    ...(extracted.structuredResult ? { structuredResult: extracted.structuredResult } : {}),
    ...(extracted.renderSpec ? { renderSpec: extracted.renderSpec } : {}),
  };
}

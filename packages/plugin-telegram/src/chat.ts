import type { AgentContext, AgentPlugin, ChatMessage, PluginContext, ThreadMessageInput } from "@personal-ai/core";
import {
  consolidateConversation,
  listMessages,
  appendMessages,
  createThread as coreCreateThread,
  deleteThread as coreDeleteThread,
  clearThread as coreClearThread,
} from "@personal-ai/core";
import { generateText, stepCountIs } from "ai";
import type { LanguageModel } from "ai";
import { webSearch, formatSearchResults, needsWebSearch } from "@personal-ai/plugin-assistant/web-search";

const MAX_MESSAGES_PER_THREAD = 500;

export interface ChatPipelineOptions {
  ctx: PluginContext;
  agentPlugin: AgentPlugin;
  threadId: string;
  message: string;
  /** Display name and username of the sender (for multi-user awareness) */
  sender?: { displayName?: string; username?: string };
  /** Called when a preflight operation starts (memory recall, web search) */
  onPreflight?: (action: string) => void;
  onToolCall?: (toolName: string) => void;
}

export interface ChatPipelineResult {
  text: string;
  toolCalls: Array<{ name: string }>;
}

function autoTitle(message: string): string {
  const trimmed = message.trim();
  if (trimmed.length <= 50) return trimmed;
  return trimmed.slice(0, 47) + "...";
}

// Per-thread processing queue to prevent race conditions
const threadQueues = new Map<string, Promise<unknown>>();

export function withThreadLock<T>(threadId: string, fn: () => Promise<T>): Promise<T> {
  const prev = threadQueues.get(threadId) ?? Promise.resolve();
  const chain = prev.then(fn, fn);
  const safe = chain.catch(() => {});
  threadQueues.set(threadId, safe);
  safe.then(() => {
    if (threadQueues.get(threadId) === safe) {
      threadQueues.delete(threadId);
    }
  });
  return chain;
}

/**
 * Run the agent chat pipeline (non-streaming).
 * Loads conversation history, builds context, calls generateText with tools,
 * persists history, and returns the final text.
 */
export async function runAgentChat(opts: ChatPipelineOptions): Promise<ChatPipelineResult> {
  return withThreadLock(opts.threadId, async () => {
  const { ctx, agentPlugin, threadId, message, sender, onPreflight, onToolCall } = opts;

  // Load conversation history from SQLite (normalized messages)
  const historyRows = listMessages(ctx.storage, threadId, { limit: 20 });
  const history: ChatMessage[] = historyRows.map((row) => ({
    role: row.role,
    content: row.content,
  }));

  // Build agent context
  const agentCtx: AgentContext = {
    ...ctx,
    userMessage: message,
    conversationHistory: [...history],
    sender,
  };

  // Build tools from agent plugin
  const tools = agentPlugin.agent.createTools?.(agentCtx);

  // Inject current date/time
  const now = new Date();
  let systemPrompt = agentPlugin.agent.systemPrompt +
    `\n\nCurrent date and time: ${now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}, ${now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true })}. Use this for time-sensitive queries.`;

  // Inject sender identity so the LLM knows who it's talking to
  if (sender) {
    const name = sender.displayName ?? sender.username ?? "Unknown";
    const tag = sender.username ? ` (@${sender.username})` : "";
    const ownerUsername = ctx.config.telegram?.ownerUsername;
    const isOwner = ownerUsername && sender.username === ownerUsername;

    if (isOwner) {
      systemPrompt += `\n\nYou are talking to ${name}${tag} — this is your owner. When they say "my" or "I", it refers to them. Memories tagged "owner" are about this person.`;
    } else {
      systemPrompt += `\n\nYou are talking to ${name}${tag} — this is NOT your owner. When they say "my" or "I", it refers to ${name}, not the owner. Memories about ${name} may exist. Do not confuse ${name}'s preferences with the owner's preferences.`;
    }
  }

  // Preflight: inject web search results when the message likely needs current information
  if (needsWebSearch(message)) {
    onPreflight?.("🔍 Searching the web...");
    try {
      const searchResults = await webSearch(message, 5);
      if (searchResults.length > 0) {
        const formatted = formatSearchResults(searchResults);
        systemPrompt += `\n\n## Web Search Results (auto-searched)\n${formatted}\n\nUse these search results to answer the user's question. Cite sources when appropriate.`;
        ctx.logger.debug("Telegram web search preflight", { resultCount: searchResults.length });
      }
    } catch (err) {
      ctx.logger.debug("Telegram web search preflight failed", { error: err instanceof Error ? err.message : String(err) });
    }
  }

  // Build messages for LLM
  const messages: ChatMessage[] = [
    ...history.slice(-20),
    { role: "user", content: message },
  ];

  // Track tool calls
  const toolCalls: Array<{ name: string }> = [];

  // Use generateText (non-streaming) for Telegram
  const result = await generateText({
    model: ctx.llm.getModel() as LanguageModel,
    system: systemPrompt,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    temperature: 0.7,
    maxRetries: 1,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools: tools as any,
    toolChoice: tools ? "auto" : undefined,
    stopWhen: tools ? stepCountIs(3) : undefined,
    onStepFinish: ({ toolCalls: stepTools, text: stepText }) => {
      ctx.logger.debug("Telegram step finished", { toolCount: stepTools?.length ?? 0, textLen: stepText?.length ?? 0 });
      if (stepTools) {
        for (const tc of stepTools) {
          ctx.logger.debug("Telegram tool called", { tool: tc.toolName });
          toolCalls.push({ name: tc.toolName });
          onToolCall?.(tc.toolName);
        }
      }
    },
  });

  // Clean up raw tool call JSON that some models (Ollama) emit as text
  let text = result.text;
  // Strip blocks like {"name":"tool_name","arguments":{...}} or [{"name":...}]
  text = text.replace(/\[?\s*\{\s*"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:\s*\{[^}]*\}\s*\}\s*\]?/g, "").trim();
  // Strip leftover tool-call-like prefixes/suffixes
  text = text.replace(/^[\s,]+|[\s,]+$/g, "").trim();

  // Build persisted messages — include tool call summaries so model retains context
  const toPersist: ThreadMessageInput[] = [
    { role: "user", content: message },
  ];

  // Summarize tool calls and results from intermediate steps
  if (toolCalls.length > 0 && result.steps) {
    const toolSummaries: string[] = [];
    for (const step of result.steps) {
      if (step.toolCalls && step.toolResults) {
        for (let i = 0; i < step.toolCalls.length; i++) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const tc = step.toolCalls[i] as any;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const tr = step.toolResults[i] as any;
          if (tc && tr) {
            const raw = tr.result ?? tr.output ?? tr;
            const resultStr = typeof raw === "string"
              ? raw.slice(0, 500)
              : JSON.stringify(raw).slice(0, 500);
            toolSummaries.push(`[Tool: ${tc.toolName}(${JSON.stringify(tc.args ?? {}).slice(0, 100)})] → ${resultStr}`);
          }
        }
      }
    }
    if (toolSummaries.length > 0) {
      toPersist.push({
        role: "system",
        content: `[Internal context — tool calls performed, do not repeat this to the user]\n${toolSummaries.join("\n")}`,
      });
    }
  }

  if (text) toPersist.push({ role: "assistant", content: text });

  // Persist to SQLite (normalized)
  appendMessages(ctx.storage, threadId, toPersist, {
    maxMessages: MAX_MESSAGES_PER_THREAD,
    titleCandidate: autoTitle(message),
  });

  // afterResponse — fire and forget
  if (agentPlugin.agent.afterResponse) {
    agentPlugin.agent.afterResponse(agentCtx, text).catch((err) => {
      ctx.logger.warn(`afterResponse failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  // Consolidate conversation every 5 user turns (fire and forget)
  const userTurnRow = ctx.storage.query<{ count: number }>(
    "SELECT COUNT(*) AS count FROM thread_messages WHERE thread_id = ? AND role = 'user'",
    [threadId],
  );
  const userTurnCount = userTurnRow[0]?.count ?? 0;
  if (userTurnCount > 0 && userTurnCount % 5 === 0) {
    const recentTurns = listMessages(ctx.storage, threadId, { limit: 10 })
      .map((row) => ({ role: row.role, content: row.content }));
    consolidateConversation(ctx.storage, ctx.llm, recentTurns, ctx.logger).catch((err) => {
      ctx.logger.warn(`Consolidation failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  return { text, toolCalls };
  }); // end withThreadLock
}

/** Create a new thread in SQLite and return its ID */
export function createThread(ctx: PluginContext, agentName?: string): string {
  const thread = coreCreateThread(ctx.storage, { agentName });
  return thread.id;
}

/** Delete a thread and its messages */
export function deleteThread(ctx: PluginContext, threadId: string): void {
  coreDeleteThread(ctx.storage, threadId);
}

/** Clear a thread's messages (keep the thread) */
export function clearThread(ctx: PluginContext, threadId: string): void {
  coreClearThread(ctx.storage, threadId);
}

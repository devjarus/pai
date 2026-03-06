import { Readable } from "node:stream";
import type { FastifyInstance } from "fastify";
import type { ServerContext } from "../index.js";
import type { AgentContext, ChatMessage, ThreadMessageInput, ThreadMessageRow, ThreadRow } from "@personal-ai/core";
import {
  threadMigrations,
  consolidateConversation,
  listThreads,
  listMessages,
  createThread,
  ensureThread,
  appendMessages,
  clearThread,
  deleteThread,
  clearAllThreads,
  withThreadLock,
  getThread,
  getOwner,
  getCorePreferences,
  formatDateTime,
  getContextBudget,
  estimateTokens,
  getProviderOptions,
  learnFromContent,
  isBinaryDocument,
  parseBinaryDocument,
} from "@personal-ai/core";
import { streamText, generateText, createUIMessageStream, createUIMessageStreamResponse, stepCountIs, tool } from "ai";

import type { LanguageModel } from "ai";
import { z } from "zod";
import { validate } from "../validate.js";

export { threadMigrations };

const MAX_MESSAGES_PER_THREAD = 500;
const TITLE_GENERATE_AT = 1;   // Generate LLM title after this many user turns
const TITLE_REFRESH_EVERY = 5; // Re-check title every N user turns after that
const STREAM_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const HEARTBEAT_INTERVAL_MS = 30 * 1000;  // 30 seconds

type SafeUIChunk =
  | { type: "text-start"; id: string; providerMetadata?: unknown }
  | { type: "text-delta"; id: string; delta: string; providerMetadata?: unknown }
  | { type: "text-end"; id: string; providerMetadata?: unknown }
  | { type: "tool-input-start"; toolCallId: string; toolName: string; providerExecuted?: boolean; providerMetadata?: unknown; dynamic?: boolean; title?: string }
  | { type: "tool-input-available"; toolCallId: string; toolName: string; input: unknown; providerExecuted?: boolean; providerMetadata?: unknown; dynamic?: boolean; title?: string }
  | { type: "tool-input-error"; toolCallId: string; toolName: string; input: unknown; errorText: string; providerExecuted?: boolean; providerMetadata?: unknown; dynamic?: boolean; title?: string }
  | { type: "tool-output-available"; toolCallId: string; output: unknown; providerExecuted?: boolean; dynamic?: boolean; preliminary?: boolean }
  | { type: "tool-output-error"; toolCallId: string; errorText: string; providerExecuted?: boolean; dynamic?: boolean }
  | { type: "tool-output-denied"; toolCallId: string };

function getErrorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function forwardSafeUIMessageChunks(
  writer: { write: (chunk: SafeUIChunk) => void },
  fullStream: AsyncIterable<{
    type: string;
    [key: string]: unknown;
  }>,
): Promise<void> {
  for await (const chunk of fullStream) {
    switch (chunk.type) {
      case "text-start":
        writer.write({ type: "text-start", id: String(chunk.id), ...(chunk.providerMetadata ? { providerMetadata: chunk.providerMetadata } : {}) });
        break;
      case "text-delta":
        writer.write({
          type: "text-delta",
          id: String(chunk.id),
          delta: typeof chunk.text === "string" ? chunk.text : "",
          ...(chunk.providerMetadata ? { providerMetadata: chunk.providerMetadata } : {}),
        });
        break;
      case "text-end":
        writer.write({ type: "text-end", id: String(chunk.id), ...(chunk.providerMetadata ? { providerMetadata: chunk.providerMetadata } : {}) });
        break;
      case "tool-input-start":
        writer.write({
          type: "tool-input-start",
          toolCallId: String(chunk.id),
          toolName: String(chunk.toolName),
          ...(typeof chunk.providerExecuted === "boolean" ? { providerExecuted: chunk.providerExecuted } : {}),
          ...(chunk.providerMetadata ? { providerMetadata: chunk.providerMetadata } : {}),
          ...(typeof chunk.dynamic === "boolean" ? { dynamic: chunk.dynamic } : {}),
          ...(typeof chunk.title === "string" ? { title: chunk.title } : {}),
        });
        break;
      case "tool-call":
        writer.write({
          type: "tool-input-available",
          toolCallId: String(chunk.toolCallId),
          toolName: String(chunk.toolName),
          input: chunk.input,
          ...(typeof chunk.providerExecuted === "boolean" ? { providerExecuted: chunk.providerExecuted } : {}),
          ...(chunk.providerMetadata ? { providerMetadata: chunk.providerMetadata } : {}),
          ...(typeof chunk.dynamic === "boolean" ? { dynamic: chunk.dynamic } : {}),
          ...(typeof chunk.title === "string" ? { title: chunk.title } : {}),
        });
        break;
      case "tool-error":
        writer.write({
          type: "tool-input-error",
          toolCallId: String(chunk.toolCallId),
          toolName: String(chunk.toolName),
          input: chunk.input,
          errorText: getErrorText(chunk.error),
          ...(typeof chunk.providerExecuted === "boolean" ? { providerExecuted: chunk.providerExecuted } : {}),
          ...(chunk.providerMetadata ? { providerMetadata: chunk.providerMetadata } : {}),
          ...(typeof chunk.dynamic === "boolean" ? { dynamic: chunk.dynamic } : {}),
          ...(typeof chunk.title === "string" ? { title: chunk.title } : {}),
        });
        break;
      case "tool-result":
        writer.write({
          type: "tool-output-available",
          toolCallId: String(chunk.toolCallId),
          output: chunk.output,
          ...(typeof chunk.providerExecuted === "boolean" ? { providerExecuted: chunk.providerExecuted } : {}),
          ...(typeof chunk.dynamic === "boolean" ? { dynamic: chunk.dynamic } : {}),
          ...(typeof chunk.preliminary === "boolean" ? { preliminary: chunk.preliminary } : {}),
        });
        break;
      case "tool-output-denied":
        writer.write({
          type: "tool-output-denied",
          toolCallId: String(chunk.toolCallId),
        });
        break;
      default:
        // Drop provider-specific and unsupported chunk types (for example raw item references)
        break;
    }
  }
}

const renameThreadSchema = z.object({
  title: z.string().min(1, "title is required").transform((s) => s.trim().replace(/<[^>]*>/g, "").slice(0, 255)),
});

function autoTitle(message: string): string {
  const trimmed = message.trim();
  if (trimmed.length <= 50) return trimmed;
  return trimmed.slice(0, 47) + "...";
}

/** Use LLM to generate a concise thread title from recent messages */
async function generateThreadTitle(
  ctx: { storage: import("@personal-ai/core").Storage; llm: import("@personal-ai/core").LLMClient },
  threadId: string,
  messages: Array<{ role: string; content: string }>,
): Promise<void> {
  try {
    const recent = messages.slice(-10);
    const conversation = recent.map((m) => `${m.role}: ${m.content.slice(0, 200)}`).join("\n");
    const result = await generateText({
      model: ctx.llm.getModel() as LanguageModel,
      system: "Generate a short title (max 50 chars) for this conversation. Return ONLY the title, nothing else. No quotes, no prefix.",
      messages: [{ role: "user", content: conversation }],
      temperature: 0.3,
      maxRetries: 1,
    });
    const title = result.text.trim().replace(/^["']|["']$/g, "").slice(0, 50);
    if (title.length >= 3) {
      ctx.storage.run("UPDATE threads SET title = ? WHERE id = ?", [title, threadId]);
    }
  } catch {
    // Non-critical — keep existing title
  }
}

function mapThread(row: ThreadRow) {
  return {
    id: row.id,
    title: row.title,
    agentName: row.agent_name ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messageCount: row.message_count,
  };
}

function mapMessage(row: ThreadMessageRow) {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
    sequence: row.sequence,
  };
}

export function registerAgentRoutes(app: FastifyInstance, { ctx, agents }: ServerContext): void {
  // List available agents
  app.get("/api/agents", async () => {
    return agents.map((a) => ({
      name: a.name,
      displayName: a.agent.displayName,
      description: a.agent.description,
      capabilities: a.agent.capabilities ?? [],
    }));
  });

  // ---- Threads (SQLite-backed) ----

  // List threads (newest first)
  app.get("/api/threads", async () => {
    return listThreads(ctx.storage).map(mapThread);
  });

  // Create a new thread
  const createThreadSchema = z.object({
    title: z.string().max(200).optional(),
    agentName: z.string().max(100).optional(),
  });
  app.post<{ Body: { title?: string; agentName?: string } }>("/api/threads", async (request) => {
    const body = validate(createThreadSchema, request.body ?? {});
    const thread = createThread(ctx.storage, {
      title: body.title,
      agentName: body.agentName,
    });
    return mapThread(thread);
  });

  // Delete a thread
  app.delete<{ Params: { id: string } }>("/api/threads/:id", async (request) => {
    deleteThread(ctx.storage, request.params.id);
    return { ok: true };
  });

  // Clear all threads
  app.post("/api/threads/clear", async () => {
    const cleared = clearAllThreads(ctx.storage);
    return { ok: true, cleared };
  });

  // Rename a thread
  app.patch<{ Params: { id: string }; Body: { title: string } }>(
    "/api/threads/:id",
    async (request, reply) => {
      const row = getThread(ctx.storage, request.params.id);
      if (!row) return reply.status(404).send({ error: "Thread not found" });

      const { title } = validate(renameThreadSchema, request.body);
      if (!title) return reply.status(400).send({ error: "title is required" });
      ctx.storage.run("UPDATE threads SET title = ? WHERE id = ?", [title, request.params.id]);
      const updated = getThread(ctx.storage, request.params.id);
      if (!updated) return reply.status(404).send({ error: "Thread not found" });
      return mapThread(updated);
    },
  );

  // List thread messages (newest first, paginated)
  app.get<{ Params: { id: string }; Querystring: { limit?: string; before?: string } }>(
    "/api/threads/:id/messages",
    async (request, reply) => {
      const thread = getThread(ctx.storage, request.params.id);
      if (!thread) return reply.status(404).send({ error: "Thread not found" });
      const MAX_LIMIT = 100;
      const parsed = request.query.limit ? parseInt(request.query.limit, 10) : 50;
      const limit = Number.isFinite(parsed) ? Math.min(parsed, MAX_LIMIT) : 50;
      const rows = listMessages(ctx.storage, request.params.id, {
        limit,
        before: request.query.before,
      });
      return rows.map(mapMessage);
    },
  );

  // ---- Chat ----

  // Chat with agent — AI SDK createUIMessageStream + streamText
  // Increase body limit to support file attachments (up to 5MB)
  app.post("/api/chat", { bodyLimit: 5_242_880 }, async (request, reply) => {
    // Support both AI SDK DefaultChatTransport and legacy format
    const body = request.body as Record<string, unknown> | undefined;
    let message: string;
    let agentName: string | undefined;
    let sessionId: string | undefined;
    let fileParts: Array<{ type: string; data?: string; url?: string; mediaType?: string; mimeType?: string; filename?: string; name?: string }> = [];

    if (body?.messages && Array.isArray(body.messages)) {
      // AI SDK DefaultChatTransport format: { id, messages: [{ role, parts: [{ type: "text", text }] }], trigger, sessionId, agent }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lastMsg = (body.messages as Array<{ role: string; parts?: Array<Record<string, any>> }>).at(-1);
      const textParts = lastMsg?.parts?.filter((p) => p.type === "text") ?? [];
      message = textParts.map((p) => p.text).filter(Boolean).join("\n\n");
      fileParts = (lastMsg?.parts?.filter((p) => p.type === "file") ?? []) as typeof fileParts;
      agentName = body.agent as string | undefined;
      sessionId = (body.sessionId as string | undefined) ?? (body.id as string | undefined);
    } else if (body?.message && typeof body.message === "object" && (body.message as Record<string, unknown>).parts) {
      // Single message with parts: { id, message: { parts: [{ type: "text", text }] }, agent }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parts = ((body.message as Record<string, unknown>).parts as Array<Record<string, any>>) ?? [];
      const textParts = parts.filter((p) => p.type === "text");
      message = textParts.map((p) => p.text).filter(Boolean).join("\n\n");
      fileParts = (parts.filter((p) => p.type === "file") ?? []) as typeof fileParts;
      agentName = body.agent as string | undefined;
      sessionId = body.id as string | undefined;
    } else {
      // Legacy format: { message: "string", agent, sessionId }
      message = body?.message as string ?? "";
      agentName = body?.agent as string | undefined;
      sessionId = body?.sessionId as string | undefined;
    }

    // Process file attachments — decode, store in knowledge, and inject into message context
    const documentSections: string[] = [];
    const uploadedDocNames: string[] = [];
    for (const fp of fileParts) {
      try {
        const rawData = fp.data ?? fp.url ?? "";
        const mime = fp.mediaType ?? fp.mimeType ?? "text/plain";
        const fileName = fp.filename ?? fp.name ?? `document-${Date.now()}.txt`;

        // Decode raw bytes from base64 / data URL
        let rawBuffer: Buffer;
        if (rawData.startsWith("data:")) {
          const commaIdx = rawData.indexOf(",");
          rawBuffer = Buffer.from(rawData.slice(commaIdx + 1), "base64");
        } else if (rawData.length > 0) {
          rawBuffer = Buffer.from(rawData, "base64");
        } else {
          continue;
        }

        let content: string;

        if (isBinaryDocument(mime, fileName)) {
          // PDF, Excel — parse binary format to extract text
          try {
            content = await parseBinaryDocument(rawBuffer, mime, fileName);
          } catch (err) {
            ctx.logger.warn(`Failed to parse binary document ${fileName}: ${err instanceof Error ? err.message : String(err)}`);
            continue;
          }
        } else {
          // Text-based documents
          const isText = mime.startsWith("text/") ||
            ["application/json", "application/xml", "application/csv"].includes(mime) ||
            /\.(txt|md|markdown|csv|json|xml|html|htm|log|yaml|yml|toml|ini|cfg|conf|ts|js|py|sh|sql|css)$/i.test(fileName);
          if (!isText) continue;
          content = rawBuffer.toString("utf-8");
        }

        if (content.trim().length === 0) continue;

        // Store in knowledge base for future retrieval
        const safeName = fileName.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 120);
        const sourceUrl = `upload://${Date.now()}-${safeName}`;
        try {
          await learnFromContent(ctx.storage, ctx.llm, sourceUrl, fileName, content, { force: true });
          ctx.logger.info("Chat document uploaded to knowledge", { fileName, chars: content.length });
        } catch (err) {
          ctx.logger.warn(`Failed to store chat document in knowledge: ${err instanceof Error ? err.message : String(err)}`);
        }

        // Inject document content into the LLM context (truncate large files)
        const snippet = content.length > 12_000 ? content.slice(0, 12_000) + "\n\n[... document truncated — use knowledge_search to query the full content ...]" : content;
        documentSections.push(`<document name="${fileName}">\n${snippet}\n</document>`);
        uploadedDocNames.push(fileName);
      } catch (err) {
        ctx.logger.warn(`Failed to process chat attachment: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Prepend document content to the user message so the LLM can reference it
    if (documentSections.length > 0) {
      const docPrefix = `The user has uploaded ${documentSections.length} document(s). Here are the contents:\n\n${documentSections.join("\n\n")}\n\n`;
      message = message
        ? `${docPrefix}User message: ${message}`
        : `${docPrefix}Please analyze the uploaded document(s) and provide a summary with key insights.`;
    }

    if (!message) return reply.status(400).send({ error: "message is required" });

    // Find agent
    const agentPlugin = agentName
      ? agents.find((a) => a.name === agentName)
      : agents[0];
    if (!agentPlugin) return reply.status(404).send({ error: "Agent not found" });

    // Ensure a thread exists (auto-create when missing)
    const ensured = ensureThread(ctx.storage, { id: sessionId, agentName });
    const sid = ensured.thread.id;
    if (ensured.created || (sessionId && sessionId !== sid)) {
      reply.header("X-Thread-Id", sid);
    }

    // Inject current date/time so the LLM knows the current moment
    const owner = getOwner(ctx.storage);
    const ownerName = owner?.name || owner?.email?.split("@")[0] || "the owner";
    // Fetch owner's core preferences (lightweight SQL query, no embedding calls)
    const corePrefs = getCorePreferences(ctx.storage);
    const prefsBlock = corePrefs.length > 0
      ? `\n\n## ${ownerName}'s core preferences (always apply these)\n${corePrefs.map((b) => `- ${b.statement}`).join("\n")}`
      : "";

    const dt = formatDateTime(ctx.config.timezone);
    let systemPrompt = agentPlugin.agent.systemPrompt +
      `\n\nCurrent date and time: ${dt.full}. Use this for time-sensitive queries.` +
      `\n\nYour owner's name is ${ownerName}. You are talking to them via the web UI. When they say "my" or "I", it refers to ${ownerName}. Memories tagged "owner" are about this person. Do not confuse ${ownerName} with other people mentioned in memories.` +
      prefsBlock;
    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        await withThreadLock(sid, async () => {
          const budget = getContextBudget(ctx.config.llm.provider, ctx.config.llm.model, ctx.config.llm.contextWindow);
          const historyRows = listMessages(ctx.storage, sid, { limit: budget.maxMessages });
          const history: ChatMessage[] = [];
          let historyTokens = 0;
          // Iterate newest-first, stop when token budget exceeded
          for (let i = historyRows.length - 1; i >= 0; i--) {
            const row = historyRows[i]!;
            let content = row.content;
            // Inject tool call summaries so the LLM has context from previous turns
            if (row.role === "assistant" && row.parts_json) {
              try {
                const parts = JSON.parse(row.parts_json) as { toolCalls?: string[] };
                if (parts.toolCalls && parts.toolCalls.length > 0) {
                  const summary = parts.toolCalls.join("\n");
                  content = `[Previous tool results:\n${summary}]\n\n${content}`;
                }
              } catch { /* ignore parse errors */ }
            }
            const msgTokens = estimateTokens(content);
            if (historyTokens + msgTokens > budget.historyBudget) break;
            historyTokens += msgTokens;
            history.unshift({ role: row.role, content });
          }

          ctx.logger.info("Context budget", {
            model: ctx.config.llm.model,
            contextWindow: budget.contextWindow,
            historyBudget: budget.historyBudget,
            loadedMessages: history.length,
            estimatedTokens: historyTokens,
          });

          const agentCtx: AgentContext = {
            ...ctx,
            userMessage: message,
            conversationHistory: [...history],
          };

          // Attach thread ID and chat ID for tools that need them (research, schedules)
          (agentCtx as unknown as Record<string, unknown>).threadId = sid;
          // Resolve chat_id from thread for Telegram-originated chats
          try {
            const chatRow = ctx.storage.query<{ chat_id: number }>(
              "SELECT chat_id FROM telegram_threads WHERE thread_id = ?",
              [sid],
            );
            if (chatRow[0]) {
              (agentCtx as unknown as Record<string, unknown>).chatId = chatRow[0].chat_id;
            }
          } catch { /* table may not exist */ }

          const tools = agentPlugin.agent.createTools?.(agentCtx) as Record<string, unknown> | undefined;

          // Inject sub-agent delegation tools: let the assistant call other agents
          if (tools && agentPlugin.name === "assistant") {
            for (const subAgent of agents) {
              if (subAgent.name === agentPlugin.name) continue;
              const subTools = subAgent.agent.createTools?.(agentCtx);
              if (!subTools) continue;
              tools[`agent_${subAgent.name}`] = tool({
                description: `Delegate to the ${subAgent.agent.displayName} sub-agent. ${subAgent.agent.description}`,
                inputSchema: z.object({
                  task: z.string().describe("What to ask the sub-agent to do"),
                }),
                execute: async ({ task }) => {
                  const result = await generateText({
                    model: ctx.llm.getModel() as LanguageModel,
                    system: subAgent.agent.systemPrompt,
                    messages: [{ role: "user" as const, content: task }],
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    tools: subTools as any,
                    toolChoice: "auto",
                    stopWhen: stepCountIs(5),
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    providerOptions: getProviderOptions(ctx.config.llm.provider, budget.contextWindow) as any,
                  });
                  return result.text;
                },
              });
            }
          }

          const messages: ChatMessage[] = [
            ...history,
            { role: "user", content: message },
          ];

          let finishLock: () => void;
          let finished = false;
          const finish = () => {
            if (finished) return;
            finished = true;
            finishLock();
          };
          const lockPromise = new Promise<void>((resolve) => {
            finishLock = resolve;
          });

          let result: ReturnType<typeof streamText>;
          try {
            result = streamText({
              model: ctx.llm.getModel() as LanguageModel,
              system: systemPrompt,
              messages: messages.map((m) => ({ role: m.role, content: m.content })),
              temperature: 0.7,
              maxRetries: 1,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              tools: tools as any,
              toolChoice: tools ? "auto" : undefined,
              stopWhen: tools ? stepCountIs(15) : undefined,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              providerOptions: getProviderOptions(ctx.config.llm.provider, budget.contextWindow) as any,
              onError: ({ error }) => {
                ctx.logger.error("streamText error (multi-step)", {
                  error: error instanceof Error ? error.message : String(error),
                });
                finish();
              },
              onFinish: async ({ text, steps }) => {
                try {
                  ctx.logger.info("streamText finished", { textLength: text.length, steps: steps.length });

                  const toPersist: ThreadMessageInput[] = [
                    { role: "user", content: message },
                  ];

                  // Summarize tool calls (if any) for context continuity
                  const toolSummaries: string[] = [];
                  if (steps) {
                    for (const step of steps) {
                      const stepAny = step as { toolCalls?: unknown[]; toolResults?: unknown[] };
                      if (stepAny.toolCalls && stepAny.toolResults) {
                        for (let i = 0; i < stepAny.toolCalls.length; i++) {
                          const tc = stepAny.toolCalls[i] as { toolName?: string; args?: unknown };
                          const tr = stepAny.toolResults[i] as { result?: unknown; output?: unknown };
                          if (tc) {
                            const raw = tr?.output ?? tr?.result ?? tr;
                            const resultStr = typeof raw === "string"
                              ? raw.slice(0, 200)
                              : JSON.stringify(raw).slice(0, 200);
                            toolSummaries.push(`[${tc.toolName ?? "tool"}] → ${resultStr}`);
                          }
                        }
                      }
                    }
                  }
                  // If all steps were tool calls with no final text (hit step limit),
                  // generate a fallback summary so the user always sees a response
                  const assistantText = text || (toolSummaries.length > 0
                    ? "I gathered some information but ran out of processing steps. Here's what I found — please ask a follow-up if you need more detail."
                    : "");

                  if (assistantText) {
                    toPersist.push({
                      role: "assistant",
                      content: assistantText,
                      partsJson: toolSummaries.length > 0 ? JSON.stringify({ toolCalls: toolSummaries }) : undefined,
                    });
                  }

                  appendMessages(ctx.storage, sid, toPersist, {
                    maxMessages: MAX_MESSAGES_PER_THREAD,
                    titleCandidate: autoTitle(message),
                  });

                  // afterResponse — fire and forget, but log errors
                  if (agentPlugin.agent.afterResponse) {
                    agentPlugin.agent.afterResponse(agentCtx, text).catch((err) => {
                      ctx.logger.warn(`afterResponse failed: ${err instanceof Error ? err.message : String(err)}`);
                    });
                  }

                  // Background tasks based on user turn count (fire and forget)
                  const userTurnRow = ctx.storage.query<{ count: number }>(
                    "SELECT COUNT(*) AS count FROM thread_messages WHERE thread_id = ? AND role = 'user'",
                    [sid],
                  );
                  const userTurnCount = userTurnRow[0]?.count ?? 0;

                  // Consolidate conversation every 5 user turns
                  if (userTurnCount > 0 && userTurnCount % 5 === 0) {
                    const recentTurns = listMessages(ctx.storage, sid, { limit: 10 })
                      .map((row) => ({ role: row.role, content: row.content }));
                    consolidateConversation(ctx.storage, ctx.llm, recentTurns, ctx.logger).catch((err) => {
                      ctx.logger.warn(`Consolidation failed: ${err instanceof Error ? err.message : String(err)}`);
                    });
                  }

                  // Generate/refresh thread title via LLM (awaited so UI picks up the new title on refresh)
                  const shouldTitle = userTurnCount === TITLE_GENERATE_AT
                    || (userTurnCount > TITLE_GENERATE_AT && (userTurnCount - TITLE_GENERATE_AT) % TITLE_REFRESH_EVERY === 0);
                  if (shouldTitle) {
                    const allMessages = listMessages(ctx.storage, sid, { limit: 10 })
                      .map((row) => ({ role: row.role, content: row.content }));
                    await generateThreadTitle(ctx, sid, allMessages).catch((err) => {
                      ctx.logger.warn(`Title generation failed: ${err instanceof Error ? err.message : String(err)}`);
                    });
                  }
                } catch (err) {
                  ctx.logger.error("Failed to persist streamText result", {
                    error: err instanceof Error ? err.message : String(err),
                    stack: err instanceof Error ? err.stack : undefined,
                  });
                } finally {
                  finish();
                }
              },
            });
          } catch (err) {
            finish();
            throw err;
          }

          await forwardSafeUIMessageChunks(
            writer as { write: (chunk: SafeUIChunk) => void },
            result.fullStream as AsyncIterable<{ type: string; [key: string]: unknown }>,
          );
          await lockPromise;
        });
      },
      onError: (error) => {
        ctx.logger.error("Chat stream error", {
          error: error instanceof Error ? error.message : String(error),
        });
        // Never leak internal details — only expose safe, known error patterns
        const msg = error instanceof Error ? error.message : String(error);
        const safePatterns = [
          /rate limit/i, /too many requests/i, /timeout/i,
          /model not found/i, /invalid.*api.*key/i, /unauthorized/i,
          /quota exceeded/i, /content.*filter/i, /context.*length/i,
        ];
        const isSafe = safePatterns.some((p) => p.test(msg));
        return isSafe ? msg : "An internal error occurred";
      },
    });

    // Convert Web ReadableStream to Node Readable via createUIMessageStreamResponse
    const response = createUIMessageStreamResponse({ stream });
    reply.header("Content-Type", response.headers.get("content-type") ?? "text/event-stream; charset=utf-8");
    reply.header("Cache-Control", "no-store, no-cache, must-revalidate");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Accel-Buffering", "no");
    try {
      const nodeStream = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream);

      // SSE heartbeat — keep connection alive and detect dead clients
      const heartbeat = setInterval(() => {
        try { reply.raw.write(": ping\n\n"); } catch { clearInterval(heartbeat); }
      }, HEARTBEAT_INTERVAL_MS);

      // SSE absolute timeout — prevent indefinitely hanging connections
      const timeout = setTimeout(() => {
        try { reply.raw.end(); } catch { /* ignore */ }
      }, STREAM_TIMEOUT_MS);

      // Clean up timers when stream ends
      nodeStream.on("end", () => { clearInterval(heartbeat); clearTimeout(timeout); });
      nodeStream.on("error", (err) => {
        clearInterval(heartbeat);
        clearTimeout(timeout);
        ctx.logger.warn(`Chat stream error: ${err instanceof Error ? err.message : String(err)}`);
      });

      return reply.send(nodeStream);
    } catch (err) {
      ctx.logger.warn(`Stream conversion failed: ${err instanceof Error ? err.message : String(err)}`);
      return reply.status(500).send({ error: "Stream failed" });
    }
  });

  // Get conversation history
  app.get<{ Querystring: { sessionId?: string } }>("/api/chat/history", async (request) => {
    const sid = request.query.sessionId ?? "default";
    const rows = listMessages(ctx.storage, sid, { limit: MAX_MESSAGES_PER_THREAD });
    return rows.map((row) => ({ role: row.role, content: row.content })) as ChatMessage[];
  });

  // Clear conversation
  app.delete<{ Querystring: { sessionId?: string } }>("/api/chat/history", async (request) => {
    const sid = request.query.sessionId ?? "default";
    clearThread(ctx.storage, sid);
    return { ok: true };
  });
}

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
} from "@personal-ai/core";
import { streamText, generateText, createUIMessageStream, createUIMessageStreamResponse, stepCountIs, tool } from "ai";
import type { LanguageModel } from "ai";
import { z } from "zod";
import { validate } from "../validate.js";

export { threadMigrations };

const MAX_MESSAGES_PER_THREAD = 500;
const TITLE_GENERATE_AT = 3;   // Generate LLM title after this many user turns
const TITLE_REFRESH_EVERY = 5; // Re-check title every N user turns after that
const STREAM_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const HEARTBEAT_INTERVAL_MS = 30 * 1000;  // 30 seconds

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
  app.post<{ Body: { title?: string; agentName?: string } }>("/api/threads", async (request) => {
    const thread = createThread(ctx.storage, {
      title: request.body?.title,
      agentName: request.body?.agentName,
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
  app.post("/api/chat", async (request, reply) => {
    // Support both AI SDK DefaultChatTransport and legacy format
    const body = request.body as Record<string, unknown> | undefined;
    let message: string;
    let agentName: string | undefined;
    let sessionId: string | undefined;

    if (body?.messages && Array.isArray(body.messages)) {
      // AI SDK DefaultChatTransport format: { id, messages: [{ role, parts: [{ type: "text", text }] }], trigger, sessionId, agent }
      const lastMsg = (body.messages as Array<{ role: string; parts?: Array<{ type: string; text?: string }> }>).at(-1);
      const textPart = lastMsg?.parts?.find((p) => p.type === "text");
      message = textPart?.text ?? "";
      agentName = body.agent as string | undefined;
      sessionId = (body.sessionId as string | undefined) ?? (body.id as string | undefined);
    } else if (body?.message && typeof body.message === "object" && (body.message as Record<string, unknown>).parts) {
      // Single message with parts: { id, message: { parts: [{ type: "text", text }] }, agent }
      const parts = ((body.message as Record<string, unknown>).parts as Array<{ type: string; text?: string }>) ?? [];
      const textPart = parts.find((p) => p.type === "text");
      message = textPart?.text ?? "";
      agentName = body.agent as string | undefined;
      sessionId = body.id as string | undefined;
    } else {
      // Legacy format: { message: "string", agent, sessionId }
      message = body?.message as string ?? "";
      agentName = body?.agent as string | undefined;
      sessionId = body?.sessionId as string | undefined;
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
    const now = new Date();
    const owner = getOwner(ctx.storage);
    const ownerName = owner?.name || owner?.email?.split("@")[0] || "the owner";
    let systemPrompt = agentPlugin.agent.systemPrompt +
      `\n\nCurrent date and time: ${now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}, ${now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true })}. Use this for time-sensitive queries.` +
      `\n\nYour owner's name is ${ownerName}. You are talking to them via the web UI. When they say "my" or "I", it refers to ${ownerName}. Memories tagged "owner" are about this person. Do not confuse ${ownerName} with other people mentioned in memories.`;
    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        await withThreadLock(sid, async () => {
          const historyRows = listMessages(ctx.storage, sid, { limit: 20 });
          const history: ChatMessage[] = [];
          for (const row of historyRows) {
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
            history.push({ role: row.role, content });
          }

          const agentCtx: AgentContext = {
            ...ctx,
            userMessage: message,
            conversationHistory: [...history],
          };

          // Attach thread ID for background jobs (research_start needs it)
          (agentCtx as unknown as Record<string, unknown>).threadId = sid;

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
              stopWhen: tools ? stepCountIs(2) : undefined,
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
                            const raw = tr?.result ?? tr?.output ?? tr;
                            const resultStr = typeof raw === "string"
                              ? raw.slice(0, 200)
                              : JSON.stringify(raw).slice(0, 200);
                            toolSummaries.push(`[${tc.toolName ?? "tool"}] → ${resultStr}`);
                          }
                        }
                      }
                    }
                  }
                  if (text) {
                    toPersist.push({
                      role: "assistant",
                      content: text,
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

                  // Generate/refresh thread title via LLM
                  const shouldTitle = userTurnCount === TITLE_GENERATE_AT
                    || (userTurnCount > TITLE_GENERATE_AT && (userTurnCount - TITLE_GENERATE_AT) % TITLE_REFRESH_EVERY === 0);
                  if (shouldTitle) {
                    const allMessages = listMessages(ctx.storage, sid, { limit: 10 })
                      .map((row) => ({ role: row.role, content: row.content }));
                    generateThreadTitle(ctx, sid, allMessages).catch((err) => {
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

          writer.merge(result.toUIMessageStream({ sendStart: false }));
          result.consumeStream().then(undefined, (err: unknown) => {
            ctx.logger.warn(`consumeStream failed: ${err instanceof Error ? err.message : String(err)}`);
          });

          await lockPromise;
        });
      },
      onError: (error) => {
        ctx.logger.error("Chat stream error", {
          error: error instanceof Error ? error.message : String(error),
        });
        // Don't leak internal error details to the client
        const msg = error instanceof Error ? error.message : String(error);
        const isInternal = /at\s|node_modules|SQL|database|SQLITE/i.test(msg);
        return isInternal ? "An internal error occurred" : msg;
      },
    });

    // Convert Web ReadableStream to Node Readable via createUIMessageStreamResponse
    const response = createUIMessageStreamResponse({ stream });
    reply.header("Content-Type", response.headers.get("content-type") ?? "text/event-stream; charset=utf-8");
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

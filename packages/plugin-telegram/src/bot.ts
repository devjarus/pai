import { Bot, type CommandContext, type Context } from "grammy";
import type { AgentPlugin, PluginContext } from "@personal-ai/core";
import { listBeliefs, getThread, formatDateTime, parseTimestamp, getArtifact, correctBelief, recordProductEvent } from "@personal-ai/core";
import { addTask, completeTask, listTasks } from "@personal-ai/plugin-tasks";
import { listResearchJobs, createResearchJob, runResearchInBackground } from "@personal-ai/plugin-research";
import type { ResearchContext } from "@personal-ai/plugin-research";
import { listSwarmJobs } from "@personal-ai/plugin-swarm";
import { listPrograms } from "@personal-ai/plugin-schedules";
import { webSearch, formatSearchResults } from "@personal-ai/plugin-assistant/web-search";
import { fetchPageAsMarkdown } from "@personal-ai/plugin-assistant/page-fetch";
import { runAgentChat, createThread, clearThread as clearThreadMessages } from "./chat.js";
import {
  markdownToTelegramHTML,
  splitMessage,
  escapeHTML,
  formatTelegramResponse,
  isComplexContent,
  stripHtmlTags,
  buildTelegramDigestMarkdown,
} from "./formatter.js";
import { bufferMessage, passiveProcess } from "./passive.js";
import { sendArtifactsToTelegram } from "./delivery.js";
import { sendReportDocumentToTelegram } from "./report-document.js";

/** Tool name → human-friendly status emoji */
const TOOL_STATUS: Record<string, string> = {
  web_search: "\uD83D\uDD0D Searching the web...",
  memory_recall: "\uD83E\uDDE0 Recalling memories...",
  memory_remember: "\uD83D\uDCDD Storing in memory...",
  memory_beliefs: "\uD83D\uDCDA Listing memories...",
  memory_correct: "\uD83E\uDDFD Correcting memory...",
  task_list: "\uD83D\uDCCB Checking saved moves...",
  task_add: "\u2795 Saving move...",
  task_done: "\u2705 Marking move done...",
};

function toolStatus(toolName: string): string {
  return TOOL_STATUS[toolName] ?? `\u2699\uFE0F Using ${toolName}...`;
}

function formatRelativeTime(isoDate: string): string {
  const diffMs = Date.now() - parseTimestamp(isoDate).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Get or create a thread ID for a Telegram chat.
 * Uses the `telegram_threads` mapping table.
 */
function getOrCreateThread(ctx: PluginContext, chatId: number, username?: string): string {
  const rows = ctx.storage.query<{ thread_id: string }>(
    "SELECT thread_id FROM telegram_threads WHERE chat_id = ?", [chatId],
  );
  const existing = rows[0];
  if (existing) {
    // Verify the thread still exists (could have been deleted externally)
    const threadExists = getThread(ctx.storage, existing.thread_id);
    if (threadExists) return existing.thread_id;
    // Stale mapping — clean it up
    ctx.storage.run("DELETE FROM telegram_threads WHERE chat_id = ?", [chatId]);
  }

  // Create a new thread
  const threadId = createThread(ctx, "assistant");

  ctx.storage.run(
    "INSERT INTO telegram_threads (chat_id, thread_id, username, created_at) VALUES (?, ?, ?, ?)",
    [chatId, threadId, username ?? null, new Date().toISOString()],
  );

  return threadId;
}

/** Delete the thread mapping for a Telegram chat */
function clearThread(ctx: PluginContext, chatId: number): void {
  const rows = ctx.storage.query<{ thread_id: string }>(
    "SELECT thread_id FROM telegram_threads WHERE chat_id = ?", [chatId],
  );
  const existing = rows[0];
  if (existing) {
    clearThreadMessages(ctx, existing.thread_id);
  }
}

function getExistingThreadId(ctx: PluginContext, chatId: number): string | null {
  const rows = ctx.storage.query<{ thread_id: string }>(
    "SELECT thread_id FROM telegram_threads WHERE chat_id = ?",
    [chatId],
  );
  return rows[0]?.thread_id ?? null;
}

function parseBriefSummary(sections: string): string {
  try {
    const parsed = JSON.parse(sections) as Record<string, unknown>;
    const recommendation = parsed.recommendation;
    if (recommendation && typeof recommendation === "object") {
      const summary = (recommendation as Record<string, unknown>).summary;
      if (typeof summary === "string" && summary.trim().length > 0) {
        return summary.trim();
      }
    }
    if (typeof parsed.goal === "string" && parsed.goal.trim().length > 0) {
      return parsed.goal.trim();
    }
    if (typeof parsed.report === "string" && parsed.report.trim().length > 0) {
      return parsed.report.split("\n").map((line) => line.trim()).find(Boolean) ?? "Digest ready";
    }
  } catch {
    return "Digest ready";
  }
  return "Brief ready";
}

function resolveBriefing(ctx: PluginContext, rawId: string): { id: string; type: string; sections: string } | null {
  const exact = ctx.storage.query<{ id: string; type: string; sections: string }>(
    "SELECT id, type, sections FROM briefings WHERE id = ? AND status = 'ready'",
    [rawId],
  )[0];
  if (exact) return exact;
  const prefix = ctx.storage.query<{ id: string; type: string; sections: string }>(
    "SELECT id, type, sections FROM briefings WHERE id LIKE ? AND status = 'ready' ORDER BY generated_at DESC LIMIT 2",
    [`${rawId}%`],
  );
  return prefix.length === 1 ? (prefix[0] ?? null) : null;
}

function listRecentBriefingsForChat(ctx: PluginContext, chatId: number, username?: string) {
  const threadId = getExistingThreadId(ctx, chatId);
  const isOwner = Boolean(ctx.config.telegram?.ownerUsername && username === ctx.config.telegram.ownerUsername);

  if (threadId && isOwner) {
    return ctx.storage.query<{ id: string; type: string; generated_at: string; sections: string }>(
      `SELECT id, type, generated_at, sections
       FROM briefings
       WHERE status = 'ready' AND (thread_id = ? OR type = 'daily')
       ORDER BY generated_at DESC
       LIMIT 5`,
      [threadId],
    );
  }

  if (threadId) {
    return ctx.storage.query<{ id: string; type: string; generated_at: string; sections: string }>(
      `SELECT id, type, generated_at, sections
       FROM briefings
       WHERE status = 'ready' AND thread_id = ?
       ORDER BY generated_at DESC
       LIMIT 5`,
      [threadId],
    );
  }

  if (isOwner) {
    return ctx.storage.query<{ id: string; type: string; generated_at: string; sections: string }>(
      `SELECT id, type, generated_at, sections
       FROM briefings
       WHERE status = 'ready' AND type = 'daily'
       ORDER BY generated_at DESC
       LIMIT 5`,
    );
  }

  return [] as Array<{ id: string; type: string; generated_at: string; sections: string }>;
}

export function createBot(token: string, ctx: PluginContext, agentPlugin: AgentPlugin, subAgents?: AgentPlugin[]): Bot {
  const bot = new Bot(token);

  // Register commands with Telegram so they show in the / menu
  bot.api.setMyCommands([
    { command: "start", description: "Welcome message" },
    { command: "help", description: "List available commands" },
    { command: "digests", description: "Show recent digests" },
    { command: "watches", description: "Show active Watches" },
    { command: "clear", description: "Clear conversation history" },
    { command: "tasks", description: "Show saved moves" },
    { command: "library", description: "Show recent memories" },
    { command: "reply", description: "Reply to a digest by ID" },
    { command: "todo", description: "Save a to-do from a digest" },
    { command: "done", description: "Mark a saved move done" },
    { command: "correct", description: "Correct a memory by ID" },
  ]).catch((err) => {
    ctx.logger.warn(`Failed to register bot commands: ${err instanceof Error ? err.message : String(err)}`);
  });

  // /start — Welcome
  bot.command("start", async (tgCtx) => {
    await tgCtx.reply(
      "<b>Welcome to Personal AI!</b>\n\n" +
      "I'm your personal assistant with persistent memory, web search, and saved moves when you want me to keep a move alive.\n\n" +
      "Just send me a message and I'll respond. I remember our conversations across sessions.\n\n" +
      "<b>Commands:</b>\n" +
      "/help — Show available commands\n" +
      "/digests — Show recent digests for this chat\n" +
      "/watches — Show active Watches\n" +
      "/clear — Start a fresh conversation\n" +
      "/tasks — Show your saved moves\n" +
      "/library — Show recent memories\n" +
      "/reply &lt;digest-id&gt; &lt;message&gt; — Follow up on a digest\n" +
      "/todo &lt;digest-id&gt; | &lt;title&gt; — Save a to-do from a digest\n" +
      "/done &lt;move-id&gt; — Mark a saved move done\n" +
      "/correct &lt;memory-id&gt; | &lt;replacement&gt; — Correct a memory",
      { parse_mode: "HTML" },
    );
  });

  // /help
  bot.command("help", async (tgCtx) => {
    await tgCtx.reply(
      "<b>Available Commands</b>\n\n" +
      "/start — Welcome message\n" +
      "/help — This help message\n" +
      "/digests — Show recent digests for this chat\n" +
      "/watches — List active Watches\n" +
      "/clear — Clear conversation history and start fresh\n" +
      "/tasks — List your saved moves\n" +
      "/library — Show your top 10 memories\n" +
      "/reply &lt;digest-id&gt; &lt;message&gt; — Continue a digest discussion\n" +
      "/todo &lt;digest-id&gt; | &lt;title&gt; — Save a to-do linked to a digest\n" +
      "/done &lt;move-id&gt; — Mark a saved move done\n" +
      "/correct &lt;memory-id&gt; | &lt;replacement&gt; — Replace a memory used by future digests\n\n" +
      "Or just send any message to chat!",
      { parse_mode: "HTML" },
    );
  });

  const digestsHandler = async (tgCtx: CommandContext<Context>) => {
    try {
      const briefings = listRecentBriefingsForChat(ctx, tgCtx.chat.id, tgCtx.from?.username);
      if (briefings.length === 0) {
        await tgCtx.reply("No recent digests are linked to this chat yet.");
        return;
      }
      const lines = briefings.map((briefing) => {
        const summary = parseBriefSummary(briefing.sections);
        return `• <code>${escapeHTML(briefing.id.slice(0, 12))}</code> · ${escapeHTML(briefing.type)} · ${escapeHTML(formatRelativeTime(briefing.generated_at))}\n${escapeHTML(summary.slice(0, 140))}`;
      });
      await tgCtx.reply(`<b>Recent Digests</b>\n\n${lines.join("\n\n")}`, { parse_mode: "HTML" });
    } catch (err) {
      ctx.logger.error("Failed to list Telegram digests", { error: err instanceof Error ? err.message : String(err) });
      await tgCtx.reply("Failed to load recent digests.");
    }
  };
  bot.command("digests", digestsHandler);
  bot.command("briefs", digestsHandler); // legacy alias

  const watchesHandler = async (tgCtx: CommandContext<Context>) => {
    try {
      const threadId = getExistingThreadId(ctx, tgCtx.chat.id);
      const activePrograms = listPrograms(ctx.storage, "active");
      const programs = threadId
        ? activePrograms.filter((program) => program.threadId === threadId || program.chatId === tgCtx.chat.id)
        : activePrograms;
      if (programs.length === 0) {
        await tgCtx.reply("No active Watches for this chat yet. Ask me to keep watching something.");
        return;
      }
      const lines = programs.slice(0, 8).map((program) => {
        const cadence = program.intervalHours >= 24 ? `${Math.round(program.intervalHours / 24)}d` : `${program.intervalHours}h`;
        const delivery = program.deliveryMode === "change-gated" ? "change-gated" : "interval";
        return `• <b>${escapeHTML(program.title)}</b> (${escapeHTML(program.family)} · ${escapeHTML(program.executionMode)} · ${delivery})\nNext digest: ${escapeHTML(formatDateTime(ctx.config.timezone, parseTimestamp(program.nextRunAt)).full)} · cadence ${escapeHTML(cadence)}`;
      });
      await tgCtx.reply(`<b>Active Watches</b>\n\n${lines.join("\n\n")}`, { parse_mode: "HTML" });
    } catch (err) {
      ctx.logger.error("Failed to list Telegram watches", { error: err instanceof Error ? err.message : String(err) });
      await tgCtx.reply("Failed to load Watches.");
    }
  };
  bot.command("watches", watchesHandler);
  bot.command("programs", watchesHandler); // legacy alias

  bot.command("reply", async (tgCtx) => {
    const raw = tgCtx.match?.trim() ?? "";
    const firstSpace = raw.indexOf(" ");
    if (firstSpace <= 0) {
      await tgCtx.reply("Usage: /reply <digest-id> <message>");
      return;
    }
    const briefId = raw.slice(0, firstSpace).trim();
    const message = raw.slice(firstSpace + 1).trim();
    const briefing = resolveBriefing(ctx, briefId);
    if (!briefing || !message) {
      await tgCtx.reply("Digest not found, or the reply message is empty.");
      return;
    }
    const threadId = getOrCreateThread(ctx, tgCtx.chat.id, tgCtx.from?.username);
    recordProductEvent(ctx.storage, {
      eventType: "brief_followup_asked",
      briefId: briefing.id,
      threadId,
      channel: "telegram",
      metadata: { command: "reply" },
    });
    await handleChat(
      tgCtx.chat.id,
      `Continue the discussion for digest ${briefing.id}. Digest summary: ${parseBriefSummary(briefing.sections)}\n\nUser follow-up: ${message}`,
      { username: tgCtx.from?.username, displayName: tgCtx.from?.first_name },
      bot.api.sendMessage.bind(bot.api),
      tgCtx.chat.type,
    );
  });

  const todoHandler = async (tgCtx: CommandContext<Context>) => {
    const raw = tgCtx.match?.trim() ?? "";
    const [briefId, actionTitle] = raw.split("|").map((part) => part.trim());
    if (!briefId || !actionTitle) {
      await tgCtx.reply("Usage: /todo <digest-id> | <to-do title>");
      return;
    }
    const briefing = resolveBriefing(ctx, briefId);
    if (!briefing) {
      await tgCtx.reply("Digest not found.");
      return;
    }
    try {
      const task = addTask(ctx.storage, {
        title: actionTitle,
        description: `Created from Telegram for brief ${briefing.id}.\n\nBrief summary: ${parseBriefSummary(briefing.sections)}`,
        priority: "medium",
        sourceType: "briefing",
        sourceId: briefing.id,
        sourceLabel: parseBriefSummary(briefing.sections).slice(0, 120),
      });
      recordProductEvent(ctx.storage, {
        eventType: "brief_action_created",
        briefId: briefing.id,
        threadId: getExistingThreadId(ctx, tgCtx.chat.id),
        channel: "telegram",
        metadata: { taskId: task.id },
      });
      await tgCtx.reply(`Move saved: ${task.title}\nReference ID: ${task.id.slice(0, 8)}`);
    } catch (err) {
      await tgCtx.reply(`Failed to save move: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  };
  bot.command("todo", todoHandler);
  bot.command("action", todoHandler); // legacy alias

  bot.command("done", async (tgCtx) => {
    const taskId = tgCtx.match?.trim();
    if (!taskId) {
      await tgCtx.reply("Usage: /done <task-id>");
      return;
    }
    try {
      const task = listTasks(ctx.storage, "all").find((item) => item.id === taskId || item.id.startsWith(taskId));
      completeTask(ctx.storage, taskId);
      if (task?.source_type === "briefing") {
        recordProductEvent(ctx.storage, {
          eventType: "brief_action_completed",
          briefId: task.source_id,
          threadId: getExistingThreadId(ctx, tgCtx.chat.id),
          channel: "telegram",
          metadata: { taskId: task.id },
        });
      }
      await tgCtx.reply("Move marked done.");
    } catch (err) {
      await tgCtx.reply(`Failed to mark move done: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  });

  bot.command("correct", async (tgCtx) => {
    const raw = tgCtx.match?.trim() ?? "";
    const [beliefId, replacement] = raw.split("|").map((part) => part.trim());
    if (!beliefId || !replacement) {
      await tgCtx.reply("Usage: /correct <memory-id> | <replacement memory>");
      return;
    }
    try {
      const result = await correctBelief(ctx.storage, ctx.llm, beliefId, {
        statement: replacement,
        note: `Telegram correction from chat ${tgCtx.chat.id}`,
      });
      recordProductEvent(ctx.storage, {
        eventType: "belief_corrected",
        beliefId: result.replacementBelief.id,
        threadId: getExistingThreadId(ctx, tgCtx.chat.id),
        channel: "telegram",
        metadata: {
          invalidatedBeliefId: result.invalidatedBelief.id,
          correctionEpisodeId: result.correctionEpisode.id,
        },
      });
      await tgCtx.reply("Memory corrected. Future digests will use the replacement memory.");
    } catch (err) {
      await tgCtx.reply(`Failed to correct memory: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  });

  // /clear — Reset conversation
  bot.command("clear", async (tgCtx) => {
    const chatId = tgCtx.chat.id;
    clearThread(ctx, chatId);
    await tgCtx.reply("Conversation cleared. Send a message to start fresh!");
  });

  // /tasks — Show open saved moves
  bot.command("tasks", async (tgCtx) => {
    try {
      const tasks = listTasks(ctx.storage, "open");
      if (tasks.length === 0) {
        await tgCtx.reply("No open to-dos. Save one from a digest or message when you want me to keep it alive.");
        return;
      }
      const lines = tasks.map((t) => {
        const priority = t.priority === "high" ? "\uD83D\uDD34" : t.priority === "medium" ? "\uD83D\uDFE1" : "\uD83D\uDFE2";
        const due = t.due_date ? ` (due: ${t.due_date})` : "";
        return `${priority} ${escapeHTML(t.title)}${due}`;
      });
      await tgCtx.reply(`<b>Open Saved Moves</b>\n\n${lines.join("\n")}`, { parse_mode: "HTML" });
    } catch (err) {
      ctx.logger.error("Failed to list tasks", { error: err instanceof Error ? err.message : String(err) });
      await tgCtx.reply("Failed to load saved moves.");
    }
  });

  // /library — Show top memories
  const libraryHandler = async (tgCtx: CommandContext<Context>) => {
    try {
      const beliefs = listBeliefs(ctx.storage, "active");
      if (beliefs.length === 0) {
        await tgCtx.reply("No memories stored yet. Chat with me and I'll learn!");
        return;
      }
      const top = beliefs.slice(0, 10);
      const lines = top.map((b, i) => `${i + 1}. ${escapeHTML(b.statement)}`);
      await tgCtx.reply(`<b>Recent Memories</b>\n\n${lines.join("\n")}`, { parse_mode: "HTML" });
    } catch (err) {
      ctx.logger.error("Failed to list memories", { error: err instanceof Error ? err.message : String(err) });
      await tgCtx.reply("Failed to load memories.");
    }
  };
  bot.command("library", libraryHandler);
  bot.command("memories", libraryHandler); // legacy alias

  // /schedules — Show active scheduled jobs
  bot.command("schedules", async (tgCtx) => {
    try {
      const schedules = ctx.storage.query<{
        id: string; label: string; type: "research" | "analysis"; interval_hours: number;
        next_run_at: string; last_run_at: string | null;
      }>(
        "SELECT id, label, type, interval_hours, next_run_at, last_run_at FROM scheduled_jobs WHERE status = 'active' ORDER BY created_at DESC",
      );
      if (schedules.length === 0) {
        await tgCtx.reply("No active schedules. Ask me to schedule recurring research!");
        return;
      }
      const lines = schedules.map((s) => {
        const interval = s.interval_hours >= 24 ? `${Math.round(s.interval_hours / 24)}d` : `${s.interval_hours}h`;
        const next = formatDateTime(ctx.config.timezone, parseTimestamp(s.next_run_at)).full;
        const mode = s.type === "analysis" ? "analysis" : "research";
        return `\u{1F504} <b>${escapeHTML(s.label)}</b> (${mode} · every ${interval})\n   Next: ${next}\n   ID: <code>${s.id}</code>`;
      });
      await tgCtx.reply(`<b>Active Schedules</b>\n\n${lines.join("\n\n")}`, { parse_mode: "HTML" });
    } catch {
      await tgCtx.reply("No schedules found. Ask me to schedule recurring research!");
    }
  });

  // /activities — Show recent research & swarm activities
  const activitiesHandler = async (tgCtx: CommandContext<Context>) => {
    try {
      const researchJobs = listResearchJobs(ctx.storage).map((j) => ({ ...j, source: "research" as const }));
      const swarmJobs = listSwarmJobs(ctx.storage).map((j) => ({ ...j, source: "swarm" as const }));
      const allJobs = [...researchJobs, ...swarmJobs]
        .sort((a, b) => parseTimestamp(b.createdAt).getTime() - parseTimestamp(a.createdAt).getTime())
        .slice(0, 10);

      if (allJobs.length === 0) {
        await tgCtx.reply("No recent activities. Ask me to research something!");
        return;
      }

      const statusEmoji: Record<string, string> = {
        done: "\u2705", running: "\uD83D\uDD04", failed: "\u274C", pending: "\u23F3",
        planning: "\uD83D\uDCDD", synthesizing: "\uD83E\uDDE9",
      };
      const lines = allJobs.map((j) => {
        const icon = j.source === "swarm" ? "\uD83D\uDC1D" : "\uD83D\uDD2C";
        const status = statusEmoji[j.status] ?? "\u2753";
        const ago = formatRelativeTime(j.createdAt);
        return `${icon} "${escapeHTML(j.goal.slice(0, 50))}" — ${status} ${j.status} (${ago})`;
      });
      await tgCtx.reply(`<b>Recent Activities</b>\n\n${lines.join("\n")}`, { parse_mode: "HTML" });
    } catch (err) {
      ctx.logger.error("Failed to list activities", { error: err instanceof Error ? err.message : String(err) });
      await tgCtx.reply("Failed to load activities.");
    }
  };
  bot.command("activities", activitiesHandler);
  bot.command("jobs", activitiesHandler); // legacy alias

  // /research <query> — Start a research job directly
  bot.command("research", async (tgCtx) => {
    const goal = tgCtx.match?.trim();
    if (!goal) {
      await tgCtx.reply("Usage: /research <query>\n\nExample: /research latest Bitcoin price analysis");
      return;
    }

    try {
      const threadId = getOrCreateThread(ctx, tgCtx.chat.id, tgCtx.from?.username);
      const jobId = ctx.backgroundJobs?.enqueueResearch
        ? await ctx.backgroundJobs.enqueueResearch({
          goal,
          threadId,
          resultType: "general",
          sourceKind: "manual",
        })
        : createResearchJob(ctx.storage, {
          goal,
          threadId,
          resultType: "general",
        });

      const researchCtx: ResearchContext = {
        storage: ctx.storage,
        llm: ctx.llm,
        logger: ctx.logger,
        timezone: ctx.config.timezone,
        provider: ctx.config.llm.provider,
        model: ctx.config.llm.model,
        contextWindow: ctx.config.llm.contextWindow,
        sandboxUrl: ctx.config.sandboxUrl,
        browserUrl: ctx.config.browserUrl,
        dataDir: ctx.config.dataDir,
        webSearch: (query: string, maxResults?: number) => webSearch(query, maxResults, "general", ctx.config.searchUrl),
        formatSearchResults,
        fetchPage: fetchPageAsMarkdown,
      };

      if (!ctx.backgroundJobs?.enqueueResearch) {
        runResearchInBackground(researchCtx, jobId).catch((err) => {
          ctx.logger.error(`Research background execution failed: ${err instanceof Error ? err.message : String(err)}`);
        });
      }

      await tgCtx.reply(`\uD83D\uDD2C Research queued: "${goal.slice(0, 80)}"...\n\nI'll send results when done.`);
    } catch (err) {
      ctx.logger.error("Failed to start research", { error: err instanceof Error ? err.message : String(err) });
      await tgCtx.reply("Failed to start research. Please try again.");
    }
  });

  // Shared chat handler for private messages, groups, and channels
  async function handleChat(chatId: number, text: string, sender: { username?: string; displayName?: string } | undefined, reply: typeof bot.api.sendMessage, chatType?: "private" | "group" | "supergroup" | "channel") {
    ctx.logger.debug("Telegram handleChat", { chatId });
    const threadId = getOrCreateThread(ctx, chatId, sender?.username);

    await bot.api.sendChatAction(chatId, "typing");
    const placeholder = await reply(chatId, "Thinking...");

    try {
      const result = await runAgentChat({
        ctx,
        agentPlugin,
        threadId,
        message: text,
        sender,
        chatType,
        chatId,
        subAgents,
        onPreflight: (action) => {
          bot.api.editMessageText(chatId, placeholder.message_id, action)
            .catch(() => { /* ignore edit failures */ });
        },
        onToolCall: (toolName) => {
          bot.api.editMessageText(chatId, placeholder.message_id, toolStatus(toolName))
            .catch(() => { /* ignore edit failures */ });
        },
      });

      if (!result.text) {
        await bot.api.editMessageText(chatId, placeholder.message_id, "I processed your request but have no text response.");
        return;
      }

      const formattedText = formatTelegramResponse(result.text);
      const complex = isComplexContent(formattedText);
      const reportArtifacts = result.artifacts?.filter((artifact) => artifact.name.endsWith(".md")) ?? [];
      const inlineMarkdown = complex ? buildTelegramDigestMarkdown(formattedText) : formattedText;
      const html = markdownToTelegramHTML(inlineMarkdown);
      const parts = splitMessage(html);

      // Helper: send a single part with HTML, falling back to clean plain text
      const sendPart = async (part: string, editMessageId?: number): Promise<boolean> => {
        try {
          if (editMessageId) {
            await bot.api.editMessageText(chatId, editMessageId, part, { parse_mode: "HTML" });
          } else {
            await bot.api.sendMessage(chatId, part, { parse_mode: "HTML" });
          }
          return true;
        } catch {
          // HTML rejected — send as clean plain text (strip tags properly)
          const plain = stripHtmlTags(part);
          if (editMessageId) {
            await bot.api.editMessageText(chatId, editMessageId, plain);
          } else {
            await bot.api.sendMessage(chatId, plain);
          }
          return false;
        }
      };

      await sendPart(parts[0]!, placeholder.message_id);
      for (let i = 1; i < parts.length; i++) {
        await sendPart(parts[i]!);
      }

      // Auto-attach a PDF when the response is complex and there is no dedicated report artifact already.
      if (complex && reportArtifacts.length === 0) {
        const titleMatch = formattedText.match(/^#+\s+(.+)$/m);
        const docTitle = titleMatch?.[1]?.slice(0, 80) ?? "Response";
        try {
          await sendReportDocumentToTelegram(ctx.storage, bot, chatId, {
            title: docTitle,
            markdown: formattedText,
            fileName: `${docTitle}.pdf`,
          }, ctx.logger);
        } catch (err) {
          ctx.logger.warn("Failed to send Telegram PDF attachment", { error: err instanceof Error ? err.message : String(err) });
        }
      }

      // Send artifacts — convert markdown reports to private PDF documents.
      if (result.artifacts?.length) {
        const reports = reportArtifacts;
        const others = result.artifacts.filter(a => !a.name.endsWith(".md"));

        for (const art of reports) {
          try {
            const artifact = getArtifact(ctx.storage, art.id);
            if (!artifact) continue;
            const mdContent = artifact.data.toString("utf-8");
            const titleMatch = mdContent.match(/^#\s+(.+)$/m);
            const reportTitle = titleMatch?.[1] ?? art.name.replace(/\.md$/, "");
            await sendReportDocumentToTelegram(ctx.storage, bot, chatId, {
              title: reportTitle,
              markdown: mdContent,
              fileName: art.name,
              visuals: others.map((item, index) => ({
                artifactId: item.id,
                title: item.name,
                order: index,
              })),
            }, ctx.logger);
          } catch (err) {
            ctx.logger.warn("Failed to send report artifact", { artifactId: art.id, error: err instanceof Error ? err.message : String(err) });
          }
        }

        await sendArtifactsToTelegram(ctx.storage, bot, chatId, others, ctx.logger, { protectContent: true });
      }
    } catch (err) {
      ctx.logger.error("Telegram chat failed", { error: err instanceof Error ? err.message : String(err) });
      await bot.api.editMessageText(
        chatId, placeholder.message_id,
        "Sorry, something went wrong. Please try again.",
      ).catch(() => { /* ignore */ });
    }
  }

  // Private messages — always respond
  bot.on("message:text", async (tgCtx) => {
    ctx.logger.debug("Telegram message received", { chatType: tgCtx.chat.type });
    const chatType = tgCtx.chat.type;

    // In groups/supergroups, only respond when mentioned or replied to
    if (chatType === "group" || chatType === "supergroup") {
      const botUsername = tgCtx.me.username;
      const isMentioned = tgCtx.message.text.includes(`@${botUsername}`);
      const isReply = tgCtx.message.reply_to_message?.from?.id === tgCtx.me.id;
      const senderName = tgCtx.from
        ? [tgCtx.from.first_name, tgCtx.from.last_name].filter(Boolean).join(" ") || tgCtx.from.username || "Unknown"
        : "Unknown";

      if (!isMentioned && !isReply) {
        // Always buffer (free)
        bufferMessage(tgCtx.chat.id, tgCtx.message.text, senderName);
        // Passive processing (fire-and-forget, don't block)
        passiveProcess(ctx, agentPlugin, tgCtx.chat.id, tgCtx.message, bot.api)
          .catch((err) => ctx.logger.debug("Passive processing failed", { error: String(err) }));
        return;
      }

      // Acknowledge mention/reply with eyes reaction
      tgCtx.api.setMessageReaction(tgCtx.chat.id, tgCtx.message.message_id, [
        { type: "emoji", emoji: "\uD83D\uDC40" },
      ]).catch(() => {});

      // Strip the @mention from the message
      const text = tgCtx.message.text.replace(`@${botUsername}`, "").trim();
      if (!text) return;
      const sender = tgCtx.from ? {
        username: tgCtx.from.username,
        displayName: [tgCtx.from.first_name, tgCtx.from.last_name].filter(Boolean).join(" ") || undefined,
      } : undefined;
      await handleChat(tgCtx.chat.id, text, sender, bot.api.sendMessage.bind(bot.api), chatType);
      return;
    }

    // Private chat
    const sender = tgCtx.from ? {
      username: tgCtx.from.username,
      displayName: [tgCtx.from.first_name, tgCtx.from.last_name].filter(Boolean).join(" ") || undefined,
    } : undefined;
    await handleChat(tgCtx.chat.id, tgCtx.message.text, sender, bot.api.sendMessage.bind(bot.api), "private");
  });

  // Channel posts — respond to all text posts (bot must be channel admin)
  bot.on("channel_post:text", async (tgCtx) => {
    await handleChat(tgCtx.chat.id, tgCtx.channelPost.text, undefined, bot.api.sendMessage.bind(bot.api));
  });

  return bot;
}

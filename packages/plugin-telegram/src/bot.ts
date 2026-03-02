import { Bot } from "grammy";
import type { AgentPlugin, PluginContext } from "@personal-ai/core";
import { listBeliefs, getThread, formatDateTime } from "@personal-ai/core";
import { listTasks } from "@personal-ai/plugin-tasks";
import { listResearchJobs, createResearchJob, runResearchInBackground } from "@personal-ai/plugin-research";
import type { ResearchContext } from "@personal-ai/plugin-research";
import { listSwarmJobs } from "@personal-ai/plugin-swarm";
import { webSearch, formatSearchResults } from "@personal-ai/plugin-assistant/web-search";
import { fetchPageAsMarkdown } from "@personal-ai/plugin-assistant/page-fetch";
import { runAgentChat, createThread, clearThread as clearThreadMessages } from "./chat.js";
import { markdownToTelegramHTML, splitMessage } from "./formatter.js";
import { bufferMessage, passiveProcess } from "./passive.js";

/** Tool name → human-friendly status emoji */
const TOOL_STATUS: Record<string, string> = {
  web_search: "\uD83D\uDD0D Searching the web...",
  memory_recall: "\uD83E\uDDE0 Recalling memories...",
  memory_remember: "\uD83D\uDCDD Storing in memory...",
  memory_beliefs: "\uD83D\uDCDA Listing beliefs...",
  task_list: "\uD83D\uDCCB Checking tasks...",
  task_add: "\u2795 Adding task...",
  task_done: "\u2705 Completing task...",
};

function toolStatus(toolName: string): string {
  return TOOL_STATUS[toolName] ?? `\u2699\uFE0F Using ${toolName}...`;
}

function formatRelativeTime(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
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

export function createBot(token: string, ctx: PluginContext, agentPlugin: AgentPlugin, subAgents?: AgentPlugin[]): Bot {
  const bot = new Bot(token);

  // Register commands with Telegram so they show in the / menu
  bot.api.setMyCommands([
    { command: "start", description: "Welcome message" },
    { command: "help", description: "List available commands" },
    { command: "clear", description: "Clear conversation history" },
    { command: "tasks", description: "Show open tasks" },
    { command: "memories", description: "Show recent memories" },
    { command: "schedules", description: "Show active schedules" },
    { command: "jobs", description: "Show recent research & swarm jobs" },
    { command: "research", description: "Start a research job" },
  ]).catch((err) => {
    ctx.logger.warn(`Failed to register bot commands: ${err instanceof Error ? err.message : String(err)}`);
  });

  // /start — Welcome
  bot.command("start", async (tgCtx) => {
    await tgCtx.reply(
      "<b>Welcome to Personal AI!</b>\n\n" +
      "I'm your personal assistant with persistent memory, web search, and task management.\n\n" +
      "Just send me a message and I'll respond. I remember our conversations across sessions.\n\n" +
      "<b>Commands:</b>\n" +
      "/help — Show available commands\n" +
      "/clear — Start a fresh conversation\n" +
      "/tasks — Show your open tasks\n" +
      "/memories — Show recent memories\n" +
      "/schedules — Show active schedules\n" +
      "/jobs — Show recent research &amp; swarm jobs\n" +
      "/research &lt;query&gt; — Start a research job",
      { parse_mode: "HTML" },
    );
  });

  // /help
  bot.command("help", async (tgCtx) => {
    await tgCtx.reply(
      "<b>Available Commands</b>\n\n" +
      "/start — Welcome message\n" +
      "/help — This help message\n" +
      "/clear — Clear conversation history and start fresh\n" +
      "/tasks — List your open tasks\n" +
      "/memories — Show your top 10 memories\n" +
      "/schedules — Show active recurring research schedules\n" +
      "/jobs — Show recent research &amp; swarm jobs\n" +
      "/research &lt;query&gt; — Start a research job\n\n" +
      "Or just send any message to chat!",
      { parse_mode: "HTML" },
    );
  });

  // /clear — Reset conversation
  bot.command("clear", async (tgCtx) => {
    const chatId = tgCtx.chat.id;
    clearThread(ctx, chatId);
    await tgCtx.reply("Conversation cleared. Send a message to start fresh!");
  });

  // /tasks — Show open tasks
  bot.command("tasks", async (tgCtx) => {
    try {
      const tasks = listTasks(ctx.storage, "open");
      if (tasks.length === 0) {
        await tgCtx.reply("No open tasks. Ask me to add one!");
        return;
      }
      const lines = tasks.map((t) => {
        const priority = t.priority === "high" ? "\uD83D\uDD34" : t.priority === "medium" ? "\uD83D\uDFE1" : "\uD83D\uDFE2";
        const due = t.due_date ? ` (due: ${t.due_date})` : "";
        return `${priority} ${t.title}${due}`;
      });
      await tgCtx.reply(`<b>Open Tasks</b>\n\n${lines.join("\n")}`, { parse_mode: "HTML" });
    } catch (err) {
      ctx.logger.error("Failed to list tasks", { error: err instanceof Error ? err.message : String(err) });
      await tgCtx.reply("Failed to load tasks.");
    }
  });

  // /memories — Show top beliefs
  bot.command("memories", async (tgCtx) => {
    try {
      const beliefs = listBeliefs(ctx.storage, "active");
      if (beliefs.length === 0) {
        await tgCtx.reply("No memories stored yet. Chat with me and I'll learn!");
        return;
      }
      const top = beliefs.slice(0, 10);
      const lines = top.map((b, i) => `${i + 1}. ${b.statement}`);
      await tgCtx.reply(`<b>Recent Memories</b>\n\n${lines.join("\n")}`, { parse_mode: "HTML" });
    } catch (err) {
      ctx.logger.error("Failed to list beliefs", { error: err instanceof Error ? err.message : String(err) });
      await tgCtx.reply("Failed to load memories.");
    }
  });

  // /schedules — Show active scheduled jobs
  bot.command("schedules", async (tgCtx) => {
    try {
      const schedules = ctx.storage.query<{
        id: string; label: string; interval_hours: number;
        next_run_at: string; last_run_at: string | null;
      }>(
        "SELECT id, label, interval_hours, next_run_at, last_run_at FROM scheduled_jobs WHERE status = 'active' ORDER BY created_at DESC",
      );
      if (schedules.length === 0) {
        await tgCtx.reply("No active schedules. Ask me to schedule recurring research!");
        return;
      }
      const lines = schedules.map((s) => {
        const interval = s.interval_hours >= 24 ? `${Math.round(s.interval_hours / 24)}d` : `${s.interval_hours}h`;
        const next = formatDateTime(ctx.config.timezone, new Date(s.next_run_at)).full;
        return `\u{1F504} <b>${s.label}</b> (every ${interval})\n   Next: ${next}\n   ID: <code>${s.id}</code>`;
      });
      await tgCtx.reply(`<b>Active Schedules</b>\n\n${lines.join("\n\n")}`, { parse_mode: "HTML" });
    } catch {
      await tgCtx.reply("No schedules found. Ask me to schedule recurring research!");
    }
  });

  // /jobs — Show recent research & swarm jobs
  bot.command("jobs", async (tgCtx) => {
    try {
      const researchJobs = listResearchJobs(ctx.storage).map((j) => ({ ...j, source: "research" as const }));
      const swarmJobs = listSwarmJobs(ctx.storage).map((j) => ({ ...j, source: "swarm" as const }));
      const allJobs = [...researchJobs, ...swarmJobs]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 10);

      if (allJobs.length === 0) {
        await tgCtx.reply("No recent jobs. Ask me to research something!");
        return;
      }

      const statusEmoji: Record<string, string> = {
        done: "\u2705", running: "\uD83D\uDD04", failed: "\u274C", pending: "\u23F3",
      };
      const lines = allJobs.map((j) => {
        const icon = j.source === "swarm" ? "\uD83D\uDC1D" : "\uD83D\uDD2C";
        const status = statusEmoji[j.status] ?? "\u2753";
        const ago = formatRelativeTime(j.createdAt);
        return `${icon} "${j.goal.slice(0, 50)}" — ${status} ${j.status} (${ago})`;
      });
      await tgCtx.reply(`<b>Recent Jobs</b>\n\n${lines.join("\n")}`, { parse_mode: "HTML" });
    } catch (err) {
      ctx.logger.error("Failed to list jobs", { error: err instanceof Error ? err.message : String(err) });
      await tgCtx.reply("Failed to load jobs.");
    }
  });

  // /research <query> — Start a research job directly
  bot.command("research", async (tgCtx) => {
    const goal = tgCtx.match?.trim();
    if (!goal) {
      await tgCtx.reply("Usage: /research <query>\n\nExample: /research latest Bitcoin price analysis");
      return;
    }

    try {
      const threadId = getOrCreateThread(ctx, tgCtx.chat.id, tgCtx.from?.username);
      const jobId = createResearchJob(ctx.storage, {
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
        webSearch,
        formatSearchResults,
        fetchPage: fetchPageAsMarkdown,
      };

      runResearchInBackground(researchCtx, jobId).catch((err) => {
        ctx.logger.error(`Research background execution failed: ${err instanceof Error ? err.message : String(err)}`);
      });

      await tgCtx.reply(`\uD83D\uDD2C Starting research: "${goal.slice(0, 80)}"...\n\nI'll send results when done.`);
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

      const html = markdownToTelegramHTML(result.text);
      const parts = splitMessage(html);

      try {
        await bot.api.editMessageText(chatId, placeholder.message_id, parts[0]!, { parse_mode: "HTML" });
      } catch {
        const plainParts = splitMessage(result.text);
        await bot.api.editMessageText(chatId, placeholder.message_id, plainParts[0]!);
        for (let i = 1; i < plainParts.length; i++) {
          await bot.api.sendMessage(chatId, plainParts[i]!);
        }
        return;
      }

      for (let i = 1; i < parts.length; i++) {
        try {
          await bot.api.sendMessage(chatId, parts[i]!, { parse_mode: "HTML" });
        } catch {
          await bot.api.sendMessage(chatId, splitMessage(result.text)[i] ?? parts[i]!);
        }
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

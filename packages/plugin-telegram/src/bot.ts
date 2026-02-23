import { Bot } from "grammy";
import type { AgentPlugin, PluginContext } from "@personal-ai/core";
import { listBeliefs, getThread } from "@personal-ai/core";
import { listTasks } from "@personal-ai/plugin-tasks";
import { runAgentChat, createThread, clearThread as clearThreadMessages } from "./chat.js";
import { markdownToTelegramHTML, splitMessage } from "./formatter.js";

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

export function createBot(token: string, ctx: PluginContext, agentPlugin: AgentPlugin): Bot {
  const bot = new Bot(token);

  // Register commands with Telegram so they show in the / menu
  bot.api.setMyCommands([
    { command: "start", description: "Welcome message" },
    { command: "help", description: "List available commands" },
    { command: "clear", description: "Clear conversation history" },
    { command: "tasks", description: "Show open tasks" },
    { command: "memories", description: "Show recent memories" },
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
      "/memories — Show recent memories",
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
      "/memories — Show your top 10 memories\n\n" +
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

  // Shared chat handler for private messages, groups, and channels
  async function handleChat(chatId: number, text: string, sender: { username?: string; displayName?: string } | undefined, reply: typeof bot.api.sendMessage) {
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
      if (!isMentioned && !isReply) return;

      // Strip the @mention from the message
      const text = tgCtx.message.text.replace(`@${botUsername}`, "").trim();
      if (!text) return;
      const sender = tgCtx.from ? {
        username: tgCtx.from.username,
        displayName: [tgCtx.from.first_name, tgCtx.from.last_name].filter(Boolean).join(" ") || undefined,
      } : undefined;
      await handleChat(tgCtx.chat.id, text, sender, bot.api.sendMessage.bind(bot.api));
      return;
    }

    // Private chat
    const sender = tgCtx.from ? {
      username: tgCtx.from.username,
      displayName: [tgCtx.from.first_name, tgCtx.from.last_name].filter(Boolean).join(" ") || undefined,
    } : undefined;
    await handleChat(tgCtx.chat.id, tgCtx.message.text, sender, bot.api.sendMessage.bind(bot.api));
  });

  // Channel posts — respond to all text posts (bot must be channel admin)
  bot.on("channel_post:text", async (tgCtx) => {
    await handleChat(tgCtx.chat.id, tgCtx.channelPost.text, undefined, bot.api.sendMessage.bind(bot.api));
  });

  return bot;
}

import type { Bot } from "grammy";
import type { Storage, Logger } from "@personal-ai/core";
import { markdownToTelegramHTML, splitMessage, escapeHTML } from "./formatter.js";

function findChatIdForBriefing(storage: Storage, briefingId: string): number | null {
  let jobId: string | null = null;
  let table: string | null = null;

  if (briefingId.startsWith("research-")) {
    jobId = briefingId.slice("research-".length);
    table = "research_jobs";
  } else if (briefingId.startsWith("swarm-")) {
    jobId = briefingId.slice("swarm-".length);
    table = "swarm_jobs";
  }
  if (!jobId || !table) return null;

  try {
    const jobRow = storage.query<{ thread_id: string | null }>(
      `SELECT thread_id FROM ${table} WHERE id = ?`,
      [jobId],
    );
    const threadId = jobRow[0]?.thread_id;
    if (!threadId) return null;
    const chatRow = storage.query<{ chat_id: number }>(
      "SELECT chat_id FROM telegram_threads WHERE thread_id = ?",
      [threadId],
    );
    return chatRow[0]?.chat_id ?? null;
  } catch {
    return null;
  }
}

async function sendToTelegramChat(bot: Bot, chatId: number, html: string, logger: Logger): Promise<void> {
  const parts = splitMessage(html);
  try {
    for (const part of parts) {
      await bot.api.sendMessage(chatId, part, { parse_mode: "HTML" });
    }
  } catch (err) {
    logger.warn("Failed to send Telegram message", {
      chatId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function checkAndPushResearch(storage: Storage, bot: Bot, logger: Logger): Promise<void> {
  try {
    const rows = storage.query<{ id: string; sections: string }>(
      "SELECT id, sections FROM briefings WHERE type = 'research' AND status = 'ready' AND telegram_sent_at IS NULL ORDER BY generated_at DESC LIMIT 5",
    );
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.sections) as { goal?: string; report?: string };
        if (!parsed.report) continue;
        const title = parsed.goal ?? "Report";
        const isSwarm = row.id.startsWith("swarm-");
        const emoji = isSwarm ? "\uD83D\uDC1D" : "\uD83D\uDD2C";
        const label = isSwarm ? "Swarm Report" : "Research Complete";
        const html = `${emoji} <b>${label}: ${escapeHTML(title)}</b>\n\n${markdownToTelegramHTML(parsed.report)}`;
        // Send to the originating Telegram chat, not all chats
        const chatId = findChatIdForBriefing(storage, row.id);
        if (chatId) {
          await sendToTelegramChat(bot, chatId, html, logger);
          storage.run("UPDATE briefings SET telegram_sent_at = datetime('now') WHERE id = ?", [row.id]);
          logger.info("Research report pushed to Telegram", { briefingId: row.id, chatId });
        } else {
          // Mark as sent even without a chat, to avoid re-checking
          storage.run("UPDATE briefings SET telegram_sent_at = datetime('now') WHERE id = ?", [row.id]);
          logger.info("Research report ready (no originating Telegram chat)", { briefingId: row.id });
        }
      } catch { /* skip malformed entries */ }
    }
  } catch { /* ignore query errors during startup */ }
}

const DEFAULT_PUSH_INTERVAL_MS = 60 * 1000;

/**
 * Start a polling loop that checks for completed research reports
 * and pushes them to the originating Telegram chat.
 */
export function startResearchPushLoop(
  storage: Storage,
  bot: Bot,
  logger: Logger,
  intervalMs?: number,
): { stop(): void } {
  const ms = intervalMs ?? DEFAULT_PUSH_INTERVAL_MS;
  const timer = setInterval(() => {
    checkAndPushResearch(storage, bot, logger).catch(() => {});
  }, ms);
  return {
    stop() { clearInterval(timer); },
  };
}

import { InlineKeyboard } from "grammy";
import type { Bot } from "grammy";
import type { Storage, Logger } from "@personal-ai/core";
import { buildReportPresentation, deriveReportVisuals, extractPresentationBlocks, getArtifact, listArtifacts } from "@personal-ai/core";
import { markdownToTelegramHTML, splitMessage, escapeHTML, formatTelegramResponse } from "./formatter.js";
import { getOrCreateAccount, uploadImage, createPage } from "./telegraph.js";
import { sendVisualsToTelegram } from "./delivery.js";

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

/** Create a short preview (first ~500 chars) */
function makePreview(report: string, maxLen = 500): string {
  if (report.length <= maxLen) return report;
  const cutIdx = report.lastIndexOf("\n", maxLen);
  const sliced = cutIdx > maxLen * 0.3 ? report.slice(0, cutIdx) : report.slice(0, maxLen);
  return sliced.trimEnd();
}

async function checkAndPushResearch(storage: Storage, bot: Bot, logger: Logger): Promise<void> {
  try {
    const rows = storage.query<{ id: string; sections: string }>(
      "SELECT id, sections FROM briefings WHERE type = 'research' AND status = 'ready' AND telegram_sent_at IS NULL ORDER BY generated_at DESC LIMIT 5",
    );
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.sections) as Record<string, unknown>;
        const jobId = row.id.startsWith("research-") ? row.id.slice("research-".length)
          : row.id.startsWith("swarm-") ? row.id.slice("swarm-".length)
          : null;
        const extracted = extractPresentationBlocks(typeof parsed.report === "string" ? parsed.report : "");
        const presentation = buildReportPresentation({
          report: extracted.report,
          structuredResult: typeof parsed.structuredResult === "string" ? parsed.structuredResult : extracted.structuredResult,
          renderSpec: typeof parsed.renderSpec === "string" ? parsed.renderSpec : extracted.renderSpec,
          visuals: Array.isArray(parsed.visuals)
            ? parsed.visuals as Parameters<typeof buildReportPresentation>[0]["visuals"]
            : (jobId ? deriveReportVisuals(storage, jobId) : []),
          resultType: typeof parsed.resultType === "string" ? parsed.resultType : "general",
          execution: parsed.execution === "analysis" || row.id.startsWith("swarm-") ? "analysis" : "research",
        });
        if (!presentation.report) continue;

        const title = typeof parsed.goal === "string" ? parsed.goal : "Report";
        const isAnalysis = presentation.execution === "analysis";
        const emoji = isAnalysis ? "\uD83D\uDC1D" : "\uD83D\uDD2C";
        const label = isAnalysis ? "Analysis Complete" : "Research Complete";
        const formattedReport = formatTelegramResponse(presentation.report);
        // Send to the originating Telegram chat, not all chats
        const chatId = findChatIdForBriefing(storage, row.id);
        if (chatId) {
          const preview = makePreview(formattedReport);
          const previewHtml = `${emoji} <b>${label}: ${escapeHTML(title)}</b>\n\n${markdownToTelegramHTML(preview)}`;
          await sendToTelegramChat(bot, chatId, previewHtml, logger);
          await sendVisualsToTelegram(storage, bot, chatId, presentation.visuals, logger);

          // Collect image artifacts for embedding in Telegraph
          const telegraphImages: Array<{ name: string; url: string }> = [];
          if (jobId) {
            try {
              const visualArtifacts = presentation.visuals.length > 0
                ? presentation.visuals.map((visual) => ({ artifactId: visual.artifactId, title: visual.title }))
                : listArtifacts(storage, jobId)
                  .filter((artifact) => artifact.mimeType.startsWith("image/"))
                  .map((artifact) => ({ artifactId: artifact.id, title: artifact.name }));

              for (const visual of visualArtifacts) {
                const artifact = getArtifact(storage, visual.artifactId);
                if (artifact) {
                  const imgUrl = await uploadImage(artifact.data, artifact.name, logger);
                  if (imgUrl) {
                    telegraphImages.push({ name: visual.title, url: imgUrl });
                  }
                }
              }
            } catch (err) {
              logger.warn("Failed to upload artifacts to Telegraph", { jobId, error: err instanceof Error ? err.message : String(err) });
            }
          }

          // Try to publish as Telegraph article (Instant View)
          let telegraphUrl: string | null = null;
          try {
            const account = await getOrCreateAccount(storage, logger);
            if (account) {
              const page = await createPage(account, title, presentation.report, telegraphImages, logger);
              if (page) {
                telegraphUrl = page.url;
              }
            }
          } catch (err) {
            logger.warn("Telegraph publish failed, falling back to text", { error: err instanceof Error ? err.message : String(err) });
          }

          if (telegraphUrl) {
            const keyboard = new InlineKeyboard().url("Read Full Report", telegraphUrl);
            try {
              await bot.api.sendMessage(chatId, "\uD83D\uDCC4 Full report", {
                parse_mode: "HTML",
                reply_markup: keyboard,
              });
            } catch {
              await bot.api.sendMessage(chatId, telegraphUrl);
            }
            logger.info("Research report published to Telegraph", { briefingId: row.id, url: telegraphUrl });
          }

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

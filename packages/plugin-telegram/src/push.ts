import { InputFile } from "grammy";
import type { Bot } from "grammy";
import type { Storage, Logger } from "@personal-ai/core";
import { getArtifact, listArtifacts } from "@personal-ai/core";
import { markdownToTelegramHTML, markdownToReportHTML, splitMessage, escapeHTML, formatTelegramResponse } from "./formatter.js";

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

/** Create a short preview (first ~500 chars) with a "see full report" note */
function makePreview(report: string, maxLen = 500): string {
  if (report.length <= maxLen) return report;
  // Cut at last newline within budget
  const cutIdx = report.lastIndexOf("\n", maxLen);
  const sliced = cutIdx > maxLen * 0.3 ? report.slice(0, cutIdx) : report.slice(0, maxLen);
  return sliced.trimEnd() + "\n\n<i>Full report attached as document above.</i>";
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
        const formattedReport = formatTelegramResponse(parsed.report);
        // Send to the originating Telegram chat, not all chats
        const chatId = findChatIdForBriefing(storage, row.id);
        if (chatId) {
          // 1. Send full report as downloadable HTML file
          const fileTitle = title.replace(/[^a-zA-Z0-9 _-]/g, "").replace(/\s+/g, "_").slice(0, 60) || "report";
          const htmlBody = markdownToReportHTML(formattedReport);
          const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHTML(title)}</title>
  <style>
    :root { color-scheme: light dark; }
    body { font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; max-width: 920px; margin: 2rem auto; padding: 0 1rem; line-height: 1.65; }
    article { background: color-mix(in srgb, canvas 96%, #3b82f6 4%); border: 1px solid color-mix(in srgb, canvastext 12%, transparent); border-radius: 12px; padding: 1.25rem; }
    h1, h2, h3, h4 { line-height: 1.25; margin-top: 1.4em; margin-bottom: 0.5em; }
    h1 { margin-top: 0.2rem; }
    p { margin: 0.7em 0; }
    ul, ol { padding-left: 1.35rem; margin: 0.6em 0; }
    li { margin: 0.35em 0; }
    pre { background: color-mix(in srgb, canvas 92%, #111827 8%); padding: 0.95rem; overflow-x: auto; border-radius: 8px; border: 1px solid color-mix(in srgb, canvastext 14%, transparent); }
    code { background: color-mix(in srgb, canvas 92%, #111827 8%); padding: 0.1em 0.35em; border-radius: 6px; }
    blockquote { border-left: 3px solid #60a5fa; margin: 1em 0; padding: 0.2em 0 0.2em 0.9em; color: color-mix(in srgb, canvastext 80%, transparent); }
    a { color: #2563eb; }
  </style>
</head>
<body>
  <article>
    <h1>${escapeHTML(title)}</h1>
    ${htmlBody}
  </article>
</body>
</html>`;
          const htmlBuffer = Buffer.from(htmlContent, "utf-8");
          try {
            await bot.api.sendDocument(chatId, new InputFile(htmlBuffer, `${fileTitle}.html`), {
              caption: `${emoji} ${label}: ${title}`,
            });
          } catch (err) {
            logger.warn("Failed to send report document", { error: err instanceof Error ? err.message : String(err) });
          }

          // 2. Send a short preview in chat
          const previewHtml = `${emoji} <b>${label}: ${escapeHTML(title)}</b>\n\n${markdownToTelegramHTML(makePreview(formattedReport))}`;
          await sendToTelegramChat(bot, chatId, previewHtml, logger);

          // 3. Send image artifacts (screenshots, charts) as downloadable documents
          const jobId = row.id.startsWith("research-") ? row.id.slice("research-".length)
            : row.id.startsWith("swarm-") ? row.id.slice("swarm-".length)
            : null;
          if (jobId) {
            try {
              const artifacts = listArtifacts(storage, jobId);
              for (const meta of artifacts) {
                if (meta.mimeType.startsWith("image/")) {
                  const artifact = getArtifact(storage, meta.id);
                  if (artifact) {
                    await bot.api.sendDocument(chatId, new InputFile(artifact.data, meta.name), {
                      caption: meta.name,
                    });
                  }
                }
              }
            } catch (err) {
              logger.warn("Failed to send artifact documents", { jobId, error: err instanceof Error ? err.message : String(err) });
            }
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

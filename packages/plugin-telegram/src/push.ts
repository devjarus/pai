import type { Bot } from "grammy";
import type { Storage, Logger, StandardBriefSection } from "@personal-ai/core";
import { buildReportPresentation, deriveReportVisuals, extractPresentationBlocks } from "@personal-ai/core";
import {
  markdownToTelegramHTML,
  splitMessage,
  escapeHTML,
  formatBriefingHTML,
  buildTelegramDigestMarkdown,
} from "./formatter.js";
import { sendVisualsToTelegram } from "./delivery.js";
import { sendReportDocumentToTelegram } from "./report-document.js";

interface BriefingPushRow {
  id: string;
  type: string;
  sections: string;
  thread_id: string | null;
  program_id: string | null;
}

interface PushLoopOptions {
  ownerUsername?: string;
}

function parseBriefSections(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function getProgramThreadInfo(storage: Storage, programId: string): { chatId: number | null; threadId: string | null } | null {
  try {
    const rows = storage.query<{ chat_id: number | null; thread_id: string | null }>(
      "SELECT chat_id, thread_id FROM scheduled_jobs WHERE id = ?",
      [programId],
    );
    const row = rows[0];
    if (!row) return null;
    return { chatId: row.chat_id, threadId: row.thread_id };
  } catch {
    return null;
  }
}

function getChatIdsForThread(storage: Storage, threadId: string): number[] {
  try {
    return storage.query<{ chat_id: number }>(
      "SELECT chat_id FROM telegram_threads WHERE thread_id = ?",
      [threadId],
    ).map((row) => row.chat_id);
  } catch {
    return [];
  }
}

function getOwnerChatIds(storage: Storage, ownerUsername?: string): number[] {
  if (!ownerUsername) return [];
  try {
    return storage.query<{ chat_id: number }>(
      "SELECT chat_id FROM telegram_threads WHERE username = ?",
      [ownerUsername],
    ).map((row) => row.chat_id);
  } catch {
    return [];
  }
}

function findChatIdsForBriefing(storage: Storage, row: BriefingPushRow, ownerUsername?: string): number[] {
  const chatIds = new Set<number>();

  if (row.thread_id) {
    for (const chatId of getChatIdsForThread(storage, row.thread_id)) {
      chatIds.add(chatId);
    }
  }

  if (chatIds.size === 0 && row.program_id) {
    const programThread = getProgramThreadInfo(storage, row.program_id);
    if (programThread?.chatId != null) {
      chatIds.add(programThread.chatId);
    }
    if (programThread?.threadId) {
      for (const chatId of getChatIdsForThread(storage, programThread.threadId)) {
        chatIds.add(chatId);
      }
    }
  }

  if (chatIds.size === 0 && row.type === "daily") {
    for (const chatId of getOwnerChatIds(storage, ownerUsername)) {
      chatIds.add(chatId);
    }
  }

  return [...chatIds];
}

async function sendToTelegramChat(bot: Bot, chatId: number, html: string, logger: Logger): Promise<void> {
  const parts = splitMessage(html);
  try {
    for (const part of parts) {
      await bot.api.sendMessage(chatId, part, { parse_mode: "HTML", protect_content: true });
    }
  } catch (err) {
    logger.warn("Failed to send Telegram message", {
      chatId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function normalizeBriefTitle(row: BriefingPushRow, sections: Record<string, unknown>): string {
  if (typeof sections.title === "string" && sections.title.trim().length > 0) {
    return sections.title.trim();
  }
  if (typeof sections.goal === "string" && sections.goal.trim().length > 0) {
    return sections.goal.trim();
  }
  if (row.type === "daily") return "Daily Brief";
  return "Brief";
}

function getReportMarkdown(sections: Record<string, unknown>): string | null {
  if (typeof sections.report === "string" && sections.report.trim().length > 0) {
    return sections.report;
  }
  const appendix = sections.appendix;
  if (appendix && typeof appendix === "object") {
    const appendixReport = (appendix as Record<string, unknown>).report;
    if (typeof appendixReport === "string" && appendixReport.trim().length > 0) {
      return appendixReport;
    }
  }
  return null;
}

function isStandardBriefSection(sections: Record<string, unknown>): sections is Record<string, unknown> & StandardBriefSection {
  const recommendation = sections.recommendation;
  return !!recommendation && typeof recommendation === "object" && typeof (recommendation as Record<string, unknown>).summary === "string";
}

function resolveBriefLabel(row: BriefingPushRow, execution?: string | null): string {
  if (row.type === "daily") return "Daily Brief";
  if (row.type === "swarm" || execution === "analysis") return "Analysis Complete";
  if (row.type === "research" || execution === "research") return "Research Complete";
  return row.program_id ? "Program Update" : "Brief Update";
}

function resolveBriefEmoji(row: BriefingPushRow, execution?: string | null): string {
  if (row.type === "daily") return "📌";
  if (row.type === "swarm" || execution === "analysis") return "🐝";
  if (row.type === "research" || execution === "research") return "🔬";
  return "📋";
}

function buildFallbackReportHtml(
  row: BriefingPushRow,
  title: string,
  reportMarkdown: string,
  execution?: string | null,
): string {
  const label = resolveBriefLabel(row, execution);
  const gist = markdownToTelegramHTML(buildTelegramDigestMarkdown(reportMarkdown));
  return `${resolveBriefEmoji(row, execution)} <b>${escapeHTML(label)}: ${escapeHTML(title)}</b>\n\n${gist}\n\n<i>Full report attached as PDF.</i>`;
}

function buildStandardBriefHtml(
  row: BriefingPushRow,
  title: string,
  sections: StandardBriefSection,
  footer?: string,
): string {
  return formatBriefingHTML({
    title,
    label: resolveBriefLabel(row, sections.execution),
    footer,
    sections,
  });
}

async function pushReportBrief(
  storage: Storage,
  bot: Bot,
  logger: Logger,
  row: BriefingPushRow,
  sections: Record<string, unknown>,
  chatIds: number[],
): Promise<void> {
  const reportMarkdown = getReportMarkdown(sections);
  if (!reportMarkdown) return;

  const extracted = extractPresentationBlocks(reportMarkdown);
  const presentation = buildReportPresentation({
    report: extracted.report,
    structuredResult: typeof sections.structuredResult === "string" ? sections.structuredResult : extracted.structuredResult,
    renderSpec: typeof sections.renderSpec === "string" ? sections.renderSpec : extracted.renderSpec,
    visuals: Array.isArray(sections.visuals)
      ? sections.visuals as Parameters<typeof buildReportPresentation>[0]["visuals"]
      : deriveReportVisuals(storage, row.id.replace(/^(research|swarm)-/, "")),
    resultType: typeof sections.resultType === "string" ? sections.resultType : "general",
    execution: sections.execution === "analysis" || row.type === "swarm" ? "analysis" : "research",
  });

  if (!presentation.report) return;

  const title = normalizeBriefTitle(row, sections);
  const gistHtml = isStandardBriefSection(sections)
    ? buildStandardBriefHtml(row, title, sections, "Full report attached as PDF.")
    : buildFallbackReportHtml(row, title, presentation.report, presentation.execution);

  for (const chatId of chatIds) {
    await sendToTelegramChat(bot, chatId, gistHtml, logger);
    await sendVisualsToTelegram(storage, bot, chatId, presentation.visuals, logger, { protectContent: true });
    await sendReportDocumentToTelegram(storage, bot, chatId, {
      title,
      markdown: presentation.report,
      fileName: `${title}.pdf`,
      renderSpec: presentation.renderSpec,
      visuals: presentation.visuals.map((visual) => ({
        artifactId: visual.artifactId,
        title: visual.title,
        caption: visual.caption,
        order: visual.order,
      })),
    }, logger);
  }
}

async function pushStandardBrief(
  bot: Bot,
  logger: Logger,
  row: BriefingPushRow,
  sections: StandardBriefSection,
  chatIds: number[],
): Promise<void> {
  const html = buildStandardBriefHtml(
    row,
    normalizeBriefTitle(row, sections as unknown as Record<string, unknown>),
    sections,
  );
  for (const chatId of chatIds) {
    await sendToTelegramChat(bot, chatId, html, logger);
  }
}

async function checkAndPushResearch(
  storage: Storage,
  bot: Bot,
  logger: Logger,
  options?: PushLoopOptions,
): Promise<void> {
  try {
    const rows = storage.query<BriefingPushRow>(
      "SELECT id, type, sections, thread_id, program_id FROM briefings WHERE status = 'ready' AND telegram_sent_at IS NULL ORDER BY generated_at DESC LIMIT 5",
    );
    for (const row of rows) {
      try {
        const sections = parseBriefSections(row.sections);
        if (!sections) continue;

        const chatIds = findChatIdsForBriefing(storage, row, options?.ownerUsername);
        if (chatIds.length > 0) {
          if (getReportMarkdown(sections)) {
            await pushReportBrief(storage, bot, logger, row, sections, chatIds);
          } else if (isStandardBriefSection(sections)) {
            await pushStandardBrief(bot, logger, row, sections, chatIds);
          }
        }

        storage.run("UPDATE briefings SET telegram_sent_at = datetime('now') WHERE id = ?", [row.id]);
        logger.info(chatIds.length > 0 ? "Brief pushed to Telegram" : "Brief ready (no Telegram chat target)", {
          briefingId: row.id,
          type: row.type,
          chatCount: chatIds.length,
        });
      } catch {
        // Skip malformed entries and continue
      }
    }
  } catch {
    // Ignore query errors during startup
  }
}

const DEFAULT_PUSH_INTERVAL_MS = 60 * 1000;

export function startResearchPushLoop(
  storage: Storage,
  bot: Bot,
  logger: Logger,
  intervalMs?: number,
  options?: PushLoopOptions,
): { stop(): void } {
  const ms = intervalMs ?? DEFAULT_PUSH_INTERVAL_MS;
  const timer = setInterval(() => {
    checkAndPushResearch(storage, bot, logger, options).catch(() => {});
  }, ms);
  return {
    stop() { clearInterval(timer); },
  };
}

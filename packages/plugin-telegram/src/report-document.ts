import { InputFile } from "grammy";
import type { Bot } from "grammy";
import PDFDocument from "pdfkit";

import { getArtifact } from "@personal-ai/core";
import type { Logger, Storage } from "@personal-ai/core";

import { formatTelegramResponse, stripHtmlTags, markdownToReportHTML, escapeHTML } from "./formatter.js";

export interface TelegramReportVisual {
  artifactId: string;
  title: string;
  caption?: string | null;
  order?: number;
}

interface TelegramReportDocumentOptions {
  title: string;
  markdown: string;
  fileName?: string;
  visuals?: TelegramReportVisual[];
  renderSpec?: unknown;
}

function slugifyFileStem(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "report";
}

function resolvePdfFileName(title: string, requestedFileName?: string): string {
  const fallback = `${slugifyFileStem(title)}.pdf`;
  if (!requestedFileName) return fallback;
  const stem = requestedFileName.replace(/\.[^.]+$/, "").trim();
  return `${slugifyFileStem(stem || title)}.pdf`;
}

function normalizePdfText(markdown: string): string {
  const formatted = formatTelegramResponse(markdown);
  const html = markdownToReportHTML(formatted);
  return stripHtmlTags(html)
    .replace(/\u00a0/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function ensureSpace(doc: PDFKit.PDFDocument, minHeight = 72): void {
  const remaining = doc.page.height - doc.page.margins.bottom - doc.y;
  if (remaining < minHeight) {
    doc.addPage();
  }
}

function writeHeading(doc: PDFKit.PDFDocument, title: string): void {
  ensureSpace(doc, 56);
  doc.moveDown(0.4);
  doc.fillColor("#0f172a");
  doc.font("Helvetica-Bold").fontSize(15).text(title, {
    width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
  });
  doc.moveDown(0.3);
}

function writeParagraph(doc: PDFKit.PDFDocument, text: string): void {
  if (!text.trim()) return;
  ensureSpace(doc, 48);
  doc.fillColor("#1e293b");
  doc.font("Helvetica").fontSize(11).text(text.trim(), {
    width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
    align: "left",
    lineGap: 2,
  });
  doc.moveDown(0.6);
}

function writeBullet(doc: PDFKit.PDFDocument, text: string): void {
  if (!text.trim()) return;
  ensureSpace(doc, 32);
  doc.fillColor("#1e293b");
  doc.font("Helvetica").fontSize(11).text(`• ${text.trim()}`, {
    width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
    indent: 8,
    lineGap: 2,
  });
  doc.moveDown(0.3);
}

function writeReportBody(doc: PDFKit.PDFDocument, markdown: string): void {
  const body = normalizePdfText(markdown);
  if (!body) return;

  writeHeading(doc, "Full Report");
  const blocks = body
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.length > 1 && lines.every((line) => line.startsWith("•") || line.startsWith("-"))) {
      for (const line of lines) {
        writeBullet(doc, line.replace(/^[•-]\s*/, ""));
      }
      continue;
    }

    if (block.startsWith("• ") || block.startsWith("- ")) {
      writeBullet(doc, block.replace(/^[•-]\s*/, ""));
      continue;
    }

    writeParagraph(doc, block);
  }
}

function writeVisuals(
  storage: Storage,
  doc: PDFKit.PDFDocument,
  visuals: TelegramReportVisual[] | undefined,
  logger: Logger,
): void {
  if (!visuals?.length) return;

  writeHeading(doc, "Visuals");
  for (const visual of [...visuals].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
    try {
      const artifact = getArtifact(storage, visual.artifactId);
      if (!artifact || !artifact.mimeType.startsWith("image/")) continue;
      ensureSpace(doc, 280);
      doc.font("Helvetica-Bold").fontSize(12).fillColor("#0f172a").text(visual.title || artifact.name);
      doc.moveDown(0.4);
      const maxWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      doc.image(artifact.data, {
        fit: [maxWidth, 260],
        align: "center",
      });
      doc.moveDown(0.5);
      if (visual.caption?.trim()) {
        doc.font("Helvetica").fontSize(10).fillColor("#475569").text(visual.caption.trim(), {
          width: maxWidth,
        });
        doc.moveDown(0.6);
      }
    } catch (err) {
      logger.warn("Failed to embed visual in Telegram PDF report", {
        artifactId: visual.artifactId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

async function renderPdfBuffer(
  storage: Storage,
  options: TelegramReportDocumentOptions,
  logger: Logger,
): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      margins: { top: 54, bottom: 54, left: 54, right: 54 },
      info: {
        Title: options.title,
        Author: "Personal AI",
        Subject: "Telegram brief companion report",
      },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fillColor("#0f172a");
    doc.font("Helvetica-Bold").fontSize(22).text(options.title.trim() || "Report", {
      width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
    });
    doc.moveDown(0.3);
    doc.font("Helvetica").fontSize(10).fillColor("#475569").text("Delivered privately by Personal AI via Telegram.");
    doc.moveDown(0.8);

    writeReportBody(doc, options.markdown);
    writeVisuals(storage, doc, options.visuals, logger);
    doc.end();
  });
}

export async function buildTelegramReportDocument(
  storage: Storage,
  options: TelegramReportDocumentOptions,
  logger: Logger,
): Promise<{ data: Buffer; fileName: string }> {
  const title = options.title.trim() || "Report";
  const data = await renderPdfBuffer(storage, options, logger);
  return {
    data,
    fileName: resolvePdfFileName(title, options.fileName),
  };
}

export async function sendReportDocumentToTelegram(
  storage: Storage,
  bot: Bot,
  chatId: number,
  options: TelegramReportDocumentOptions,
  logger: Logger,
): Promise<void> {
  const document = await buildTelegramReportDocument(storage, options, logger);
  const caption = escapeHTML((options.title.trim() || document.fileName).slice(0, 1024));
  await bot.api.sendDocument(chatId, new InputFile(document.data, document.fileName), {
    caption,
    parse_mode: "HTML",
    protect_content: true,
  });
}

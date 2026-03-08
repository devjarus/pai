import { InputFile } from "grammy";
import type { Bot } from "grammy";
import { getArtifact, specToStaticHtml } from "@personal-ai/core";
import type { Logger, Storage } from "@personal-ai/core";
import { escapeHTML, markdownToReportHTML } from "./formatter.js";

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
  /** json-render spec (parsed object or JSON string) */
  renderSpec?: unknown;
}

const REPORT_DOCUMENT_STYLE = `
  :root {
    color-scheme: dark light;
    --bg: #0b1220;
    --fg: #e6edf7;
    --muted: #9eb0c7;
    --border: #243247;
    --accent: #5eead4;
    --accent-bg: #0f2230;
    --code-bg: #111b2c;
    --card-bg: #101827;
  }
  @media (prefers-color-scheme: light) {
    :root {
      --bg: #ffffff;
      --fg: #132238;
      --muted: #5b6b82;
      --border: #d9e0ea;
      --accent: #0f766e;
      --accent-bg: #f0fdfa;
      --code-bg: #f4f7fb;
      --card-bg: #f8fafc;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 2.5rem 1.5rem 4rem;
    background: linear-gradient(180deg, var(--accent-bg) 0%, var(--bg) 18%);
    color: var(--fg);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    line-height: 1.7;
  }
  main {
    max-width: 880px;
    margin: 0 auto;
  }
  .report-header {
    margin-bottom: 2rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--border);
  }
  .report-header h1 {
    margin: 0 0 0.4rem;
    font-size: 2rem;
    line-height: 1.2;
  }
  .report-meta {
    color: var(--muted);
    font-size: 0.95rem;
  }
  h1, h2, h3, h4, h5, h6 { line-height: 1.25; }
  h2, h3, h4 { color: var(--accent); }
  a { color: var(--accent); }
  blockquote {
    margin: 1rem 0;
    padding: 0.75rem 1rem;
    border-left: 4px solid var(--accent);
    background: var(--accent-bg);
  }
  code, pre {
    font-family: "SFMono-Regular", Menlo, Consolas, monospace;
  }
  code {
    background: var(--code-bg);
    border-radius: 4px;
    padding: 0.1rem 0.35rem;
  }
  pre {
    overflow-x: auto;
    padding: 1rem;
    border-radius: 12px;
    background: var(--code-bg);
  }
  pre code {
    padding: 0;
    background: transparent;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 1rem 0;
  }
  th, td {
    padding: 0.65rem 0.8rem;
    border-bottom: 1px solid var(--border);
    text-align: left;
    vertical-align: top;
  }
  thead {
    background: var(--accent-bg);
  }
  .report-visuals {
    margin-top: 2.5rem;
    padding-top: 1.5rem;
    border-top: 1px solid var(--border);
  }
  .report-visuals-grid {
    display: grid;
    gap: 1rem;
  }
  .report-visual {
    margin: 0;
    padding: 1rem;
    border: 1px solid var(--border);
    border-radius: 16px;
    background: var(--card-bg);
  }
  .report-visual img {
    display: block;
    width: 100%;
    height: auto;
    border-radius: 10px;
  }
  .report-visual figcaption {
    margin-top: 0.7rem;
    color: var(--muted);
    font-size: 0.92rem;
  }
`;

function slugifyFileStem(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "report";
}

function resolveHtmlFileName(title: string, requestedFileName?: string): string {
  const fallback = `${slugifyFileStem(title)}.html`;
  if (!requestedFileName) return fallback;
  const stem = requestedFileName.replace(/\.[^.]+$/, "").trim();
  return `${slugifyFileStem(stem || title)}.html`;
}

function buildVisualGallery(
  storage: Storage,
  visuals: TelegramReportVisual[] | undefined,
  logger: Logger,
): string {
  if (!visuals?.length) return "";

  const figures: string[] = [];
  for (const visual of [...visuals].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
    try {
      const artifact = getArtifact(storage, visual.artifactId);
      if (!artifact || !artifact.mimeType.startsWith("image/")) continue;
      const src = `data:${artifact.mimeType};base64,${artifact.data.toString("base64")}`;
      const title = escapeHTML(visual.title || artifact.name);
      const caption = visual.caption?.trim() ? ` - ${escapeHTML(visual.caption.trim())}` : "";
      figures.push(
        `<figure class="report-visual"><img src="${src}" alt="${title}"><figcaption><strong>${title}</strong>${caption}</figcaption></figure>`,
      );
    } catch (err) {
      logger.warn("Failed to inline report visual for Telegram document", {
        artifactId: visual.artifactId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (figures.length === 0) return "";
  return `<section class="report-visuals"><h2>Visuals</h2><div class="report-visuals-grid">${figures.join("")}</div></section>`;
}

function buildSpecSection(
  storage: Storage,
  spec: unknown,
  logger: Logger,
): string {
  if (!spec) return "";
  const parsed = typeof spec === "string"
    ? (() => { try { return JSON.parse(spec); } catch { return null; } })()
    : spec;
  if (!parsed) return "";

  // Build an image resolver that converts /api/artifacts/<id> → base64 data URIs
  const resolveImageSrc = (src: string): string => {
    const match = src.match(/\/api\/artifacts\/([^/?#]+)/);
    if (!match?.[1]) return src;
    try {
      const artifact = getArtifact(storage, match[1]);
      if (artifact && artifact.mimeType.startsWith("image/")) {
        return `data:${artifact.mimeType};base64,${artifact.data.toString("base64")}`;
      }
    } catch (err) {
      logger.warn("Failed to inline spec artifact for Telegram document", {
        artifactId: match[1],
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return src;
  };

  const html = specToStaticHtml(parsed, { resolveImageSrc });
  return html ?? "";
}

export function buildTelegramReportDocument(
  storage: Storage,
  options: TelegramReportDocumentOptions,
  logger: Logger,
): { data: Buffer; fileName: string } {
  const title = options.title.trim() || "Report";
  const specSection = buildSpecSection(storage, options.renderSpec, logger);
  const body = markdownToReportHTML(options.markdown);
  const visuals = buildVisualGallery(storage, options.visuals, logger);
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark light">
  <title>${escapeHTML(title)}</title>
  <style>${REPORT_DOCUMENT_STYLE}</style>
</head>
<body>
  <main>
    <header class="report-header">
      <h1>${escapeHTML(title)}</h1>
      <p class="report-meta">Delivered privately by Personal AI via Telegram.</p>
    </header>
    ${specSection}
    ${body}
    ${visuals}
  </main>
</body>
</html>`;

  return {
    data: Buffer.from(html, "utf-8"),
    fileName: resolveHtmlFileName(title, options.fileName),
  };
}

export async function sendReportDocumentToTelegram(
  storage: Storage,
  bot: Bot,
  chatId: number,
  options: TelegramReportDocumentOptions,
  logger: Logger,
): Promise<void> {
  const document = buildTelegramReportDocument(storage, options, logger);
  const caption = (options.title.trim() || document.fileName).slice(0, 1024);
  await bot.api.sendDocument(chatId, new InputFile(document.data, document.fileName), {
    caption,
    protect_content: true,
  });
}

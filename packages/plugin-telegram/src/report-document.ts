import { InputFile } from "grammy";
import type { Bot } from "grammy";
import { marked } from "marked";

import { getArtifact, specToStaticHtml } from "@personal-ai/core";
import type { Logger, Storage } from "@personal-ai/core";

import { escapeHTML } from "./formatter.js";

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

/**
 * Strip ``` jsonrender ``` and ``` json ``` fenced blocks that contain render
 * specs or structured results — they should not appear in the prose section.
 */
function stripRenderBlocks(md: string): string {
  return md.replace(/```(?:jsonrender|json)\s*\n[\s\S]*?```/g, "").trim();
}

/**
 * CSS that closely matches the Inbox / Ask rich report styling.
 * Designed for print / PDF — A4 page, no scroll, clean typography.
 */
const REPORT_CSS = `
:root {
  --fg: #1a1a1a;
  --muted: #6b7280;
  --accent: #2563eb;
  --accent-bg: #eff6ff;
  --border: #e5e7eb;
  --card-bg: #f9fafb;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
  max-width: 800px;
  margin: 0 auto;
  padding: 48px 40px;
  line-height: 1.65;
  color: var(--fg);
  font-size: 14px;
}
.report-header {
  margin-bottom: 32px;
  padding-bottom: 20px;
  border-bottom: 3px solid var(--accent);
}
.report-header h1 {
  font-size: 1.7em;
  font-weight: 700;
  color: var(--fg);
  margin-bottom: 6px;
  line-height: 1.3;
}
.report-header .subtitle {
  font-size: 0.85em;
  color: var(--muted);
}
.spec-section { margin-bottom: 28px; }
.visuals-section { margin: 24px 0; }
.visual-card {
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  margin: 16px 0;
  break-inside: avoid;
}
.visual-card img {
  width: 100%;
  display: block;
}
.visual-card .caption {
  font-size: 0.82em;
  color: var(--muted);
  padding: 8px 14px;
  border-top: 1px solid var(--border);
  background: var(--card-bg);
}

/* Markdown prose */
h1 { font-size: 1.5em; border-bottom: 2px solid var(--accent); padding-bottom: 8px; font-weight: 700; margin: 1.5em 0 0.6em; }
h2 { font-size: 1.25em; margin-top: 1.4em; margin-bottom: 0.5em; color: var(--accent); font-weight: 600; }
h3 { font-size: 1.1em; margin-top: 1.2em; margin-bottom: 0.4em; font-weight: 600; }
h4 { font-size: 1em; margin-top: 1em; margin-bottom: 0.3em; font-weight: 600; color: var(--muted); }
p { margin: 0.7em 0; }
ul, ol { padding-left: 1.5em; margin: 0.5em 0; }
li { margin: 4px 0; }
hr { border: none; border-top: 1px solid var(--border); margin: 1.5em 0; }
strong { font-weight: 600; }
em { font-style: italic; }
a { color: var(--accent); text-decoration: none; }

/* Tables */
table { width: 100%; border-collapse: collapse; margin: 1em 0; font-size: 0.92em; }
thead { background: var(--accent-bg); }
th { font-weight: 600; text-align: left; padding: 0.55em 0.75em; border-bottom: 2px solid var(--accent); }
td { padding: 0.45em 0.75em; border-bottom: 1px solid var(--border); }
tr:nth-child(even) { background: var(--card-bg); }

/* Code */
pre { background: #f3f4f6; padding: 0.85em; border-radius: 8px; overflow-x: auto; font-size: 0.88em; margin: 1em 0; }
code { font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace; font-size: 0.9em; background: #f3f4f6; padding: 0.15em 0.35em; border-radius: 4px; }
pre code { background: none; padding: 0; }

/* Blockquotes */
blockquote {
  border-left: 3px solid var(--accent);
  padding: 0.6em 1.1em;
  margin: 1em 0;
  background: var(--accent-bg);
  border-radius: 0 8px 8px 0;
  color: #374151;
}

.footer {
  margin-top: 40px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
  font-size: 0.78em;
  color: var(--muted);
}

@media print {
  body { margin: 0; padding: 20px; }
  h2 { break-after: avoid; }
  tr { break-inside: avoid; }
  .visual-card { break-inside: avoid; }
  table { font-size: 10pt; }
}
`;

/**
 * Resolve artifact images to base64 data URIs for inline embedding in the PDF.
 */
function resolveArtifactDataUri(storage: Storage, artifactId: string, logger: Logger): string | null {
  try {
    const artifact = getArtifact(storage, artifactId);
    if (!artifact || !artifact.mimeType.startsWith("image/")) return null;
    const b64 = Buffer.isBuffer(artifact.data)
      ? artifact.data.toString("base64")
      : Buffer.from(artifact.data).toString("base64");
    return `data:${artifact.mimeType};base64,${b64}`;
  } catch (err) {
    logger.warn("Failed to resolve artifact for PDF embed", {
      artifactId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Build the full HTML page for the report.
 */
function buildReportHtml(
  storage: Storage,
  options: TelegramReportDocumentOptions,
  logger: Logger,
): string {
  const title = options.title.trim() || "Report";
  const safeTitle = title.replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // 1. Render the json-render spec if available
  let specHtml = "";
  let parsedSpec: Record<string, unknown> | null = null;
  if (options.renderSpec) {
    parsedSpec =
      typeof options.renderSpec === "string"
        ? (() => {
            try { return JSON.parse(options.renderSpec) as Record<string, unknown>; } catch { return null; }
          })()
        : (options.renderSpec as Record<string, unknown>);
    if (parsedSpec) {
      const resolveImageSrc = (src: string): string => {
        const match = src.match(/\/api\/artifacts\/([^/?#]+)/);
        if (match?.[1]) {
          return resolveArtifactDataUri(storage, match[1], logger) ?? src;
        }
        return src;
      };
      specHtml = specToStaticHtml(parsedSpec, { resolveImageSrc }) ?? "";
    }
  }

  // 2. Render visuals not already referenced in the spec
  let visualsHtml = "";
  if (options.visuals && options.visuals.length > 0) {
    const referencedIds = new Set<string>();
    if (parsedSpec && typeof parsedSpec === "object" && parsedSpec.elements) {
      for (const el of Object.values(parsedSpec.elements as Record<string, { props?: Record<string, unknown> }>)) {
        for (const candidate of [el.props?.src, el.props?.url]) {
          if (typeof candidate !== "string") continue;
          const match = candidate.match(/\/api\/artifacts\/([^/?#]+)/);
          if (match?.[1]) referencedIds.add(match[1]);
        }
      }
    }
    const remaining = [...options.visuals]
      .filter((v) => !referencedIds.has(v.artifactId))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    if (remaining.length > 0) {
      const cards = remaining
        .map((v) => {
          const dataUri = resolveArtifactDataUri(storage, v.artifactId, logger);
          if (!dataUri) return "";
          const caption = v.caption?.trim()
            ? `<div class="caption">${v.caption.trim().replace(/</g, "&lt;")}</div>`
            : "";
          const alt = (v.title || "Visual").replace(/"/g, "&quot;");
          return `<div class="visual-card">
            <img src="${dataUri}" alt="${alt}" />
            ${caption}
          </div>`;
        })
        .filter(Boolean)
        .join("\n");
      if (cards) {
        visualsHtml = `<div class="visuals-section">${cards}</div>`;
      }
    }
  }

  // 3. Render markdown body (strip spec/json blocks first)
  const cleaned = stripRenderBlocks(options.markdown);
  const markdownHtml = marked.parse(cleaned, { gfm: true, breaks: false, async: false }) as string;

  // Compose the full HTML page
  const bodyParts: string[] = [];
  bodyParts.push(`<div class="report-header">
    <h1>${safeTitle}</h1>
    <div class="subtitle">Delivered privately by Personal AI via Telegram</div>
  </div>`);

  if (specHtml) {
    bodyParts.push(`<div class="spec-section">${specHtml}</div>`);
  }
  if (visualsHtml) {
    bodyParts.push(visualsHtml);
  }
  if (markdownHtml.trim()) {
    bodyParts.push(`<div class="markdown-body">${markdownHtml}</div>`);
  }
  bodyParts.push(`<div class="footer">Generated by Personal AI</div>`);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle}</title>
  <style>${REPORT_CSS}</style>
</head>
<body>
${bodyParts.join("\n")}
</body>
</html>`;
}

export async function buildTelegramReportDocument(
  storage: Storage,
  options: TelegramReportDocumentOptions,
  logger: Logger,
): Promise<{ data: Buffer; fileName: string }> {
  const title = options.title.trim() || "Report";
  const html = buildReportHtml(storage, options, logger);
  const stem = resolvePdfFileName(title, options.fileName).replace(/\.pdf$/, "");
  return {
    data: Buffer.from(html, "utf-8"),
    fileName: `${stem}.html`,
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

/** Exported for tests */
export { buildReportHtml as _buildReportHtml };

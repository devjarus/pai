/** Convert standard Markdown to Telegram-compatible HTML and handle message splitting. */

const TELEGRAM_MAX_LENGTH = 4096;

export interface BriefingSections {
  greeting: string;
  taskFocus: {
    summary: string;
    items: Array<{ title: string; priority: string; insight: string }>;
  };
  memoryInsights: {
    summary: string;
    highlights: Array<{ statement: string; type: string; detail: string }>;
  };
  suggestions: Array<{ title: string; reason: string }>;
}

/** Format a briefing as Telegram HTML */
export function formatBriefingHTML(sections: BriefingSections): string {
  const lines: string[] = [];

  lines.push(`\uD83D\uDCCB <b>${escapeHTML(sections.greeting)}</b>`);
  lines.push("");

  if (sections.taskFocus?.items?.length) {
    lines.push(`<b>Tasks</b>  ${escapeHTML(sections.taskFocus.summary)}`);
    for (const item of sections.taskFocus.items.slice(0, 5)) {
      const icon = item.priority === "high" ? "\uD83D\uDD34" : item.priority === "medium" ? "\uD83D\uDFE1" : "\uD83D\uDFE2";
      lines.push(`${icon} <b>${escapeHTML(item.title)}</b>`);
      if (item.insight) lines.push(`    <i>${escapeHTML(item.insight)}</i>`);
    }
    lines.push("");
  }

  if (sections.memoryInsights?.highlights?.length) {
    lines.push(`<b>Memory Insights</b>  ${escapeHTML(sections.memoryInsights.summary)}`);
    for (const h of sections.memoryInsights.highlights.slice(0, 3)) {
      lines.push(`\uD83E\uDDE0 ${escapeHTML(h.statement)}`);
      if (h.detail) lines.push(`    <i>${escapeHTML(h.detail)}</i>`);
    }
    lines.push("");
  }

  if (sections.suggestions?.length) {
    lines.push("<b>Suggestions</b>");
    for (const s of sections.suggestions.slice(0, 3)) {
      lines.push(`\uD83D\uDCA1 <b>${escapeHTML(s.title)}</b> — ${escapeHTML(s.reason)}`);
    }
  }

  return lines.join("\n");
}

/** Escape HTML entities for Telegram */
export function escapeHTML(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function sanitizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Allow root-relative links (e.g. /api/artifacts/:id) for in-app downloads.
  if (trimmed.startsWith("/")) {
    if (trimmed.startsWith("//")) return null;
    return trimmed.replace(/"/g, "&quot;");
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    let safeUrl = parsed.toString();
    if (parsed.pathname === "/" && !parsed.search && !parsed.hash && !trimmed.endsWith("/")) {
      safeUrl = safeUrl.replace(/\/$/, "");
    }
    return safeUrl.replace(/"/g, "&quot;");
  } catch {
    return null;
  }
}

function replaceMarkdownLinks(text: string, render: (label: string, rawUrl: string) => string): string {
  let out = "";
  let i = 0;

  while (i < text.length) {
    const openBracket = text.indexOf("[", i);
    if (openBracket < 0) {
      out += text.slice(i);
      break;
    }

    out += text.slice(i, openBracket);

    const closeBracket = text.indexOf("]", openBracket + 1);
    if (closeBracket < 0 || text[closeBracket + 1] !== "(") {
      out += text.slice(openBracket, closeBracket < 0 ? text.length : closeBracket + 1);
      i = closeBracket < 0 ? text.length : closeBracket + 1;
      continue;
    }

    let depth = 1;
    let cursor = closeBracket + 2;
    while (cursor < text.length && depth > 0) {
      if (text[cursor] === "(") depth += 1;
      if (text[cursor] === ")") depth -= 1;
      cursor += 1;
    }

    if (depth !== 0) {
      out += text.slice(openBracket, cursor);
      i = cursor;
      continue;
    }

    const label = text.slice(openBracket + 1, closeBracket);
    const rawUrl = text.slice(closeBracket + 2, cursor - 1);
    out += render(label, rawUrl);
    i = cursor;
  }

  return out;
}

/**
 * Convert Markdown to Telegram HTML format.
 * Supports: bold, italic, code, code blocks, links, headers, strikethrough, blockquotes.
 */
export function markdownToTelegramHTML(md: string): string {
  let result = md;

  // Preserve code blocks first (replace with placeholders)
  const codeBlocks: string[] = [];
  result = result.replace(/```(\w*)\n?([\s\S]*?)```/g, (_match, _lang: string, code: string) => {
    const idx = codeBlocks.length;
    codeBlocks.push(`<pre>${escapeHTML(code.trimEnd())}</pre>`);
    return `\x00CB${idx}\x00`;
  });

  // Preserve inline code (replace with placeholders)
  const inlineCodes: string[] = [];
  result = result.replace(/`([^`\n]+)`/g, (_match, code: string) => {
    const idx = inlineCodes.length;
    inlineCodes.push(`<code>${escapeHTML(code)}</code>`);
    return `\x00IC${idx}\x00`;
  });

  // Escape HTML in remaining text
  result = escapeHTML(result);

  // Headers → bold
  result = result.replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>");

  // Bold: **text** or __text__
  result = result.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  result = result.replace(/__(.+?)__/g, "<b>$1</b>");

  // Italic: *text* or _text_ (but not inside words with underscores)
  result = result.replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, "<i>$1</i>");
  result = result.replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, "<i>$1</i>");

  // Strikethrough: ~~text~~
  result = result.replace(/~~(.+?)~~/g, "<s>$1</s>");

  // Links: [text](url)
  result = replaceMarkdownLinks(result, (label: string, rawUrl: string) => {
    const safeUrl = sanitizeUrl(rawUrl);
    if (!safeUrl) return label;
    return `<a href="${safeUrl}">${label}</a>`;
  });

  // Blockquotes: > text (Telegram doesn't support blockquote tag well, use italic)
  result = result.replace(/^&gt;\s?(.+)$/gm, "<i>$1</i>");

  // List bullets: - or * at start of line → bullet character
  result = result.replace(/^[-*]\s+/gm, "\u2022 ");

  // Numbered lists: keep as-is (already readable)

  // Restore code blocks and inline code
  result = result.replace(/\x00CB(\d+)\x00/g, (_match, idx: string) => codeBlocks[parseInt(idx, 10)] ?? "");
  result = result.replace(/\x00IC(\d+)\x00/g, (_match, idx: string) => inlineCodes[parseInt(idx, 10)] ?? "");

  return result.trim();
}

/**
 * Convert Markdown to regular HTML for downloadable report documents.
 * This keeps structure (headings, paragraphs, lists, code blocks, blockquotes, links)
 * so reports render clearly in browsers.
 */
export function markdownToReportHTML(md: string): string {
  let source = md.replace(/\r\n/g, "\n");

  const codeBlocks: string[] = [];
  source = source.replace(/```(\w*)\n?([\s\S]*?)```/g, (_match, lang: string, code: string) => {
    const idx = codeBlocks.length;
    const className = lang ? ` class="language-${escapeHTML(lang)}"` : "";
    codeBlocks.push(`<pre><code${className}>${escapeHTML(code.trimEnd())}</code></pre>`);
    return `\x00CB${idx}\x00`;
  });

  const inlineCodes: string[] = [];
  source = source.replace(/`([^`\n]+)`/g, (_match, code: string) => {
    const idx = inlineCodes.length;
    inlineCodes.push(`<code>${escapeHTML(code)}</code>`);
    return `\x00IC${idx}\x00`;
  });

  const inline = (text: string): string => {
    let out = escapeHTML(text);
    out = replaceMarkdownLinks(out, (label: string, rawUrl: string) => {
      const safeUrl = sanitizeUrl(rawUrl);
      if (!safeUrl) return label;
      return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    });
    out = out.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    out = out.replace(/__(.+?)__/g, "<strong>$1</strong>");
    out = out.replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, "<em>$1</em>");
    out = out.replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, "<em>$1</em>");
    out = out.replace(/~~(.+?)~~/g, "<del>$1</del>");
    out = out.replace(/\x00IC(\d+)\x00/g, (_match, idx: string) => inlineCodes[parseInt(idx, 10)] ?? "");
    return out;
  };

  const lines = source.split("\n");
  const html: string[] = [];
  let inUl = false;
  let inOl = false;
  let inBlockquote = false;

  const closeLists = () => {
    if (inUl) {
      html.push("</ul>");
      inUl = false;
    }
    if (inOl) {
      html.push("</ol>");
      inOl = false;
    }
  };

  const closeBlockquote = () => {
    if (inBlockquote) {
      html.push("</blockquote>");
      inBlockquote = false;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      closeLists();
      closeBlockquote();
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      closeLists();
      closeBlockquote();
      const [, hashes = "#", title = ""] = heading;
      const level = hashes.length;
      html.push(`<h${level}>${inline(title)}</h${level}>`);
      continue;
    }

    const ul = line.match(/^[-*]\s+(.+)$/);
    if (ul) {
      closeBlockquote();
      if (inOl) {
        html.push("</ol>");
        inOl = false;
      }
      if (!inUl) {
        html.push("<ul>");
        inUl = true;
      }
      const [, item = ""] = ul;
      html.push(`<li>${inline(item)}</li>`);
      continue;
    }

    const ol = line.match(/^\d+\.\s+(.+)$/);
    if (ol) {
      closeBlockquote();
      if (inUl) {
        html.push("</ul>");
        inUl = false;
      }
      if (!inOl) {
        html.push("<ol>");
        inOl = true;
      }
      const [, item = ""] = ol;
      html.push(`<li>${inline(item)}</li>`);
      continue;
    }

    const quote = line.match(/^>\s?(.+)$/);
    if (quote) {
      closeLists();
      if (!inBlockquote) {
        html.push("<blockquote>");
        inBlockquote = true;
      }
      const [, text = ""] = quote;
      html.push(`<p>${inline(text)}</p>`);
      continue;
    }

    closeLists();
    closeBlockquote();
    html.push(`<p>${inline(line)}</p>`);
  }

  closeLists();
  closeBlockquote();

  return html
    .join("\n")
    .replace(/\x00CB(\d+)\x00/g, (_match, idx: string) => codeBlocks[parseInt(idx, 10)] ?? "")
    .trim();
}

function humanizeKey(key: string): string {
  const withSpaces = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  if (!withSpaces) return key;
  return withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatPrimitive(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function formatObjectLines(value: Record<string, unknown>): string[] {
  const lines: string[] = [];

  for (const [key, raw] of Object.entries(value)) {
    const label = humanizeKey(key);

    if (raw === null || typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
      lines.push(`- **${label}:** ${formatPrimitive(raw)}`);
      continue;
    }

    if (Array.isArray(raw)) {
      if (raw.length === 0) continue;
      lines.push(`\n**${label}**`);
      for (const item of raw) {
        if (isRecord(item)) {
          const summary = Object.entries(item)
            .filter(([, v]) => v === null || ["string", "number", "boolean"].includes(typeof v))
            .slice(0, 4)
            .map(([k, v]) => `**${humanizeKey(k)}:** ${formatPrimitive(v)}`)
            .join(" | ");
          lines.push(`- ${summary || "(complex item)"}`);
        } else {
          lines.push(`- ${formatPrimitive(item)}`);
        }
      }
      continue;
    }

    if (isRecord(raw)) {
      lines.push(`\n**${label}**`);
      for (const [childKey, childVal] of Object.entries(raw)) {
        if (childVal === null || typeof childVal === "string" || typeof childVal === "number" || typeof childVal === "boolean") {
          lines.push(`- **${humanizeKey(childKey)}:** ${formatPrimitive(childVal)}`);
        }
      }
    }
  }

  return lines;
}

function formatJsonPayload(parsed: unknown): string | null {
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) return null;
    const lines: string[] = ["**Results**"];
    for (const item of parsed) {
      if (isRecord(item)) {
        const summary = Object.entries(item)
          .filter(([, v]) => v === null || ["string", "number", "boolean"].includes(typeof v))
          .slice(0, 6)
          .map(([k, v]) => `**${humanizeKey(k)}:** ${formatPrimitive(v)}`)
          .join(" | ");
        lines.push(`- ${summary || "(complex item)"}`);
      } else {
        lines.push(`- ${formatPrimitive(item)}`);
      }
    }
    return lines.join("\n");
  }

  if (!isRecord(parsed)) return null;

  const title = [parsed.ticker, parsed.company].filter((part): part is string => typeof part === "string" && part.length > 0)
    .join(" — ");
  const lines = [title ? `**${title}**` : "**Analysis Summary**", ...formatObjectLines(parsed)];
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function extractTrailingJson(text: string): { prefix: string; parsed: unknown } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch !== "{" && ch !== "[") continue;

    const candidate = trimmed.slice(i);
    try {
      const parsed = JSON.parse(candidate);
      const prefix = trimmed.slice(0, i).trimEnd();
      return { prefix, parsed };
    } catch {
      // continue scanning for the actual JSON start
    }
  }

  return null;
}

/**
 * Format a model response for Telegram.
 * If the response is raw JSON, convert it into a human-readable markdown summary.
 */
export function formatTelegramResponse(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return text;

  // Convert fenced JSON blocks (```json ... ```) into readable markdown summaries.
  let normalized = trimmed.replace(/```json\s*([\s\S]*?)```/gi, (match, payload: string) => {
    try {
      const formatted = formatJsonPayload(JSON.parse(payload.trim()));
      return formatted ?? match;
    } catch {
      return match;
    }
  });

  // Convert full JSON payloads or prose + trailing JSON payloads.
  const extracted = extractTrailingJson(normalized);
  if (!extracted) return normalized;

  const formatted = formatJsonPayload(extracted.parsed);
  if (!formatted) return normalized;

  return extracted.prefix ? `${extracted.prefix}\n\n${formatted}` : formatted;
}

/**
 * Split a message into chunks that fit Telegram's 4096-char limit.
 * Tries to split at paragraph boundaries, then newlines, then hard-splits.
 */
export function splitMessage(text: string, maxLength = TELEGRAM_MAX_LENGTH): string[] {
  if (text.length <= maxLength) return [text];

  const parts: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    let splitIdx = -1;

    // Try paragraph boundary (double newline)
    const paraIdx = remaining.lastIndexOf("\n\n", maxLength);
    if (paraIdx > maxLength * 0.3) {
      splitIdx = paraIdx;
    }

    // Fall back to single newline
    if (splitIdx === -1) {
      const nlIdx = remaining.lastIndexOf("\n", maxLength);
      if (nlIdx > maxLength * 0.3) {
        splitIdx = nlIdx;
      }
    }

    // Hard split at maxLength
    if (splitIdx === -1) {
      splitIdx = maxLength;
    }

    parts.push(remaining.slice(0, splitIdx).trimEnd());
    remaining = remaining.slice(splitIdx).trimStart();
  }

  if (remaining.length > 0) {
    parts.push(remaining);
  }

  return parts;
}

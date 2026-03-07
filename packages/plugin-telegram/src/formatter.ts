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
 * Normalize LLM-emitted HTML tags to their Markdown equivalents before conversion.
 * This runs early so the markdown pipeline handles them uniformly.
 */
function normalizeHtmlToMarkdown(text: string): string {
  let result = text;

  // Block-level: strip <p>, <div> wrappers (keep content)
  result = result.replace(/<\/?(?:p|div)(?:\s[^>]*)?>/gi, "\n");

  // <br> → newline
  result = result.replace(/<br\s*\/?>/gi, "\n");

  // Headings: <h1>…</h1> → # …
  result = result.replace(/<h([1-6])(?:\s[^>]*)?>(.+?)<\/h\1>/gi, (_m, level: string, content: string) =>
    "#".repeat(parseInt(level, 10)) + " " + content,
  );

  // Bold: <strong> / <b> → **…**
  result = result.replace(/<\/?(?:strong|b)(?:\s[^>]*)?>/gi, "**");

  // Italic: <em> / <i> → *…*
  result = result.replace(/<\/?(?:em|i)(?:\s[^>]*)?>/gi, "*");

  // Strikethrough: <del> / <s> → ~~…~~
  result = result.replace(/<\/?(?:del|s|strike)(?:\s[^>]*)?>/gi, "~~");

  // Code: <code> → ` (but not inside <pre>)
  result = result.replace(/<\/?code(?:\s[^>]*)?>/gi, "`");

  // Links: <a href="url">label</a> → [label](url)
  result = result.replace(/<a\s+href="([^"]*)"[^>]*>(.+?)<\/a>/gi, "[$2]($1)");

  // List items: <li> → "- " prefix, </li> → newline
  result = result.replace(/<li(?:\s[^>]*)?>/gi, "- ");
  result = result.replace(/<\/li>/gi, "\n");

  // Strip list wrappers
  result = result.replace(/<\/?(?:ul|ol)(?:\s[^>]*)?>/gi, "\n");

  // Horizontal rules: <hr> → ---
  result = result.replace(/<hr\s*\/?>/gi, "\n---\n");

  // Strip any remaining HTML tags we don't recognize
  result = result.replace(/<\/?[a-z][a-z0-9]*(?:\s[^>]*)?>/gi, "");

  // Collapse excessive newlines from tag stripping
  result = result.replace(/\n{3,}/g, "\n\n");

  return result;
}

/**
 * Convert Markdown to Telegram HTML format.
 * Supports: bold, italic, code, code blocks, links, headers, strikethrough,
 * blockquotes, tables, horizontal rules, and images.
 *
 * Uses a placeholder/marker system to protect pre-built HTML fragments
 * from the escapeHTML pass that sanitizes remaining text.
 */
export function markdownToTelegramHTML(md: string): string {
  let result = md;

  // --- Marker arrays: content stored here bypasses escapeHTML ---
  const codeBlocks: string[] = [];   // \x00CB<idx>\x00
  const inlineCodes: string[] = [];  // \x00IC<idx>\x00
  const linkMarkers: string[] = [];  // \x00LK<idx>\x00

  // 1. Preserve code blocks FIRST (before HTML normalization, so tags inside code are safe)
  result = result.replace(/```(\w*)\n?([\s\S]*?)```/g, (_match, _lang: string, code: string) => {
    const idx = codeBlocks.length;
    codeBlocks.push(`<pre>${escapeHTML(code.trimEnd())}</pre>`);
    return `\x00CB${idx}\x00`;
  });

  // 2. Preserve inline code
  result = result.replace(/`([^`\n]+)`/g, (_match, code: string) => {
    const idx = inlineCodes.length;
    inlineCodes.push(`<code>${escapeHTML(code)}</code>`);
    return `\x00IC${idx}\x00`;
  });

  // 3. Normalize any LLM-emitted HTML tags to markdown (now safe — code blocks are protected)
  result = normalizeHtmlToMarkdown(result);

  // 4. Preserve links as markers BEFORE escapeHTML (prevents double-encoding of & in URLs)
  //    Also handles images: ![alt](url) → link to the image
  result = replaceMarkdownLinks(result, (label: string, rawUrl: string) => {
    const safeUrl = sanitizeUrl(rawUrl);
    if (!safeUrl) return label;
    const idx = linkMarkers.length;
    linkMarkers.push(`<a href="${safeUrl}">${escapeHTML(label)}</a>`);
    return `\x00LK${idx}\x00`;
  });
  // Image syntax: ![alt](url) → clickable link (Telegram doesn't inline images in text)
  result = result.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt: string, rawUrl: string) => {
    const safeUrl = sanitizeUrl(rawUrl);
    if (!safeUrl) return alt || "";
    const label = alt || "image";
    const idx = linkMarkers.length;
    linkMarkers.push(`<a href="${safeUrl}">${escapeHTML(label)}</a>`);
    return `\x00LK${idx}\x00`;
  });

  // 5. Convert markdown tables to readable format (using markers for wide tables)
  result = result.replace(
    /^(\|.+\|)\n(\|[\s:|-]+\|)\n((?:\|.+\|\n?)+)/gm,
    (_m, headerRow: string, _sep: string, bodyRows: string) => {
      const headers = headerRow.split("|").slice(1, -1).map((c: string) => c.trim());
      const rows = bodyRows.trim().split("\n").map((row: string) =>
        row.split("|").slice(1, -1).map((c: string) => c.trim())
      );
      if (headers.length === 2) {
        return rows.map((cols) => `\u2022 ${cols[0]}: ${cols[1]}`).join("\n");
      }
      const colWidths = headers.map((h, i) =>
        Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length))
      );
      const pad = (s: string, w: number) => s + " ".repeat(Math.max(0, w - s.length));
      const headerLine = headers.map((h, i) => pad(h, colWidths[i] ?? h.length)).join(" | ");
      const sepLine = colWidths.map((w) => "-".repeat(w)).join("-+-");
      const bodyLines = rows.map((cols) =>
        cols.map((c, i) => pad(c, colWidths[i] ?? c.length)).join(" | ")
      );
      const tableText = headerLine + "\n" + sepLine + "\n" + bodyLines.join("\n");
      const idx = codeBlocks.length;
      codeBlocks.push(`<pre>${escapeHTML(tableText)}</pre>`);
      return `\x00CB${idx}\x00`;
    }
  );

  // 6. Horizontal rules: --- or *** or ___ (3+ chars, standalone line) → visual separator
  result = result.replace(/^[-*_]{3,}\s*$/gm, "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");

  // --- Now safe to escape remaining text ---
  result = escapeHTML(result);

  // 7. Convert remaining markdown syntax to Telegram HTML tags
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

  // Blockquotes: > text (Telegram doesn't support blockquote tag well, use italic)
  result = result.replace(/^&gt;\s?(.+)$/gm, "<i>$1</i>");

  // List bullets: - or * at start of line → bullet character
  result = result.replace(/^[-*]\s+/gm, "\u2022 ");

  // 8. Restore all markers
  result = result.replace(/\x00CB(\d+)\x00/g, (_match, idx: string) => codeBlocks[parseInt(idx, 10)] ?? "");
  result = result.replace(/\x00IC(\d+)\x00/g, (_match, idx: string) => inlineCodes[parseInt(idx, 10)] ?? "");
  result = result.replace(/\x00LK(\d+)\x00/g, (_match, idx: string) => linkMarkers[parseInt(idx, 10)] ?? "");

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

  // Strip jsonrender blocks (UI render specs, not for humans)
  let normalized = trimmed.replace(/```jsonrender\s*[\s\S]*?```/gi, "").trim();

  // Strip HTML <br> / <br/> tags that LLMs sometimes emit (they'd appear as literal text)
  normalized = normalized.replace(/<br\s*\/?>/gi, "\n");

  // Convert fenced JSON blocks (```json ... ```) into readable markdown summaries.
  normalized = normalized.replace(/```json\s*([\s\S]*?)```/gi, (match, payload: string) => {
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
 * Check whether a candidate split position falls inside an HTML tag.
 * Returns true if the position is between an unmatched `<` and `>`.
 */
function isInsideHtmlTag(text: string, pos: number): boolean {
  // Scan backwards from pos for the nearest '<' or '>'
  for (let i = pos - 1; i >= 0; i--) {
    if (text[i] === ">") return false; // tag closed before us
    if (text[i] === "<") return true;  // inside an open tag
  }
  return false;
}

/**
 * Find a safe split position at or before `target` that is not inside an HTML tag.
 * Falls back to the original position if no safe alternative is found within 200 chars.
 */
function safeSplitPos(text: string, target: number): number {
  if (!isInsideHtmlTag(text, target)) return target;
  // Walk backwards to find a position just before the opening '<'
  for (let i = target - 1; i >= Math.max(0, target - 200); i--) {
    if (text[i] === "<") return i;
  }
  return target;
}

/**
 * Split a message into chunks that fit Telegram's 4096-char limit.
 * Tries to split at paragraph boundaries, then newlines, then hard-splits.
 * Avoids splitting inside HTML tags.
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
      splitIdx = safeSplitPos(remaining, paraIdx);
    }

    // Fall back to single newline
    if (splitIdx === -1) {
      const nlIdx = remaining.lastIndexOf("\n", maxLength);
      if (nlIdx > maxLength * 0.3) {
        splitIdx = safeSplitPos(remaining, nlIdx);
      }
    }

    // Hard split at maxLength
    if (splitIdx === -1) {
      splitIdx = safeSplitPos(remaining, maxLength);
    }

    parts.push(remaining.slice(0, splitIdx).trimEnd());
    remaining = remaining.slice(splitIdx).trimStart();
  }

  if (remaining.length > 0) {
    parts.push(remaining);
  }

  return parts;
}

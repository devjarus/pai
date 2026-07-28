/**
 * Convert raw / truncated research JSON into readable markdown.
 * Mirrors packages/core report-presentation sanitize behavior for UI-only paths
 * (UI does not depend on @personal-ai/core).
 */

function isReportStructuredData(data: Record<string, unknown>): boolean {
  return !!(data.topic || data.summary || data.articles || data.ticker || data.findings || data.results);
}

function pickUrlField(item: Record<string, unknown>): string {
  const direct = item.url ?? item.link ?? item.href;
  if (typeof direct === "string" && direct.trim()) return direct.trim();

  for (const [key, value] of Object.entries(item)) {
    if (typeof value !== "string" || !value.trim()) continue;
    if (!/url|link|href/i.test(key)) continue;
    if (/^https?:\/\//i.test(value.trim())) return value.trim();
  }
  return "";
}

export function repairTruncatedJson(text: string): string | null {
  let s = text.trim();
  if (!s.startsWith("{") && !s.startsWith("[")) return null;

  const stack: Array<"{" | "["> = [];
  let inString = false;
  let escape = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }

    switch (ch) {
      case '"':
        inString = true;
        break;
      case "{":
        stack.push("{");
        break;
      case "[":
        stack.push("[");
        break;
      case "}":
        if (stack[stack.length - 1] === "{") stack.pop();
        break;
      case "]":
        if (stack[stack.length - 1] === "[") stack.pop();
        break;
      default:
        break;
    }
  }

  if (inString) s += '"';

  for (let pass = 0; pass < 4; pass++) {
    const next = s
      .replace(/,\s*$/, "")
      .replace(/:\s*$/, "")
      .replace(/,\s*"[^"\\]*(?:\\.[^"\\]*)*"\s*$/, "")
      .replace(/\{\s*"[^"\\]*(?:\\.[^"\\]*)*"\s*$/, "{")
      .replace(/\[\s*"[^"\\]*(?:\\.[^"\\]*)*"\s*$/, "[");
    if (next === s) break;
    s = next;
  }

  while (stack.length > 0) {
    s = s.replace(/,\s*$/, "");
    const open = stack.pop();
    s += open === "{" ? "}" : "]";
  }

  return s;
}

function structuredJsonToMarkdown(data: Record<string, unknown>): string {
  const lines: string[] = [];
  const topic = data.topic ?? data.title ?? "Research Report";
  const summary = data.summary ?? data.description ?? "";

  lines.push(`# ${topic}`);
  if (summary) lines.push("", String(summary));

  const items = (data.articles ?? data.findings ?? data.results) as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(items) && items.length > 0) {
    lines.push("", "## Key Findings");
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const title = item.title ?? item.name ?? "Untitled";
      const source = item.source ?? "";
      const url = pickUrlField(item);
      const keyPoints = item.keyPoints as string[] | undefined;
      lines.push("", `### ${title}`);
      if (source) lines.push(`*Source: ${source}*`);
      if (url) lines.push(`[Read more](${url})`);
      if (Array.isArray(keyPoints)) {
        for (const point of keyPoints) {
          if (point != null && String(point).trim()) lines.push(`- ${point}`);
        }
      }
    }
  }

  const timeline = data.timeline as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(timeline) && timeline.length > 0) {
    lines.push("", "## Timeline");
    for (const event of timeline) {
      if (!event || typeof event !== "object") continue;
      if (event.date == null && event.event == null) continue;
      lines.push(`- **${event.date ?? "Unknown"}** — ${event.event ?? ""}`);
    }
  }

  const sources = data.sources as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(sources) && sources.length > 0) {
    lines.push("", "## Sources");
    for (const src of sources) {
      if (!src || typeof src !== "object") continue;
      const title = src.title ?? src.name ?? "Source";
      const url = pickUrlField(src);
      lines.push(url ? `- [${title}](${url})` : `- ${title}`);
    }
  }

  return lines.join("\n");
}

function tryParseReportJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return null;

  try {
    const direct = JSON.parse(trimmed) as Record<string, unknown>;
    if (direct && isReportStructuredData(direct)) return direct;
  } catch {
    // fall through to repair
  }

  const repaired = repairTruncatedJson(trimmed);
  if (!repaired) return null;
  try {
    const parsed = JSON.parse(repaired) as Record<string, unknown>;
    if (parsed && isReportStructuredData(parsed)) return parsed;
  } catch {
    return null;
  }
  return null;
}

/**
 * Strip XML-style tool-call markup some models emit as plain text
 * (e.g. `<tool_call>web_search <arg_key>query</arg_key><arg_value>...</arg_value>`).
 */
export function stripLeakedToolMarkup(text: string): string {
  let s = text;

  s = s.replace(/<(tool_call|function_call|function_calls|tool_calls)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  s = s.replace(/<invoke\b[^>]*>[\s\S]*?<\/invoke\s*>/gi, "");

  const unclosedToolCall =
    /<(?:tool_call|function_call)\b[^>]*>\s*[\w.:/-]*\s*(?:<\s*(?:arg_key|arg_value|arg_name|parameter)\b[^>]*>[\s\S]*?(?:<\/\s*(?:arg_key|arg_value|arg_name|parameter)\s*>|\/>)[\s\/>]*)*/gi;
  s = s.replace(unclosedToolCall, "");

  s = s.replace(
    /<\/?(?:tool_call|function_call|function_calls|tool_calls|invoke|arg_key|arg_value|arg_name|parameter)\b[^>]*>/gi,
    "",
  );
  s = s.replace(/^\s*\/>\s*$/gm, "");

  return s.trim().replace(/\n{3,}/g, "\n\n");
}

export function sanitizeReportMarkdown(text: string | undefined): string | undefined {
  if (!text) return text;
  const withoutTools = stripLeakedToolMarkup(text);
  if (!withoutTools) return undefined;

  const trimmed = withoutTools.trim();
  if (!trimmed.startsWith("{")) return withoutTools;
  const parsed = tryParseReportJson(trimmed);
  if (!parsed) return withoutTools;
  return structuredJsonToMarkdown(parsed);
}

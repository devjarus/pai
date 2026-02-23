/** Convert standard Markdown to Telegram-compatible HTML and handle message splitting. */

const TELEGRAM_MAX_LENGTH = 4096;

/** Escape HTML entities for Telegram */
function escapeHTML(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

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

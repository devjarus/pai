/**
 * URL safety utilities — domain filtering for web search results and report content.
 *
 * Defense-in-depth: filters untrusted domains from SearXNG results before the LLM
 * sees them, and sanitizes URLs in generated reports before they're saved as artifacts.
 */

/**
 * Built-in domain blocklist — known spam, SEO farms, and low-quality domains.
 * Matched by suffix so "example.com" also blocks "sub.example.com".
 */
const DEFAULT_BLOCKED_DOMAINS: string[] = [
  // SEO spam / content farms
  "iliashalkin.com",
];

/**
 * Check if a hostname matches any entry in the blocklist (suffix match).
 * "sub.example.com" is blocked by "example.com".
 */
export function isDomainBlocked(
  hostname: string,
  blocklist: string[] = DEFAULT_BLOCKED_DOMAINS,
): boolean {
  const lower = hostname.toLowerCase();
  return blocklist.some((blocked) => {
    const b = blocked.toLowerCase();
    return lower === b || lower.endsWith(`.${b}`);
  });
}

/**
 * Parse hostname from a URL string. Returns null on invalid URLs.
 */
function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Filter search results, removing any whose URL matches a blocked domain.
 */
export function filterSearchResults<T extends { url: string }>(
  results: T[],
  blocklist?: string[],
): T[] {
  return results.filter((r) => {
    const host = hostnameOf(r.url);
    if (!host) return false; // drop results with invalid URLs
    return !isDomainBlocked(host, blocklist);
  });
}

/** Regex to find markdown links [text](url) and bare URLs in text. */
const URL_PATTERN = /https?:\/\/[^\s)\]>"']+/g;

/**
 * Sanitize markdown content by removing URLs from blocked domains.
 * - Markdown links `[text](blocked-url)` → `[text]` (keeps the text)
 * - Bare URLs → removed
 * - Source lines `Source: blocked-url` → removed entirely
 */
export function sanitizeReportUrls(
  content: string,
  blocklist?: string[],
): string {
  // First pass: remove markdown links whose URL is blocked → keep link text
  let result = content.replace(
    /\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g,
    (_match, text: string, url: string) => {
      const host = hostnameOf(url);
      if (host && isDomainBlocked(host, blocklist)) return text;
      return _match;
    },
  );

  // Second pass: remove bare blocked URLs
  result = result.replace(URL_PATTERN, (url) => {
    const host = hostnameOf(url);
    if (host && isDomainBlocked(host, blocklist)) return "";
    return url;
  });

  // Third pass: clean up empty "Source:" lines left behind
  result = result.replace(/^\s*Source:\s*$/gm, "");

  return result;
}

/**
 * Merge the default blocklist with a user-provided custom blocklist.
 */
export function resolveBlocklist(custom?: string[]): string[] {
  if (!custom || custom.length === 0) return DEFAULT_BLOCKED_DOMAINS;
  // Deduplicate
  return [...new Set([...DEFAULT_BLOCKED_DOMAINS, ...custom.map((d) => d.toLowerCase())])];
}

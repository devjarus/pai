/**
 * Web search utility using Brave Search HTML endpoint.
 * No API key required. Uses Node 20+ built-in fetch.
 */

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Fetches search results from Brave Search's HTML endpoint.
 * Returns up to `maxResults` results (default 5).
 */
export async function webSearch(
  query: string,
  maxResults = 5,
): Promise<SearchResult[]> {
  const encoded = encodeURIComponent(query);
  const url = `https://search.brave.com/search?q=${encoded}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html",
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Brave search failed: ${response.status}`);
  }

  const html = await response.text();
  const results = parseResults(html, maxResults);

  // Fallback: if primary parsing finds nothing, try a simpler regex for links
  if (results.length === 0) {
    return parseFallback(html, maxResults);
  }

  return results;
}

/**
 * Parse Brave Search HTML results.
 * Brave wraps web results in <div class="snippet" data-type="web">.
 * Title is in <div class="title ..."> inside an <a> link.
 * Description is in <div class="description ..."> or <div class="content ...">.
 */
function parseResults(html: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = [];

  // Match each web result snippet block
  const resultBlockRegex =
    /<div class="snippet[^"]*"[^>]*data-type="web"[^>]*>([\s\S]*?)(?=<div class="snippet|<\/main>|$)/gi;

  let match: RegExpExecArray | null;
  while ((match = resultBlockRegex.exec(html)) !== null && results.length < maxResults) {
    const block = match[1] ?? "";

    // Extract URL from first <a href="https://...">
    const urlMatch = /<a href="(https?:\/\/[^"]+)"/.exec(block);
    if (!urlMatch) continue;
    const url = urlMatch[1] ?? "";

    // Skip Brave's own URLs
    if (url.includes("search.brave.com")) continue;

    // Extract title from <div class="title ...">
    const titleMatch = /<div class="title[^"]*"[^>]*(?:title="([^"]*)")?[^>]*>([\s\S]*?)<\/div>/.exec(block);
    const title = titleMatch
      ? stripHtml(titleMatch[1] || titleMatch[2] || "").trim()
      : "";

    // Extract description from <div class="content ..."> or <div class="description ...">
    const descMatch =
      /<div class="content[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(block) ||
      /<div class="description[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(block);
    const snippet = descMatch ? stripHtml(descMatch[1] ?? "").trim() : "";

    if (title && url) {
      results.push({ title, url, snippet });
    }
  }

  return results;
}

/**
 * Fallback parser: extract links and text from any <a> tags with titles.
 * Used when the primary snippet-based parser fails (e.g., HTML structure changed).
 */
function parseFallback(html: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = [];
  const linkRegex = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([^<]+)<\/a>/gi;
  let match: RegExpExecArray | null;
  const seen = new Set<string>();

  while ((match = linkRegex.exec(html)) !== null && results.length < maxResults) {
    const url = match[1] ?? "";
    const title = stripHtml(match[2] ?? "").trim();
    if (!title || title.length < 5 || url.includes("search.brave.com") || seen.has(url)) continue;
    seen.add(url);
    results.push({ title, url, snippet: "" });
  }

  return results;
}

/** Strip HTML tags and decode common entities. */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Format search results into a context block for LLM injection.
 */
export function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) return "";

  const formatted = results
    .map(
      (r, i) =>
        `${i + 1}. **${r.title}**\n   ${r.snippet}\n   Source: ${r.url}`,
    )
    .join("\n\n");

  return `## Web Search Results\n\n${formatted}`;
}

/** Keywords/patterns that suggest a query needs web search. */
const SEARCH_INDICATORS = [
  /\b(latest|newest|recent|current|today|now|this\s+(week|month|year))\b/i,
  /\b(news|headline|update|announcement|release)\b/i,
  /\b202[4-9]\b/, // years 2024-2029
  /\b(what\s+is|who\s+is|when\s+(did|does|is|was|will))\b/i,
  /\b(how\s+to|how\s+do)\b/i,
  /\b(price|cost|weather|stock|score|result)\b/i,
  /\b(compare|vs\.?|versus|difference\s+between)\b/i,
  /\b(search|look\s+up|find\s+out|google)\b/i,
];

/**
 * Heuristic check: does this query likely need web search?
 * Returns true if the message matches common patterns for questions
 * that benefit from up-to-date web information.
 */
export function needsWebSearch(message: string): boolean {
  // Very short messages are unlikely to need search
  if (message.length < 10) return false;

  // Check for explicit search request
  if (/\bsearch\b|\blook\s*up\b|\bgoogle\b/i.test(message)) return true;

  // Check against indicator patterns — need at least one match
  // plus the message should be a question or request
  const hasIndicator = SEARCH_INDICATORS.some((pattern) =>
    pattern.test(message),
  );
  const isQuestion = /\?$/.test(message.trim()) || /^(what|who|when|where|why|how|is|are|was|were|did|does|do|can|could|will|would|should)\b/i.test(message.trim());

  return hasIndicator && isQuestion;
}

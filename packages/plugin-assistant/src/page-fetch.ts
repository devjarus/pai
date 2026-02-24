import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});

export interface PageContent {
  title: string;
  markdown: string;
  url: string;
  excerpt?: string;
}

/**
 * SSRF protection: block private/internal IPs and non-HTTP(S) schemes.
 */
function isAllowedUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    const host = parsed.hostname.toLowerCase();
    // Block loopback
    if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]") return false;
    // Block private RFC1918 ranges
    if (/^10\./.test(host)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
    if (/^192\.168\./.test(host)) return false;
    // Block link-local
    if (/^169\.254\./.test(host)) return false;
    // Block cloud metadata endpoints
    if (host === "metadata.google.internal") return false;
    // Block IPv6 private/link-local
    if (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Fetch raw HTML from a URL.
 */
async function fetchHTML(url: string): Promise<{ html: string; finalUrl: string } | null> {
  if (!isAllowedUrl(url)) return null;
  // Use a realistic browser User-Agent to avoid bot detection
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    signal: AbortSignal.timeout(15_000),
    redirect: "follow",
  });

  if (!response.ok) return null;

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
    return null;
  }

  return { html: await response.text(), finalUrl: response.url };
}

/**
 * Fetch a URL via Jina Reader API, which renders JavaScript and returns markdown.
 * Used as a fallback for client-side rendered pages.
 */
async function fetchViaJinaReader(url: string): Promise<PageContent | null> {
  try {
    const response = await fetch(`https://r.jina.ai/${url}`, {
      headers: {
        "Accept": "text/markdown",
        "X-No-Cache": "true",
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) return null;

    const raw = await response.text();
    if (!raw || raw.trim().length < 100) return null;

    // Jina returns metadata lines like "Title: X" and "Markdown Content:" before the actual content
    let markdown = raw;
    let title = "Untitled";

    const titleLine = raw.match(/^Title:\s*(.+)$/m);
    if (titleLine?.[1]) title = titleLine[1].trim();

    // Strip Jina metadata header (Title:, URL Source:, Markdown Content:)
    const contentStart = raw.indexOf("Markdown Content:");
    if (contentStart !== -1) {
      markdown = raw.substring(contentStart + "Markdown Content:".length).trim();
    }

    if (markdown.trim().length < 100) return null;

    // Ensure it starts with a heading
    if (!markdown.startsWith("#")) {
      markdown = `# ${title}\n\n${markdown}`;
    }

    return { title, markdown, url, excerpt: undefined };
  } catch {
    return null;
  }
}

/**
 * Fetch a URL and extract the main article content as Markdown.
 * Uses Mozilla's Readability (Firefox Reader View algorithm) + Turndown for HTML→MD.
 * Falls back to Jina Reader API for JS-rendered pages.
 */
export async function fetchPageAsMarkdown(url: string): Promise<PageContent | null> {
  if (!isAllowedUrl(url)) return null;
  const result = await fetchHTML(url);
  if (!result) {
    // fetchHTML failed entirely — try Jina Reader as last resort
    return fetchViaJinaReader(url);
  }

  const { document } = parseHTML(result.html);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reader = new Readability(document as any);
  const article = reader.parse();

  if (article) {
    const markdown = turndown.turndown(article.content);
    // If Readability extracted meaningful content, use it
    if (markdown.trim().length > 100) {
      const title = article.title ?? "Untitled";
      return {
        title,
        markdown: `# ${title}\n\n${markdown}`,
        url: result.finalUrl,
        excerpt: article.excerpt ?? undefined,
      };
    }
  }

  // Readability failed or got trivial content (e.g., "Loading..." from CSR pages)
  // Fall back to Jina Reader which renders JavaScript
  return fetchViaJinaReader(result.finalUrl);
}

/**
 * Extract internal links from a page that share the same domain.
 * Tries multiple strategies to find sub-pages:
 * 1. Direct sub-path links (e.g., /learn/*)
 * 2. All same-domain doc-like links (fallback for sites with different URL structures)
 */
export async function discoverSubPages(url: string): Promise<string[]> {
  if (!isAllowedUrl(url)) return [];
  const result = await fetchHTML(url);
  if (!result) return [];

  const { document } = parseHTML(result.html);
  // Use the final URL after redirects as the base for resolving links
  const baseUrl = new URL(result.finalUrl);
  const basePath = baseUrl.pathname.replace(/\/+$/, "") || "/";

  const subPathLinks = new Set<string>();
  const allInternalLinks = new Set<string>();
  const MAX_LINKS = 500;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anchors = (document as any).querySelectorAll("a[href]");
  for (const a of anchors) {
    if (allInternalLinks.size >= MAX_LINKS) break;
    const href = a.getAttribute("href");
    if (!href) continue;

    try {
      const resolved = new URL(href, result.finalUrl);
      // Same domain only
      if (resolved.hostname !== baseUrl.hostname) continue;

      const resolvedPath = resolved.pathname.replace(/\/+$/, "") || "/";
      // Skip non-page extensions
      if (resolvedPath.match(/\.(css|js|png|jpg|gif|svg|pdf|zip|json|xml|ico|woff2?)$/i)) continue;
      // Skip exact same page
      if (resolvedPath === basePath) continue;

      resolved.hash = "";
      resolved.search = "";
      const clean = resolved.toString();

      // Strategy 1: direct sub-path
      if (resolvedPath.startsWith(basePath + "/")) {
        subPathLinks.add(clean);
      }

      // Strategy 2: all internal links (for sites with different URL structures)
      allInternalLinks.add(clean);
    } catch {
      // Invalid URL — skip
    }
  }

  // Prefer sub-path links if we found any, otherwise use all internal links
  const links = subPathLinks.size > 0 ? subPathLinks : allInternalLinks;
  return [...links].sort();
}

/**
 * Web search utility using SearXNG JSON API.
 * Self-hosted, no API key required, no rate limits.
 */

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  thumbnail?: string;
}

export type SearchCategory =
  | "general"
  | "news"
  | "it"
  | "images"
  | "videos"
  | "social media"
  | "files";

/**
 * Resolve the SearXNG base URL from environment.
 * Priority: PAI_SEARCH_URL > Railway internal > Docker default > localhost.
 */
export function resolveSearchUrl(): string {
  if (process.env.PAI_SEARCH_URL) return process.env.PAI_SEARCH_URL;
  if (process.env.RAILWAY_VOLUME_MOUNT_PATH) return "http://searxng.railway.internal:8080";
  if (process.env.PAI_DATA_DIR === "/data") return "http://searxng:8080";
  return "http://localhost:8080";
}

/**
 * Fetches search results from a SearXNG instance.
 * Returns up to `maxResults` results (default 5).
 */
export async function webSearch(
  query: string,
  maxResults = 5,
  category: SearchCategory = "general",
): Promise<SearchResult[]> {
  const baseUrl = resolveSearchUrl();
  const params = new URLSearchParams({
    q: query,
    format: "json",
    categories: category,
  });

  const response = await fetch(`${baseUrl}/search?${params.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`SearXNG search failed: ${response.status}`);
  }

  const data = (await response.json()) as { results?: Array<{ title?: string; url?: string; content?: string; thumbnail?: string; img_src?: string }> };
  const results = data.results ?? [];

  return results.slice(0, maxResults).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: r.content ?? "",
    ...(r.thumbnail || r.img_src ? { thumbnail: r.thumbnail || r.img_src } : {}),
  }));
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

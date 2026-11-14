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
 * Resolve the SearXNG base URL.
 * Priority: configUrl > PAI_SEARCH_URL env > null.
 * No localhost / Railway / Docker auto-defaults — those silently pointed at
 * backends that often are not running. Compose sets PAI_SEARCH_URL explicitly.
 */
export function resolveSearchUrl(configUrl?: string): string | null {
  if (configUrl) return configUrl;
  if (process.env.PAI_SEARCH_URL) return process.env.PAI_SEARCH_URL;
  return null;
}

/** True when an explicit search backend URL is configured. */
export function isSearchConfigured(configUrl?: string): boolean {
  return resolveSearchUrl(configUrl) != null;
}

export type TimeRange = "day" | "week" | "month" | "year" | "";

const TIME_RANGE_FALLBACKS: Record<Exclude<TimeRange, "">, TimeRange[]> = {
  day: ["week", ""],
  week: [""],
  month: [""],
  year: [""],
};

async function fetchSearxResults(
  baseUrl: string,
  query: string,
  category: SearchCategory,
  timeRange: TimeRange,
): Promise<Array<{ title?: string; url?: string; content?: string; thumbnail?: string; img_src?: string }>> {
  const params = new URLSearchParams({
    q: query,
    format: "json",
    categories: category,
  });
  if (timeRange) params.set("time_range", timeRange);

  const response = await fetch(`${baseUrl}/search?${params.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`SearXNG search failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    results?: Array<{ title?: string; url?: string; content?: string; thumbnail?: string; img_src?: string }>;
  };
  return data.results ?? [];
}

/**
 * Probe whether the configured search backend is reachable.
 */
export async function searchHealth(configUrl?: string): Promise<{
  ok: boolean;
  configured: boolean;
  detail?: string;
}> {
  const baseUrl = resolveSearchUrl(configUrl);
  if (!baseUrl) {
    return {
      ok: false,
      configured: false,
      detail: "Web search is not configured. Set searchUrl in Settings or PAI_SEARCH_URL.",
    };
  }

  const root = baseUrl.replace(/\/+$/, "");
  try {
    const healthz = await fetch(`${root}/healthz`, { signal: AbortSignal.timeout(5_000) });
    if (healthz.ok) return { ok: true, configured: true };

    // Some SearXNG builds lack /healthz — fall back to an empty search.
    const probe = await fetch(`${root}/search?q=pai-health&format=json`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
    });
    if (probe.ok) return { ok: true, configured: true };
    return {
      ok: false,
      configured: true,
      detail: `Search backend returned HTTP ${probe.status}`,
    };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Fetches search results from a SearXNG instance.
 * Returns up to `maxResults` results (default 5).
 * When a narrow time_range (especially `day`) returns nothing — common for news engines —
 * widens to week / unfiltered so the tool does not silently return empty.
 */
export async function webSearch(
  query: string,
  maxResults = 5,
  category: SearchCategory = "general",
  configUrl?: string,
  timeRange: TimeRange = "",
): Promise<SearchResult[]> {
  const baseUrl = resolveSearchUrl(configUrl);
  if (!baseUrl) {
    throw new Error(
      "Web search is not configured. Set searchUrl in Settings or PAI_SEARCH_URL (e.g. http://searxng:8080).",
    );
  }
  const ranges: TimeRange[] = [timeRange, ...(timeRange ? TIME_RANGE_FALLBACKS[timeRange] : [])];

  let results: Array<{ title?: string; url?: string; content?: string; thumbnail?: string; img_src?: string }> = [];
  for (const range of ranges) {
    results = await fetchSearxResults(baseUrl, query, category, range);
    if (results.length > 0) break;
  }

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

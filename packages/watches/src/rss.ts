/**
 * RSS route resolver — maps Watch goals to known RSSHub routes.
 * Also provides pre-fetch capability for the research pipeline.
 */

interface RssRouteMatch {
  route: string;
  filter?: string;
  label: string;
}

const ROUTE_PATTERNS: Array<{
  match: RegExp;
  build: (m: RegExpMatchArray, goal: string) => RssRouteMatch;
}> = [
  {
    match: /github\s+trending|trending\s+(repos?|repositories)/i,
    build: (_m, goal) => {
      const langMatch = goal.match(/\b(javascript|typescript|python|rust|go|java|ruby|c\+\+|swift|kotlin)\b/i);
      const lang = langMatch ? langMatch[1]!.toLowerCase() : "any";
      return { route: `/github/trending/daily/${lang}`, label: "GitHub Trending" };
    },
  },
  {
    match: /hacker\s*news|hn\b/i,
    build: () => ({ route: "/hackernews", label: "Hacker News" }),
  },
  {
    match: /product\s*hunt/i,
    build: () => ({ route: "/producthunt/today", label: "Product Hunt" }),
  },
  {
    match: /reddit\s+r\/(\w+)|r\/(\w+)/i,
    build: (m) => {
      const sub = m[1] || m[2] || "technology";
      return { route: `/reddit/subreddit/${sub}`, label: `r/${sub}` };
    },
  },
  {
    match: /techcrunch/i,
    build: () => ({ route: "/techcrunch/news", label: "TechCrunch" }),
  },
  {
    match: /the\s*verge/i,
    build: (_m, goal) => {
      const hubMatch = goal.match(/\b(ai|apple|android|gaming|policy|web|microsoft)\b/i);
      return { route: `/theverge${hubMatch ? `/${hubMatch[1]!.toLowerCase()}` : ""}`, label: "The Verge" };
    },
  },
  {
    match: /youtube\s+@?(\w+)/i,
    build: (m) => ({ route: `/youtube/user/@${m[1]}`, label: `YouTube @${m[1]}` }),
  },
  {
    match: /cointelegraph|crypto\s+news/i,
    build: () => ({ route: "/cointelegraph", label: "Cointelegraph" }),
  },
  {
    match: /npm\s+(package|updates?)\s+(\S+)/i,
    build: (m) => ({ route: `/npm/package/${m[2]}`, label: `npm ${m[2]}` }),
  },
];

/**
 * Try to match a Watch goal to a known RSSHub route.
 * Returns null if no route matches — the research agent should use web search.
 */
export function resolveRssRoute(goal: string): RssRouteMatch | null {
  for (const pattern of ROUTE_PATTERNS) {
    const m = goal.match(pattern.match);
    if (m) {
      const result = pattern.build(m, goal);
      // Extract topic keywords for filtering (words after common prepositions/verbs)
      const topicMatch = goal.match(/(?:about|on|for|related to|involving)\s+(.+?)(?:\.|$)/i);
      if (topicMatch && !result.filter) {
        const keywords = topicMatch[1]!.split(/\s+/).filter(w => w.length > 2).slice(0, 3);
        if (keywords.length > 0) result.filter = keywords.join("|");
      }
      return result;
    }
  }
  return null;
}

export interface RssFeedItem {
  title: string;
  url: string;
  content: string;
  date: string;
  tags: string[];
}

/**
 * Fetch an RSS feed and return parsed items.
 * Returns null if the feed is unavailable or empty.
 */
export async function fetchRssFeed(
  rsshubUrl: string,
  route: string,
  options?: { filter?: string; limit?: number },
): Promise<RssFeedItem[] | null> {
  const params = new URLSearchParams({
    format: "json",
    limit: String(options?.limit ?? 15),
    brief: "300",
  });
  if (options?.filter) params.set("filter", options.filter);

  const url = `${rsshubUrl}${route}?${params.toString()}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;

    const data = await res.json() as { items?: Array<Record<string, unknown>> };
    if (!data.items?.length) return null;

    return data.items.map((item) => ({
      title: (item.title as string) || "Untitled",
      url: (item.url as string) || "",
      content: ((item.content_text as string) || "").slice(0, 300),
      date: (item.date_published as string) || "",
      tags: (item.tags as string[]) || [],
    }));
  } catch {
    return null; // Feed unavailable — fall back to web search
  }
}

/**
 * Format feed items as context to prepend to the research goal.
 * This gives the research agent structured data to summarize instead of searching blindly.
 */
export function formatFeedContext(items: RssFeedItem[], label: string): string {
  const lines = items.map((item, i) =>
    `${i + 1}. ${item.title}${item.url ? ` — ${item.url}` : ""}${item.date ? ` (${item.date})` : ""}${item.content ? `\n   ${item.content}` : ""}`
  ).join("\n");

  return `\n\nSTRUCTURED DATA FROM ${label.toUpperCase()} (use this as primary source — summarize and analyze, don't repeat raw):\n${lines}\n`;
}

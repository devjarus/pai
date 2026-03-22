export type ResearchSourceQuality = "primary" | "high" | "medium" | "low";

export interface ResearchSourceLike {
  url: string;
  title?: string;
  quality?: ResearchSourceQuality;
  authorityScore?: number;
}

export interface ResearchSourceAssessment {
  quality: ResearchSourceQuality;
  authorityScore: number;
  hostname: string | null;
}

export interface ResearchSourceSummary {
  totalSources: number;
  distinctUrls: number;
  distinctDomains: number;
  primarySources: number;
  authoritativeSources: number;
  lowQualitySources: number;
  averageAuthority: number;
  topQuality: ResearchSourceQuality;
}

const QUALITY_SCORE: Record<ResearchSourceQuality, number> = {
  primary: 0.95,
  high: 0.82,
  medium: 0.65,
  low: 0.4,
};

const QUALITY_RANK: Record<ResearchSourceQuality, number> = {
  low: 0,
  medium: 1,
  high: 2,
  primary: 3,
};

const LOW_QUALITY_HOSTS = new Set([
  "reddit.com",
  "news.ycombinator.com",
  "producthunt.com",
  "medium.com",
  "substack.com",
  "x.com",
  "twitter.com",
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "tiktok.com",
  "youtube.com",
]);

const HIGH_QUALITY_HOSTS = new Set([
  "reuters.com",
  "apnews.com",
  "bloomberg.com",
  "ft.com",
  "wsj.com",
  "nytimes.com",
  "axios.com",
  "arstechnica.com",
  "theverge.com",
  "techcrunch.com",
  "nature.com",
  "science.org",
  "arxiv.org",
  "npmjs.com",
  "pypi.org",
]);

function clampAuthority(value: number): number {
  if (!Number.isFinite(value)) return QUALITY_SCORE.low;
  return Math.max(QUALITY_SCORE.low, Math.min(QUALITY_SCORE.primary, Math.round(value * 100) / 100));
}

function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

function hostMatches(hostname: string, set: Set<string>): boolean {
  if (set.has(hostname)) return true;
  for (const item of set) {
    if (hostname.endsWith(`.${item}`)) return true;
  }
  return false;
}

function downgrade(quality: ResearchSourceQuality): ResearchSourceQuality {
  if (quality === "primary") return "high";
  if (quality === "high") return "medium";
  return "low";
}

function upgrade(quality: ResearchSourceQuality): ResearchSourceQuality {
  if (quality === "low") return "medium";
  if (quality === "medium") return "high";
  return "primary";
}

export function normalizeResearchSourceUrl(url: string): string | null {
  const trimmed = url.trim().replace(/[),.;]+$/g, "");
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function assessSourceQualityFromParsed(url: URL, title?: string): ResearchSourceAssessment {
  const hostname = normalizeHost(url.hostname);
  const path = url.pathname.toLowerCase();
  const titleLower = title?.toLowerCase() ?? "";
  const segments = path.split("/").filter(Boolean);

  let quality: ResearchSourceQuality = "medium";

  if (/\.(gov|mil)$/.test(hostname)) {
    quality = "primary";
  } else if (/\.(edu)$/.test(hostname)) {
    quality = "high";
  } else if (/^(docs|developer|developers|support|help|api|learn|investor|investors|ir|newsroom)\./.test(hostname)) {
    quality = "primary";
  } else if (hostname === "github.com") {
    quality =
      segments.length >= 2 && !["trending", "search", "topics", "marketplace"].includes(segments[0] ?? "")
        ? "primary"
        : "medium";
  } else if (hostMatches(hostname, LOW_QUALITY_HOSTS)) {
    quality = "low";
  } else if (hostMatches(hostname, HIGH_QUALITY_HOSTS)) {
    quality = "high";
  }

  if (/(official|documentation|api reference|release notes|press release|earnings|investor relations|sec filing)/i.test(titleLower)) {
    quality = upgrade(quality);
  }

  if (/(forum|discussion|thread|community|comment|opinion|rumor|social post|show hn|launch hn)/i.test(titleLower)) {
    quality = downgrade(quality);
  }

  if (hostname === "news.google.com" || hostname === "google.com" || hostname === "finance.yahoo.com") {
    quality = quality === "primary" ? "high" : "medium";
  }

  return {
    quality,
    authorityScore: QUALITY_SCORE[quality],
    hostname,
  };
}

export function assessResearchSource(url: string, title?: string): ResearchSourceAssessment {
  const normalizedUrl = normalizeResearchSourceUrl(url);
  if (!normalizedUrl) {
    return {
      quality: "low",
      authorityScore: QUALITY_SCORE.low,
      hostname: null,
    };
  }
  return assessSourceQualityFromParsed(new URL(normalizedUrl), title);
}

export function enrichResearchSource<T extends ResearchSourceLike>(
  source: T,
): T & { quality: ResearchSourceQuality; authorityScore: number } {
  const assessment = assessResearchSource(source.url, source.title);
  const quality = source.quality ?? assessment.quality;
  const authorityScore = clampAuthority(source.authorityScore ?? QUALITY_SCORE[quality]);
  return {
    ...source,
    quality,
    authorityScore,
  };
}

export function summarizeResearchSources(sources: ResearchSourceLike[]): ResearchSourceSummary {
  const normalized = sources.map((source) => {
    const enriched = enrichResearchSource(source);
    return {
      ...enriched,
      normalizedUrl: normalizeResearchSourceUrl(enriched.url),
      hostname: assessResearchSource(enriched.url, enriched.title).hostname,
    };
  });

  const distinctUrls = new Set(
    normalized
      .map((source) => source.normalizedUrl)
      .filter((url): url is string => !!url),
  );
  const distinctDomains = new Set(
    normalized
      .map((source) => source.hostname)
      .filter((hostname): hostname is string => !!hostname),
  );
  const primarySources = normalized.filter((source) => source.quality === "primary").length;
  const authoritativeSources = normalized.filter((source) => source.quality === "primary" || source.quality === "high").length;
  const lowQualitySources = normalized.filter((source) => source.quality === "low").length;
  const averageAuthority = normalized.length > 0
    ? clampAuthority(normalized.reduce((sum, source) => sum + source.authorityScore, 0) / normalized.length)
    : 0;

  let topQuality: ResearchSourceQuality = "low";
  for (const source of normalized) {
    if (QUALITY_RANK[source.quality] > QUALITY_RANK[topQuality]) {
      topQuality = source.quality;
    }
  }

  return {
    totalSources: normalized.length,
    distinctUrls: distinctUrls.size,
    distinctDomains: distinctDomains.size,
    primarySources,
    authoritativeSources,
    lowQualitySources,
    averageAuthority,
    topQuality,
  };
}

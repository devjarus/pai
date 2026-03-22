import { describe, expect, it } from "vitest";
import { assessResearchSource, summarizeResearchSources } from "../src/source-quality.js";

describe("source quality", () => {
  it("classifies official and authoritative sources above community aggregators", () => {
    expect(assessResearchSource("https://www.sec.gov/ixviewer/ix.html", "SEC filing").quality).toBe("primary");
    expect(assessResearchSource("https://docs.anthropic.com/en/docs/overview", "Documentation").quality).toBe("primary");
    expect(assessResearchSource("https://www.reuters.com/technology/example", "Reuters").quality).toBe("high");
    expect(assessResearchSource("https://news.ycombinator.com/item?id=1", "Show HN discussion").quality).toBe("low");
    expect(assessResearchSource("https://www.reddit.com/r/LocalLLaMA/comments/example", "Community thread").quality).toBe("low");
  });

  it("summarizes authoritative and primary source coverage", () => {
    const summary = summarizeResearchSources([
      { url: "https://www.sec.gov/ixviewer/ix.html", title: "SEC filing" },
      { url: "https://www.reuters.com/technology/example", title: "Reuters" },
      { url: "https://www.reddit.com/r/LocalLLaMA/comments/example", title: "Community thread" },
    ]);

    expect(summary.totalSources).toBe(3);
    expect(summary.primarySources).toBe(1);
    expect(summary.authoritativeSources).toBe(2);
    expect(summary.lowQualitySources).toBe(1);
    expect(summary.topQuality).toBe("primary");
    expect(summary.averageAuthority).toBeGreaterThan(0.7);
  });
});

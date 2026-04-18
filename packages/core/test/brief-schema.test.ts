import { describe, expect, it } from "vitest";

import { buildBriefSignalHash, buildReportBriefSection, isBriefContentLine, stripEnrichmentFromGoal } from "../src/brief-schema.js";

describe("stripEnrichmentFromGoal", () => {
  it("returns the original goal when no enrichment is present", () => {
    expect(stripEnrichmentFromGoal("Track weekly tech news")).toBe("Track weekly tech news");
  });

  it("strips old-style enrichment instructions", () => {
    const enriched =
      "Track weekly tech news\n\n" +
      "IMPORTANT — PREVIOUS FINDINGS (do NOT repeat these):\n" +
      "No new slots available.\n\n" +
      "Focus ONLY on what is NEW or CHANGED since 2026-03-14.";
    expect(stripEnrichmentFromGoal(enriched)).toBe("Track weekly tech news");
  });

  it("strips new-style enrichment instructions appended by buildEnrichedResearchGoal", () => {
    const enriched =
      "Track weekly tech news\n\n" +
      "CONTEXT — WHAT WAS ALREADY COVERED (use as baseline, not as your report):\n" +
      "No new slots available.\n\n" +
      "Your job since 2026-03-14: find FRESH information the previous report missed.";
    expect(stripEnrichmentFromGoal(enriched)).toBe("Track weekly tech news");
  });
});

describe("brief-schema", () => {
  it("prefers a structured recommendation and carries program context into the brief", () => {
    const section = buildReportBriefSection({
      goal: "Track Atlas launch readiness",
      execution: "analysis",
      resultType: "risk",
      report: "# Heading\nFallback line\n| ignored | row |",
      structuredResult: JSON.stringify({
        recommendation: "Hold launch until rollback verification clears.",
      }),
      renderSpec: "{\"kind\":\"report\"}",
      visuals: [{ id: "visual-1", type: "stat", title: "Risk" }],
      program: {
        title: "Atlas watch",
        question: "Keep watching Atlas launch readiness",
        objective: "Only alert on launch blockers that require operator action.",
        preferences: ["Lead with blockers", "Keep updates concise"],
        constraints: ["Avoid noisy changes", "Focus on launch readiness only"],
      },
      actionSummary: {
        openCount: 2,
        completedCount: 1,
        staleOpenCount: 0,
      },
    });

    // Title derived from report heading when available
    expect(section.title).toBe("Heading");
    expect(section.recommendation).toEqual({
      summary: "Hold launch until rollback verification clears.",
      confidence: "high",
      rationale: "Hold launch until rollback verification clears.",
    });
    // what_changed uses first meaningful line from report
    expect(section.what_changed[0]).toBe("Fallback line");
    expect(section.what_changed).toContain("2 linked actions remain open.");
    expect(section.evidence).toEqual([
      {
        title: "Latest analysis run",
        detail: "Structured result recommends: Hold launch until rollback verification clears.",
        sourceLabel: "Program analysis",
        freshness: "Latest completed run",
      },
      {
        title: "Result type",
        detail: "risk",
        sourceLabel: "Execution metadata",
        freshness: "Current run metadata",
      },
    ]);
    expect(section.memory_assumptions).toEqual([
      {
        statement: "Only alert on launch blockers that require operator action.",
        confidence: "high",
        provenance: "Program objective",
      },
      {
        statement: "Lead with blockers",
        confidence: "high",
        provenance: "Program preference",
      },
      {
        statement: "Keep updates concise",
        confidence: "high",
        provenance: "Program preference",
      },
      {
        statement: "Avoid noisy changes",
        confidence: "high",
        provenance: "Program constraint",
      },
      {
        statement: "Focus on launch readiness only",
        confidence: "high",
        provenance: "Program constraint",
      },
    ]);
    expect(section.next_actions).toEqual([{
      title: "Review the latest brief appendix",
      timing: "Now",
      detail: "Open the appendix for the full analysis output, visuals, and structured result.",
    }]);
    expect(section.correction_hook.prompt).toContain("correct it");
    expect(section.appendix).toEqual({
      goal: "Track Atlas launch readiness",
      report: "# Heading\nFallback line\n| ignored | row |",
      execution: "analysis",
      resultType: "risk",
      structuredResult: JSON.stringify({
        recommendation: "Hold launch until rollback verification clears.",
      }),
      renderSpec: "{\"kind\":\"report\"}",
      visuals: [{ id: "visual-1", type: "stat", title: "Risk" }],
    });
  });

  it("falls back to report content and stale linked action guidance when no structured recommendation exists", () => {
    const section = buildReportBriefSection({
      goal: "Monitor ticket prices",
      execution: "research",
      report: "# Heading\n\nTrack this outbound fare before inventory tightens.\n| ignored | row |",
      structuredResult: "{not-json",
      actionSummary: {
        openCount: 1,
        completedCount: 0,
        staleOpenCount: 2,
      },
    });

    // Title from report heading
    expect(section.title).toBe("Heading");
    expect(section.recommendation).toEqual({
      summary: "Resolve the stale linked action before changing the recommendation for Heading.",
      confidence: "high",
      rationale: "2 linked actions are stale, so follow-through should be closed before broadening the watch.",
    });
    expect(section.evidence).toEqual([
      {
        title: "Latest research run",
        detail: "Track this outbound fare before inventory tightens.",
        sourceLabel: "Program research",
        freshness: "Latest completed run",
      },
      {
        title: "Stale linked action",
        detail: "2 linked actions are stale or overdue.",
        sourceLabel: "Program actions",
        freshness: "Requires attention",
      },
    ]);
    expect(section.next_actions).toEqual([{
      title: "Close or reprioritize stale action",
      timing: "Now",
      detail: "Resolve the overdue linked action before changing the watch scope or recommendation.",
    }]);
  });

  it("strips enrichment instructions from goal so they do not leak into briefs", () => {
    const enrichedGoal =
      "Track weekly tech news\n\n" +
      "IMPORTANT — PREVIOUS FINDINGS (do NOT repeat these):\n" +
      "No new slots available.\n\n" +
      "Focus ONLY on what is NEW or CHANGED since 2026-03-14. " +
      "If nothing meaningful changed, say so in one sentence instead of restating old findings.";

    const section = buildReportBriefSection({
      goal: enrichedGoal,
      execution: "research",
      report: "No meaningful changes have been reported.",
    });

    // Title derived from report content, goal stripped of enrichment
    expect(section.title).toBe("No meaningful changes have been reported");
    expect(section.goal).toBe("Track weekly tech news");
    expect(section.appendix?.goal).toBe("Track weekly tech news");
    expect(section.recommendation.rationale).not.toContain("PREVIOUS FINDINGS");
    expect(section.what_changed[0]).not.toContain("PREVIOUS FINDINGS");
  });

  it("builds stable signal hashes from normalized brief fields", () => {
    const base = buildReportBriefSection({
      goal: "Track Atlas launch readiness",
      execution: "analysis",
      report: "Check the rollback blocker.",
    });

    const sameHash = buildBriefSignalHash(base, { source: "analysis" });
    const sameHashAgain = buildBriefSignalHash(
      {
        recommendation: { ...base.recommendation },
        what_changed: [...base.what_changed],
        evidence: [...base.evidence],
        memory_assumptions: [...base.memory_assumptions],
        next_actions: [...base.next_actions],
      },
      { source: "analysis" },
    );
    const changedHash = buildBriefSignalHash(base, { source: "research" });

    expect(sameHash).toHaveLength(64);
    expect(sameHashAgain).toBe(sameHash);
    expect(changedHash).not.toBe(sameHash);
  });

  it("filters meta placeholder lines so recommendation/changes use real content", () => {
    const section = buildReportBriefSection({
      goal: "Track daily AI news",
      execution: "research",
      report: [
        "# Daily news",
        "Let me compile the top 5 stories for you.",
        "OpenAI released a new safety eval benchmark with reproducible scoring.",
      ].join("\n"),
      structuredResult: JSON.stringify({
        recommendation: "I need explicit direction before I proceed.",
      }),
    });

    expect(isBriefContentLine("Let me compile the top 5 stories for you.")).toBe(false);
    expect(section.recommendation.summary).toBe("OpenAI released a new safety eval benchmark with reproducible scoring.");
    expect(section.what_changed[0]).toBe("OpenAI released a new safety eval benchmark with reproducible scoring.");
  });

  it("filters truncation-diagnosis meta lines from report-first recommendations", () => {
    const section = buildReportBriefSection({
      goal: "Track daily AI news",
      execution: "research",
      report: [
        "# Daily Digest",
        "Research Data Exists — Output Truncation Blocks Delivery",
        "Pull raw research logs from today's runs immediately — output truncation prevents delivery.",
        "OpenAI released a new model card update with expanded red-team disclosures.",
      ].join("\n"),
    });

    expect(isBriefContentLine("Research Data Exists — Output Truncation Blocks Delivery")).toBe(false);
    expect(isBriefContentLine("Pull raw research logs from today's runs immediately — output truncation prevents delivery.")).toBe(false);
    expect(section.recommendation.summary).toBe("OpenAI released a new model card update with expanded red-team disclosures.");
    expect(section.what_changed[0]).toBe("OpenAI released a new model card update with expanded red-team disclosures.");
  });
});

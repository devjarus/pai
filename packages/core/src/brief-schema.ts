import { createHash } from "node:crypto";

import type { ReportExecution, ReportVisual } from "./report-presentation.js";

export interface StandardBriefSection {
  title?: string;
  recommendation: {
    summary: string;
    confidence: "low" | "medium" | "high";
    rationale: string;
  };
  what_changed: string[];
  evidence: Array<{
    title: string;
    detail: string;
    sourceLabel: string;
    sourceUrl?: string;
    freshness?: string;
  }>;
  memory_assumptions: Array<{
    statement: string;
    confidence: "low" | "medium" | "high";
    provenance: string;
  }>;
  next_actions: Array<{
    title: string;
    timing: string;
    detail: string;
    owner?: string;
  }>;
  correction_hook: {
    prompt: string;
  };
  appendix?: Record<string, unknown>;
  goal?: string;
  report?: string;
  execution?: ReportExecution;
  resultType?: string;
  structuredResult?: string;
  renderSpec?: string;
  visuals?: ReportVisual[];
}

interface ReportBriefProgramInput {
  title: string;
  question: string;
  objective?: string | null;
  preferences?: string[];
  constraints?: string[];
}

interface ReportBriefActionSummaryInput {
  openCount: number;
  completedCount: number;
  staleOpenCount: number;
}

interface BuildReportBriefSectionInput {
  goal: string;
  execution: ReportExecution;
  resultType?: string | null;
  report: string;
  structuredResult?: string | null;
  renderSpec?: string | null;
  visuals?: ReportVisual[] | null;
  program?: ReportBriefProgramInput | null;
  actionSummary?: ReportBriefActionSummaryInput | null;
}

/**
 * Strip LLM enrichment instructions that buildEnrichedResearchGoal appends.
 * These are internal prompts that should never appear in user-facing briefs.
 */
export function stripEnrichmentFromGoal(goal: string): string {
  // Match both old and new enrichment markers
  const markers = ["\n\nCONTEXT — WHAT WAS ALREADY COVERED", "\n\nIMPORTANT — PREVIOUS FINDINGS"];
  for (const marker of markers) {
    const idx = goal.indexOf(marker);
    if (idx !== -1) return goal.slice(0, idx).trim();
  }
  return goal;
}

function firstMeaningfulLine(report: string): string | null {
  return report
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("#") && !line.startsWith("|") && !line.startsWith(">"))
    ?? null;
}

/** Extract a short title from the report — first markdown heading or first sentence */
function extractReportTitle(report: string, maxLen = 50): string | null {
  // Try first markdown heading
  const headingMatch = report.match(/^#{1,3}\s+(.+)/m);
  if (headingMatch) {
    const heading = headingMatch[1]!.replace(/\*+/g, "").trim();
    if (heading.length > 5 && heading.length <= maxLen) return heading;
    if (heading.length > maxLen) return heading.slice(0, maxLen - 3) + "...";
  }
  // Try first sentence of first meaningful line
  const line = firstMeaningfulLine(report);
  if (line) {
    const sentence = line.split(/[.!?]/)[0]!.trim();
    if (sentence.length > 5 && sentence.length <= maxLen) return sentence;
    if (sentence.length > maxLen) return sentence.slice(0, maxLen - 3) + "...";
  }
  return null;
}

function parseStructuredResult(raw?: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function structuredRecommendation(parsed: Record<string, unknown> | null): string | null {
  if (!parsed) return null;
  const candidates = [
    parsed.recommendation,
    parsed.recommended,
    parsed.winner,
    parsed.verdict,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
}

export function buildReportBriefSection(input: BuildReportBriefSectionInput): StandardBriefSection {
  // Strip any LLM enrichment instructions from the goal so they don't
  // leak into user-visible brief fields (Telegram, PDF, etc.).
  const cleanGoal = stripEnrichmentFromGoal(input.goal);
  const structured = parseStructuredResult(input.structuredResult);
  const recommendationSummary = structuredRecommendation(structured)
    ?? firstMeaningfulLine(input.report)
    ?? `Review the latest ${input.execution === "analysis" ? "analysis" : "research"} for ${cleanGoal}.`;
  const actionSummary = input.actionSummary;
  const staleFollowThrough = actionSummary && actionSummary.staleOpenCount > 0;

  const memoryAssumptions = [
    ...(input.program?.objective
      ? [{
        statement: input.program.objective,
        confidence: "high" as const,
        provenance: "Program objective",
      }]
      : []),
    ...(input.program?.preferences?.slice(0, 2).map((preference) => ({
      statement: preference,
      confidence: "high" as const,
      provenance: "Program preference",
    })) ?? []),
    ...(input.program?.constraints?.slice(0, 2).map((constraint) => ({
      statement: constraint,
      confidence: "high" as const,
      provenance: "Program constraint",
    })) ?? []),
  ];

  const evidence: StandardBriefSection["evidence"] = [
    {
      title: input.execution === "analysis" ? "Latest analysis run" : "Latest research run",
      detail: structuredRecommendation(structured)
        ? `Structured result recommends: ${structuredRecommendation(structured)}`
        : recommendationSummary,
      sourceLabel: input.execution === "analysis" ? "Program analysis" : "Program research",
      freshness: "Latest completed run",
    },
  ];

  if (input.resultType) {
    evidence.push({
      title: "Result type",
      detail: input.resultType,
      sourceLabel: "Execution metadata",
      freshness: "Current run metadata",
    });
  }

  if (staleFollowThrough) {
    evidence.push({
      title: "Stale linked action",
      detail: `${actionSummary.staleOpenCount} linked action${actionSummary.staleOpenCount === 1 ? "" : "s"} are stale or overdue.`,
      sourceLabel: "Program actions",
      freshness: "Requires attention",
    });
  }

  // Derive a clean title from the report content, falling back to program title or goal
  const reportTitle = extractReportTitle(input.report);
  const briefTitle = reportTitle ?? input.program?.title ?? cleanGoal;

  return {
    title: briefTitle,
    recommendation: {
      summary: staleFollowThrough
        ? `Resolve the stale linked action before changing the recommendation for ${briefTitle}.`
        : recommendationSummary,
      confidence: staleFollowThrough ? "high" : structuredRecommendation(structured) ? "high" : "medium",
      rationale: staleFollowThrough
        ? `${actionSummary!.staleOpenCount} linked action${actionSummary!.staleOpenCount === 1 ? "" : "s"} are stale, so follow-through should be closed before broadening the watch.`
        : recommendationSummary, // Use the actual recommendation as rationale, not a meta-description
    },
    what_changed: [
      // Use first meaningful line from report as the change signal, not "A new research run completed"
      firstMeaningfulLine(input.report) ?? `New ${input.execution === "analysis" ? "analysis" : "research"} completed.`,
      ...(actionSummary && actionSummary.openCount > 0
        ? [`${actionSummary.openCount} linked action${actionSummary.openCount === 1 ? "" : "s"} remain open.`]
        : []),
    ],
    evidence,
    memory_assumptions: memoryAssumptions,
    next_actions: staleFollowThrough
      ? [{
        title: "Close or reprioritize stale action",
        timing: "Now",
        detail: "Resolve the overdue linked action before changing the watch scope or recommendation.",
      }]
      : [{
        title: "Review the latest brief appendix",
        timing: "Now",
        detail: `Open the appendix for the full ${input.execution === "analysis" ? "analysis" : "research"} output, visuals, and structured result.`,
      }],
    correction_hook: {
      prompt: "If this recommendation or one of its assumptions is wrong, correct it so the next brief improves.",
    },
    goal: cleanGoal,
    report: input.report,
    execution: input.execution,
    resultType: input.resultType ?? "general",
    structuredResult: input.structuredResult ?? undefined,
    renderSpec: input.renderSpec ?? undefined,
    visuals: input.visuals ?? [],
    appendix: {
      goal: cleanGoal,
      report: input.report,
      execution: input.execution,
      resultType: input.resultType ?? "general",
      structuredResult: input.structuredResult ?? undefined,
      renderSpec: input.renderSpec ?? undefined,
      visuals: input.visuals ?? [],
    },
  };
}

export function buildBriefSignalHash(
  section: Pick<StandardBriefSection, "recommendation" | "what_changed" | "evidence" | "memory_assumptions" | "next_actions">,
  extra?: Record<string, unknown>,
): string {
  const normalized = {
    recommendation: section.recommendation,
    what_changed: section.what_changed,
    evidence: section.evidence.map((item) => ({
      title: item.title,
      detail: item.detail,
      sourceLabel: item.sourceLabel,
      freshness: item.freshness ?? null,
    })),
    memory_assumptions: section.memory_assumptions.map((item) => ({
      statement: item.statement,
      provenance: item.provenance,
    })),
    next_actions: section.next_actions.map((item) => ({
      title: item.title,
      timing: item.timing,
      detail: item.detail,
    })),
    extra: extra ?? null,
  };
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

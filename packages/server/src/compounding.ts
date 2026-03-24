import type { PluginContext } from "@personal-ai/core";
import { listInsights, createInsight, updateInsight, listFindingsForWatch, summarizeResearchSources } from "@personal-ai/library";
import { listPrograms } from "@personal-ai/plugin-schedules";

export interface CompoundingResult {
  watchesProcessed: number;
  insightsCreated: number;
  insightsUpdated: number;
}

interface SuggestedInsight {
  insight: string;
  confidence?: number;
  isUpdate?: boolean;
  sourceNumbers?: number[];
}

const INSIGHT_STOP_WORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "over",
  "your", "their", "about", "across", "after", "before", "while", "into",
]);

function tokenizeInsight(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !INSIGHT_STOP_WORDS.has(token));
}

function insightSimilarity(left: string, right: string): number {
  const leftTokens = new Set(tokenizeInsight(left));
  const rightTokens = new Set(tokenizeInsight(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;

  let shared = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) shared++;
  }

  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union === 0 ? 0 : shared / union;
}

function findMatchingInsight(
  existingInsights: Array<{ id: string; insight: string; confidence: number; cycleCount: number; sources: string[] }>,
  candidate: string,
): { id: string; insight: string; confidence: number; cycleCount: number; sources: string[] } | undefined {
  let bestMatch:
    | { id: string; insight: string; confidence: number; cycleCount: number; sources: string[] }
    | undefined;
  let bestScore = 0;

  for (const insight of existingInsights) {
    const score = insightSimilarity(insight.insight, candidate);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = insight;
    }
  }

  return bestScore >= 0.55 ? bestMatch : undefined;
}

/**
 * Weekly compounding worker — synthesizes accumulated research findings
 * into durable topic insights for each active watch.
 *
 * Only processes watches with ≥3 completed research cycles.
 * Creates or updates topic_insights that persist as long as the watch is active.
 */
export async function runWeeklyCompounding(
  ctx: PluginContext,
): Promise<CompoundingResult> {
  const programs = listPrograms(ctx.storage, "active");
  let watchesProcessed = 0;
  let insightsCreated = 0;
  let insightsUpdated = 0;

  for (const program of programs) {
    const findings = listFindingsForWatch(ctx.storage, program.id);
    const credibleFindings = findings.filter((finding) => finding.confidence >= 0.55);
    if (credibleFindings.length < 3) continue; // not enough credible cycles

    const existingInsights = listInsights(ctx.storage, program.id);
    const recentFindings = credibleFindings.slice(0, 10);

    const findingSummaries = recentFindings
      .map((f, i) => {
        const deltaTag = f.previousFindingId
          ? `[delta:${(f.delta?.significance ?? 0).toFixed(2)}]`
          : "[delta:new]";
        const sourceSummary = summarizeResearchSources(f.sources);
        return `${i + 1}. [${f.createdAt}] [confidence:${f.confidence.toFixed(2)}] [sources:${sourceSummary.topQuality}] ${deltaTag} ${f.summary.slice(0, 300)}`;
      })
      .join("\n");

    const existingContext = existingInsights.length > 0
      ? `\n\nEXISTING INSIGHTS (update or replace if outdated):\n${existingInsights.map((ins) => `- [confidence: ${ins.confidence.toFixed(1)}, cycles: ${ins.cycleCount}] ${ins.insight}`).join("\n")}`
      : "";

    try {
      const result = await ctx.llm.chat([
        {
          role: "system",
          content:
            "You synthesize accumulated research findings into durable topic insights. " +
            "Each insight should capture a TREND, PATTERN, or KEY FACT about the TOPIC ITSELF — not about the research process. " +
            "NEVER produce insights about search failures, tool limitations, data gaps, or research methodology. " +
            "Only produce insights about what was actually LEARNED about the topic. " +
            "Prefer findings with higher confidence and meaningful delta; ignore low-confidence repeated updates unless they materially change the trend. " +
            "If the research found nothing substantive, return an empty array []. " +
            "If existing insights are provided, update them with new information or replace if outdated. " +
            "Return a JSON array of 2-5 insights. Each insight should be under 40 words. " +
            "Each insight must cite at least 2 numbered findings that support it. " +
            "Reply with ONLY a JSON array: [{\"insight\":\"...\",\"confidence\":0.7-0.95,\"sourceNumbers\":[1,2],\"isUpdate\":false}]",
        },
        {
          role: "user",
          content: `Topic: ${program.title}\nWatch question: ${program.question}\n\nRESEARCH FINDINGS (${recentFindings.length} cycles):\n${findingSummaries}${existingContext}`,
        },
      ], {
        temperature: 0.3,
        telemetry: { process: "compounding.synthesize" },
      });

      let insights: SuggestedInsight[] = [];
      try {
        let jsonText = result.text.trim();
        const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (fenceMatch?.[1]) jsonText = fenceMatch[1].trim();
        insights = JSON.parse(jsonText) as SuggestedInsight[];
        if (!Array.isArray(insights)) insights = [];
      } catch {
        ctx.logger.warn("Compounding: failed to parse LLM response", { watchId: program.id });
        continue;
      }

      const acceptedInsights: string[] = [];

      for (const item of insights.slice(0, 5)) {
        if (!item.insight || item.insight.length < 10) continue;

        // Filter out meta/self-referential insights about the research process
        const isMeta = /\b(search.*(fail|return|cycle|attempt)|tool.*(fail|limit|unavail)|data.*(retriev|limit|gap)|research.*(encounter|fail|cycle|tool)|web.search|fetch_rss|browse_navigate|no results)\b/i.test(item.insight);
        if (isMeta) continue;

        // Quality gate: skip low-confidence insights that are too vague
        if ((item.confidence ?? 0.7) < 0.5) continue;
        if (item.insight.split(/\s+/).length < 5) continue; // too short to be useful
        if (acceptedInsights.some((accepted) => insightSimilarity(accepted, item.insight) >= 0.75)) continue;

        const sourceIds = [...new Set(
          (item.sourceNumbers ?? [])
            .map((sourceNumber) => recentFindings[sourceNumber - 1]?.id)
            .filter((id): id is string => typeof id === "string"),
        )];
        if (sourceIds.length < 2) continue;

        const match = findMatchingInsight(existingInsights, item.insight);

        if (match && item.isUpdate !== false) {
          updateInsight(ctx.storage, match.id, {
            insight: item.insight,
            confidence: Math.min(0.95, (item.confidence ?? match.confidence) + 0.05),
            cycleCount: match.cycleCount + 1,
            sources: [...new Set([...match.sources, ...sourceIds])].slice(-20),
          });
          insightsUpdated++;
        } else {
          createInsight(ctx.storage, {
            watchId: program.id,
            topic: program.title,
            insight: item.insight,
            confidence: item.confidence ?? 0.7,
            sources: sourceIds,
          });
          insightsCreated++;
        }

        acceptedInsights.push(item.insight);
      }

      watchesProcessed++;
      ctx.logger.info("Compounding: processed watch", {
        watchId: program.id,
        title: program.title,
        findings: recentFindings.length,
        created: insightsCreated,
        updated: insightsUpdated,
      });
    } catch (err) {
      ctx.logger.warn("Compounding failed for watch", {
        watchId: program.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { watchesProcessed, insightsCreated, insightsUpdated };
}

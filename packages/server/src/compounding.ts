import type { PluginContext } from "@personal-ai/core";
import { listInsights, createInsight, updateInsight, listFindingsForWatch } from "@personal-ai/library";
import { listPrograms } from "@personal-ai/plugin-schedules";

export interface CompoundingResult {
  watchesProcessed: number;
  insightsCreated: number;
  insightsUpdated: number;
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
    if (findings.length < 3) continue; // not enough cycles

    const existingInsights = listInsights(ctx.storage, program.id);
    const recentFindings = findings.slice(0, 10);

    const findingSummaries = recentFindings
      .map((f, i) => `${i + 1}. [${f.createdAt}] ${f.summary.slice(0, 300)}`)
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
            "If the research found nothing substantive, return an empty array []. " +
            "If existing insights are provided, update them with new information or replace if outdated. " +
            "Return a JSON array of 2-5 insights. Each insight should be under 40 words. " +
            "Reply with ONLY a JSON array: [{\"insight\":\"...\",\"confidence\":0.7-0.95,\"isUpdate\":false}]",
        },
        {
          role: "user",
          content: `Topic: ${program.title}\nWatch question: ${program.question}\n\nRESEARCH FINDINGS (${recentFindings.length} cycles):\n${findingSummaries}${existingContext}`,
        },
      ], {
        temperature: 0.3,
        telemetry: { process: "compounding.synthesize" },
      });

      let insights: Array<{ insight: string; confidence?: number; isUpdate?: boolean }> = [];
      try {
        let jsonText = result.text.trim();
        const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (fenceMatch?.[1]) jsonText = fenceMatch[1].trim();
        insights = JSON.parse(jsonText) as typeof insights;
        if (!Array.isArray(insights)) insights = [];
      } catch {
        ctx.logger.warn("Compounding: failed to parse LLM response", { watchId: program.id });
        continue;
      }

      const findingIds = recentFindings.map((f) => f.id);

      for (const item of insights.slice(0, 5)) {
        if (!item.insight || item.insight.length < 10) continue;

        // Filter out meta/self-referential insights about the research process
        const isMeta = /\b(search.*(fail|return|cycle|attempt)|tool.*(fail|limit|unavail)|data.*(retriev|limit|gap)|research.*(encounter|fail|cycle|tool)|web.search|fetch_rss|browse_navigate|no results)\b/i.test(item.insight);
        if (isMeta) continue;

        // Try to find an existing insight to update
        const match = existingInsights.find((existing) => {
          const overlap = existing.insight.split(/\s+/).filter((w) =>
            item.insight.toLowerCase().includes(w.toLowerCase())
          ).length;
          return overlap >= 3; // rough topic match
        });

        if (match && item.isUpdate !== false) {
          updateInsight(ctx.storage, match.id, {
            insight: item.insight,
            confidence: Math.min(0.95, (item.confidence ?? match.confidence) + 0.05),
            cycleCount: match.cycleCount + 1,
            sources: [...new Set([...match.sources, ...findingIds])].slice(-20),
          });
          insightsUpdated++;
        } else {
          createInsight(ctx.storage, {
            watchId: program.id,
            topic: program.title,
            insight: item.insight,
            confidence: item.confidence ?? 0.7,
            sources: findingIds,
          });
          insightsCreated++;
        }
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

/**
 * Health probe — checks API availability, response times, error rates.
 */
import * as api from "../pai-client.js";
import { addSuggestion } from "../suggestions.js";

export async function run(): Promise<void> {
  console.log("[probe:health] Checking API health...");

  // 1. Health endpoint
  try {
    const h = await api.health();
    if (!h.ok) {
      addSuggestion({
        title: "API health check failing",
        description: `Health endpoint returned ok=false. Provider: ${h.provider}`,
        category: "bug",
        priority: "critical",
        probe: "health",
        evidence: JSON.stringify(h),
        proposedFix: "Check LLM provider connection and config",
      });
    }
    if (h.ms > 5000) {
      addSuggestion({
        title: "Health endpoint slow",
        description: `Health check took ${h.ms}ms (>5s threshold)`,
        category: "performance",
        priority: "high",
        probe: "health",
        evidence: `Response time: ${h.ms}ms`,
      });
    }
    console.log(`  Health: ok=${h.ok} provider=${h.provider} ${h.ms}ms`);
  } catch (err) {
    addSuggestion({
      title: "API unreachable",
      description: `Cannot connect to pai API: ${err instanceof Error ? err.message : String(err)}`,
      category: "bug",
      priority: "critical",
      probe: "health",
      evidence: String(err),
    });
    return;
  }

  // 2. Error rates from observability
  try {
    const { data: overview } = await api.observabilityOverview();
    if (overview.errorCount > 0 && overview.totalSpans > 0) {
      const errorRate = overview.errorCount / overview.totalSpans;
      if (errorRate > 0.1) {
        addSuggestion({
          title: `High error rate: ${(errorRate * 100).toFixed(1)}%`,
          description: `${overview.errorCount} errors out of ${overview.totalSpans} spans`,
          category: "bug",
          priority: "high",
          probe: "health",
          evidence: JSON.stringify(overview.topProcesses?.filter(p => p.errors > 0)),
        });
      }
      console.log(`  Errors: ${overview.errorCount}/${overview.totalSpans} (${(errorRate * 100).toFixed(1)}%)`);
    }
  } catch {
    console.log("  Observability: not available");
  }

  // 3. Recent errors
  try {
    const { data: errors } = await api.recentErrors();
    if (Array.isArray(errors) && errors.length > 0) {
      const grouped = new Map<string, number>();
      for (const e of errors) {
        const key = e.process || "unknown";
        grouped.set(key, (grouped.get(key) || 0) + 1);
      }
      for (const [process, count] of grouped) {
        if (count >= 3) {
          addSuggestion({
            title: `Recurring errors in ${process} (${count}x)`,
            description: `Process "${process}" has ${count} recent errors`,
            category: "bug",
            priority: "high",
            probe: "health",
            evidence: JSON.stringify(errors.filter(e => e.process === process).slice(0, 3)),
          });
        }
      }
      console.log(`  Recent errors: ${errors.length} (${grouped.size} processes)`);
    }
  } catch {
    // skip
  }
}

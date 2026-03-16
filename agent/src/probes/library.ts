/**
 * Library probe — checks knowledge quality, search effectiveness, finding richness.
 */
import * as api from "../pai-client.js";
import { addSuggestion } from "../suggestions.js";

export async function run(): Promise<void> {
  console.log("[probe:library] Checking Library health...");

  // 1. Stats
  try {
    const { data: stats } = await api.libraryStats();
    console.log(`  Stats:`, stats);

    if ((stats.beliefs?.active ?? stats.activeBeliefs ?? 0) === 0) {
      addSuggestion({
        title: "Library has no memories",
        description: "No active beliefs/memories found. The system hasn't learned anything yet.",
        category: "ux",
        priority: "medium",
        probe: "library",
        evidence: JSON.stringify(stats),
        proposedFix: "Consider auto-seeding memories from onboarding or first chat interactions",
      });
    }
  } catch (err) {
    console.log(`  Stats failed: ${err}`);
  }

  // 2. Findings quality
  try {
    const { data } = await api.libraryFindings();
    const findings = Array.isArray(data) ? data : (data.findings || []);
    console.log(`  Findings: ${findings.length}`);

    if (findings.length > 0) {
      // Check for generic summaries
      const genericCount = findings.filter(f =>
        f.summary.startsWith("Based on my research") ||
        f.summary.startsWith("Based on the research") ||
        f.summary.startsWith("I ") ||
        f.summary.startsWith("Here") ||
        f.summary.length < 30
      ).length;

      if (genericCount > findings.length * 0.3) {
        addSuggestion({
          title: `${genericCount}/${findings.length} findings have generic summaries`,
          description: "Research findings start with LLM preamble instead of actual content. Summaries should lead with the finding, not 'Based on my research...'",
          category: "quality",
          priority: "high",
          probe: "library",
          evidence: findings.slice(0, 3).map(f => f.summary.slice(0, 100)).join(" | "),
          proposedFix: "Strip LLM preamble patterns from finding summaries before ingestion",
        });
      }

      // Check for empty sources
      const noSourcesCount = findings.filter(f => !f.sources || f.sources.length === 0).length;
      if (noSourcesCount > findings.length * 0.5) {
        addSuggestion({
          title: `${noSourcesCount}/${findings.length} findings have no sources`,
          description: "Research findings are stored without source URLs. Users can't verify where the information came from.",
          category: "quality",
          priority: "high",
          probe: "library",
          evidence: `${noSourcesCount} findings with empty sources array`,
          proposedFix: "Extract source URLs from brief evidence section during ingestion",
        });
      }

      // Check for hardcoded confidence
      const sameConfidence = findings.filter(f => f.confidence === 0.7).length;
      if (sameConfidence === findings.length && findings.length > 3) {
        addSuggestion({
          title: "All findings have identical confidence (0.7)",
          description: "Confidence is hardcoded instead of derived from research quality. Makes confidence meaningless.",
          category: "quality",
          priority: "medium",
          probe: "library",
          evidence: `${sameConfidence}/${findings.length} findings at exactly 0.7`,
          proposedFix: "Derive confidence from search/page budget usage ratio",
        });
      }

      // Check for duplicate topics without delta
      const goalCounts = new Map<string, number>();
      for (const f of findings) {
        const key = f.domain + ":" + f.summary.slice(0, 50).toLowerCase();
        goalCounts.set(key, (goalCounts.get(key) || 0) + 1);
      }
      const duplicates = [...goalCounts.entries()].filter(([, count]) => count > 2);
      if (duplicates.length > 0) {
        addSuggestion({
          title: `${duplicates.length} topics have repetitive findings`,
          description: "Multiple findings for the same topic with similar content suggest delta detection isn't working.",
          category: "quality",
          priority: "medium",
          probe: "library",
          evidence: duplicates.map(([key, count]) => `${key}: ${count}x`).join(", "),
          proposedFix: "Improve delta context in research goal enrichment",
        });
      }
    }
  } catch (err) {
    console.log(`  Findings check failed: ${err}`);
  }

  // 3. Search effectiveness
  try {
    const testQueries = ["preferences", "recent news", "important"];
    for (const q of testQueries) {
      const { data, ms } = await api.librarySearch(q);
      const results = data.results || [];
      if (ms > 3000) {
        addSuggestion({
          title: `Library search slow for "${q}" (${ms}ms)`,
          description: `Search took ${ms}ms, threshold is 3s`,
          category: "performance",
          priority: "medium",
          probe: "library",
          evidence: `Query: "${q}", ${results.length} results, ${ms}ms`,
        });
      }
    }
  } catch {
    // skip
  }
}

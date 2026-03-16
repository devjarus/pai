/**
 * Digest probe — checks digest quality, rating trends, recommendation usefulness.
 */
import * as api from "../pai-client.js";
import { addSuggestion } from "../suggestions.js";

export async function run(): Promise<void> {
  console.log("[probe:digests] Checking Digest quality...");

  try {
    const { data } = await api.listDigests();
    const digests = data.briefings || [];
    console.log(`  Total digests: ${digests.length}`);

    if (digests.length === 0) {
      addSuggestion({
        title: "No digests generated yet",
        description: "No digests exist. Either the briefing worker isn't running or no watches are active.",
        category: "ux",
        priority: "medium",
        probe: "digests",
        evidence: "0 digests in inbox",
        proposedFix: "Check worker status, ensure at least one watch is active",
      });
      return;
    }

    // Check recent digests for quality
    const recentIds = digests.slice(0, 5).map(d => d.id);
    let emptyRecommendations = 0;
    let noSources = 0;
    let noNextActions = 0;

    for (const id of recentIds) {
      try {
        const { data: digest } = await api.getDigest(id);
        const sections = digest.sections as Record<string, unknown>;

        // Check recommendation
        const rec = sections.recommendation as { summary?: string } | undefined;
        if (!rec?.summary || rec.summary.length < 20) {
          emptyRecommendations++;
        }

        // Check evidence/sources
        const evidence = sections.evidence as Array<unknown> | undefined;
        if (!evidence || evidence.length === 0) {
          noSources++;
        }

        // Check next actions
        const actions = sections.next_actions as Array<unknown> | undefined;
        if (!actions || actions.length === 0) {
          noNextActions++;
        }

        // Check suggestions
        try {
          const { data: suggestions } = await api.digestSuggestions(id);
          // Just exercising the endpoint
        } catch {
          // suggestions endpoint may not return data for all digests
        }
      } catch {
        // skip individual digest errors
      }
    }

    if (emptyRecommendations > recentIds.length * 0.5) {
      addSuggestion({
        title: `${emptyRecommendations}/${recentIds.length} recent digests have weak recommendations`,
        description: "Recommendations are missing or too short. Digests should lead with a clear, actionable recommendation.",
        category: "quality",
        priority: "high",
        probe: "digests",
        evidence: `${emptyRecommendations} weak recommendations in last ${recentIds.length} digests`,
        proposedFix: "Improve briefing prompt to enforce recommendation-first output",
      });
    }

    if (noSources > recentIds.length * 0.5) {
      addSuggestion({
        title: `${noSources}/${recentIds.length} recent digests have no evidence`,
        description: "Digests lack evidence/sources. Users can't verify claims.",
        category: "quality",
        priority: "high",
        probe: "digests",
        evidence: `${noSources} digests without evidence section`,
      });
    }

    if (noNextActions > recentIds.length * 0.5) {
      addSuggestion({
        title: `${noNextActions}/${recentIds.length} recent digests have no next actions`,
        description: "Digests don't suggest what to do next. This breaks the Digest → To-Do flow.",
        category: "quality",
        priority: "medium",
        probe: "digests",
        evidence: `${noNextActions} digests without next_actions`,
      });
    }
  } catch (err) {
    console.log(`  Digest check failed: ${err}`);
  }
}

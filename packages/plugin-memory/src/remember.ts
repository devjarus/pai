import type { LLMClient, Storage } from "@personal-ai/core";
import type { Belief } from "./memory.js";
import { createEpisode, createBelief, searchBeliefs, reinforceBelief, linkBeliefToEpisode, logBeliefChange } from "./memory.js";

export async function extractBelief(llm: LLMClient, text: string): Promise<string> {
  const result = await llm.chat([
    {
      role: "system",
      content:
        "Extract a single, concise belief or lesson from the following observation. " +
        "Reply with ONLY the belief statement, nothing else. Keep it under 20 words.",
    },
    { role: "user", content: text },
  ], { temperature: 0.3 });
  return result.text;
}

export async function checkContradiction(
  llm: LLMClient,
  newStatement: string,
  existingBeliefs: Belief[],
): Promise<string | null> {
  if (existingBeliefs.length === 0) return null;

  const beliefList = existingBeliefs
    .map((b, i) => `${i + 1}. "${b.statement}"`)
    .join("\n");

  const validNumbers = existingBeliefs.map((_, i) => String(i + 1)).join(", ");

  const result = await llm.chat([
    {
      role: "system",
      content:
        "You check for contradictions in a knowledge base. " +
        `Reply with ONLY one of these exact values: ${validNumbers}, or NONE. ` +
        "No other text.",
    },
    {
      role: "user",
      content: `New belief: "${newStatement}"\n\nExisting beliefs:\n${beliefList}\n\nDoes the new belief directly contradict any existing belief? Reply with ONLY the number (${validNumbers}) or NONE.`,
    },
  ], { temperature: 0 });

  const answer = result.text.trim();
  if (answer === "NONE") return null;

  const index = parseInt(answer, 10) - 1;
  if (index >= 0 && index < existingBeliefs.length) {
    return existingBeliefs[index]!.id;
  }
  return null;
}

export async function remember(
  storage: Storage,
  llm: LLMClient,
  text: string,
): Promise<{ episodeId: string; beliefId: string; isReinforcement: boolean }> {
  // 1. Create episode
  const episode = createEpisode(storage, { action: text });

  // 2. Extract belief via LLM
  const statement = await extractBelief(llm, text);

  // 3. Search for similar beliefs
  const existing = searchBeliefs(storage, statement, 3);

  if (existing.length > 0) {
    // 4. Check for contradictions
    const contradictedId = await checkContradiction(llm, statement, existing);

    if (contradictedId) {
      // Invalidate old belief
      storage.run("UPDATE beliefs SET status = 'invalidated', updated_at = datetime('now') WHERE id = ?", [contradictedId]);
      logBeliefChange(storage, {
        beliefId: contradictedId,
        changeType: "contradicted",
        detail: `Contradicted by: "${statement}"`,
        episodeId: episode.id,
      });

      // Create replacement belief
      const belief = createBelief(storage, { statement, confidence: 0.6 });
      linkBeliefToEpisode(storage, belief.id, episode.id);
      logBeliefChange(storage, {
        beliefId: belief.id,
        changeType: "created",
        detail: `Replaced contradicted belief ${contradictedId}`,
        episodeId: episode.id,
      });
      return { episodeId: episode.id, beliefId: belief.id, isReinforcement: false };
    }

    // No contradiction — reinforce closest match
    if (existing[0]!.confidence > 0) {
      reinforceBelief(storage, existing[0]!.id);
      linkBeliefToEpisode(storage, existing[0]!.id, episode.id);
      logBeliefChange(storage, {
        beliefId: existing[0]!.id,
        changeType: "reinforced",
        detail: `Reinforced by: "${text}"`,
        episodeId: episode.id,
      });
      return { episodeId: episode.id, beliefId: existing[0]!.id, isReinforcement: true };
    }
  }

  // 5. No existing beliefs — create new
  const belief = createBelief(storage, { statement, confidence: 0.6 });
  linkBeliefToEpisode(storage, belief.id, episode.id);
  logBeliefChange(storage, {
    beliefId: belief.id,
    changeType: "created",
    detail: `Extracted from: "${text}"`,
    episodeId: episode.id,
  });
  return { episodeId: episode.id, beliefId: belief.id, isReinforcement: false };
}

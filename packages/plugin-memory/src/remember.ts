import type { LLMClient, Storage } from "@personal-ai/core";
import { createEpisode, createBelief, searchBeliefs, reinforceBelief, linkBeliefToEpisode } from "./memory.js";

export async function extractBelief(llm: LLMClient, text: string): Promise<string> {
  return llm.chat([
    {
      role: "system",
      content:
        "Extract a single, concise belief or lesson from the following observation. " +
        "Reply with ONLY the belief statement, nothing else. Keep it under 20 words.",
    },
    { role: "user", content: text },
  ], { temperature: 0.3 });
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

  // 3. Check for existing similar belief
  const existing = searchBeliefs(storage, statement, 1);
  if (existing.length > 0 && existing[0]!.confidence > 0) {
    // Reinforce existing belief
    reinforceBelief(storage, existing[0]!.id);
    linkBeliefToEpisode(storage, existing[0]!.id, episode.id);
    return { episodeId: episode.id, beliefId: existing[0]!.id, isReinforcement: true };
  }

  // 4. Create new belief
  const belief = createBelief(storage, { statement, confidence: 0.6 });
  linkBeliefToEpisode(storage, belief.id, episode.id);
  return { episodeId: episode.id, beliefId: belief.id, isReinforcement: false };
}

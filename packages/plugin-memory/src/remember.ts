import type { LLMClient, Storage, Logger } from "@personal-ai/core";
import type { Belief } from "./memory.js";
import { createEpisode, createBelief, findSimilarBeliefs, storeEmbedding, storeEpisodeEmbedding, reinforceBelief, linkBeliefToEpisode, logBeliefChange } from "./memory.js";

export async function extractBeliefs(
  llm: LLMClient,
  text: string,
): Promise<{ fact: string; insight: string | null }> {
  const result = await llm.chat([
    {
      role: "system",
      content:
        'Extract a personal fact and an optional generalized insight from the observation. ' +
        'The fact should preserve what the user said/experienced. The insight (if any) should be a broader lesson. ' +
        'Reply with JSON only: {"fact":"...","insight":"..."} or {"fact":"...","insight":null} if no broader lesson applies. ' +
        'Keep each under 20 words.',
    },
    { role: "user", content: text },
  ], { temperature: 0.3 });

  try {
    const parsed = JSON.parse(result.text);
    return { fact: parsed.fact, insight: parsed.insight ?? null };
  } catch {
    return { fact: result.text.trim(), insight: null };
  }
}

export async function checkContradiction(
  llm: LLMClient,
  newStatement: string,
  existingBeliefs: Belief[],
  logger?: Logger,
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
        "You detect DIRECT contradictions in a knowledge base. " +
        "A contradiction means BOTH statements CANNOT be true at the same time. " +
        "Two statements about different topics, or one adding detail to another, are NOT contradictions. " +
        `Reply with ONLY one of: ${validNumbers}, or NONE. No other text.`,
    },
    {
      role: "user",
      content: `New belief: "${newStatement}"\n\nExisting beliefs:\n${beliefList}\n\nDo any existing beliefs DIRECTLY contradict the new belief (cannot both be true)? Reply ONLY: ${validNumbers} or NONE.`,
    },
  ], { temperature: 0 });

  const answer = result.text.trim();
  logger?.debug("Contradiction check result", { answer, beliefCount: existingBeliefs.length });

  if (answer === "NONE") return null;

  const index = parseInt(answer, 10) - 1;
  if (index >= 0 && index < existingBeliefs.length) {
    logger?.info("Contradiction detected", { contradictedId: existingBeliefs[index]!.id, answer });
    return existingBeliefs[index]!.id;
  }
  logger?.warn("LLM returned invalid contradiction index", { answer, validRange: `1-${existingBeliefs.length}` });
  return null;
}

async function processNewBelief(
  storage: Storage,
  llm: LLMClient,
  statement: string,
  type: string,
  episodeId: string,
  logger?: Logger,
): Promise<{ beliefId: string; isReinforcement: boolean }> {
  const { embedding } = await llm.embed(statement);
  const similar = findSimilarBeliefs(storage, embedding, 5);
  logger?.debug("Semantic search results", { statement, matchCount: similar.length, topSimilarity: similar[0]?.similarity });

  if (similar.length > 0 && similar[0]!.similarity > 0.85) {
    // High similarity — merge (reinforce)
    const match = similar[0]!;
    reinforceBelief(storage, match.beliefId);
    linkBeliefToEpisode(storage, match.beliefId, episodeId);
    logBeliefChange(storage, {
      beliefId: match.beliefId,
      changeType: "reinforced",
      detail: `Merged similar (${match.similarity.toFixed(2)}): "${statement}"`,
      episodeId,
    });
    logger?.info("Belief merged/reinforced", { beliefId: match.beliefId, similarity: match.similarity });
    return { beliefId: match.beliefId, isReinforcement: true };
  }

  if (similar.length > 0 && similar[0]!.similarity > 0.7) {
    // High-medium similarity — check contradiction (0.7-0.85 range)
    const beliefs = similar.map((s) => ({
      id: s.beliefId,
      statement: s.statement,
      confidence: s.confidence,
      status: "active",
      type: "",
      created_at: "",
      updated_at: "",
    }));
    const contradictedId = await checkContradiction(llm, statement, beliefs, logger);

    if (contradictedId) {
      storage.run("UPDATE beliefs SET status = 'invalidated', updated_at = datetime('now') WHERE id = ?", [contradictedId]);
      logBeliefChange(storage, {
        beliefId: contradictedId,
        changeType: "contradicted",
        detail: `Contradicted by: "${statement}"`,
        episodeId,
      });
      const belief = createBelief(storage, { statement, confidence: 0.6, type });
      storeEmbedding(storage, belief.id, embedding);
      linkBeliefToEpisode(storage, belief.id, episodeId);
      logBeliefChange(storage, {
        beliefId: belief.id,
        changeType: "created",
        detail: `Replaced contradicted belief ${contradictedId}`,
        episodeId,
      });
      logger?.info("Belief contradicted and replaced", { oldBeliefId: contradictedId, newBeliefId: belief.id });
      return { beliefId: belief.id, isReinforcement: false };
    }
  }

  // No match or low similarity — create new
  const belief = createBelief(storage, { statement, confidence: 0.6, type });
  storeEmbedding(storage, belief.id, embedding);
  linkBeliefToEpisode(storage, belief.id, episodeId);
  logBeliefChange(storage, {
    beliefId: belief.id,
    changeType: "created",
    detail: `Extracted from: "${statement}"`,
    episodeId,
  });
  logger?.info("New belief created", { beliefId: belief.id, type, statement });
  return { beliefId: belief.id, isReinforcement: false };
}

export async function remember(
  storage: Storage,
  llm: LLMClient,
  text: string,
  logger?: Logger,
): Promise<{ episodeId: string; beliefIds: string[]; isReinforcement: boolean }> {
  const episode = createEpisode(storage, { action: text });

  // Store episode embedding for semantic episode search
  try {
    const { embedding } = await llm.embed(text);
    storeEpisodeEmbedding(storage, episode.id, embedding);
  } catch {
    logger?.warn("Failed to embed episode", { episodeId: episode.id });
  }

  const extracted = await extractBeliefs(llm, text);
  logger?.debug("Extracted beliefs", { input: text, fact: extracted.fact, insight: extracted.insight });

  const beliefIds: string[] = [];
  let isReinforcement = false;

  const factResult = await processNewBelief(storage, llm, extracted.fact, "fact", episode.id, logger);
  beliefIds.push(factResult.beliefId);
  if (factResult.isReinforcement) isReinforcement = true;

  if (extracted.insight) {
    const insightResult = await processNewBelief(storage, llm, extracted.insight, "insight", episode.id, logger);
    beliefIds.push(insightResult.beliefId);
    if (insightResult.isReinforcement) isReinforcement = true;
  }

  return { episodeId: episode.id, beliefIds, isReinforcement };
}

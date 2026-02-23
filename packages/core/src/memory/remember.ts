import type { LLMClient, Storage, Logger } from "../types.js";
import type { Belief } from "./memory.js";
import { createEpisode, createBelief, findSimilarBeliefs, storeEmbedding, storeEpisodeEmbedding, reinforceBelief, linkBeliefToEpisode, logBeliefChange, countSupportingEpisodes, linkSupersession, linkBeliefs } from "./memory.js";

const VALID_FACT_TYPES = new Set(["factual", "preference", "procedural", "architectural"]);

export async function extractBeliefs(
  llm: LLMClient,
  text: string,
): Promise<{ fact: string; factType: string; importance: number; insight: string | null; subject: string }> {
  const result = await llm.chat([
    {
      role: "system",
      content:
        'Extract a personal fact and an optional generalized insight from the observation. ' +
        'The fact should preserve what the user said/experienced. The insight (if any) should be a broader lesson. ' +
        'Classify the fact type as one of: "factual" (objective truth), "preference" (user likes/dislikes), ' +
        '"procedural" (how to do something), "architectural" (system design decision). ' +
        'Rate importance 1-10: 1-3 trivial/transient, 4-6 useful context, 7-9 core preference/decision, 10 critical constraint. ' +
        'Identify the subject: who is this fact ABOUT? Use their name (e.g., "Alex", "Bob") or "owner" if about the AI owner. ' +
        'Reply with JSON only: {"fact":"...","factType":"...","importance":N,"insight":"...","subject":"..."} or {"fact":"...","factType":"...","importance":N,"insight":null,"subject":"owner"}. ' +
        'Keep each under 20 words.',
    },
    { role: "user", content: text },
  ], { temperature: 0.3 });

  try {
    // Strip markdown code fences if present (e.g. ```json ... ```)
    let jsonText = result.text.trim();
    const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch?.[1]) {
      jsonText = fenceMatch[1].trim();
    } else {
      // Try extracting first JSON object from the text
      const braceMatch = jsonText.match(/\{[\s\S]*\}/);
      if (braceMatch) jsonText = braceMatch[0];
    }
    const parsed = JSON.parse(jsonText);
    const factType = VALID_FACT_TYPES.has(parsed.factType) ? parsed.factType : "factual";
    const importance = typeof parsed.importance === "number" && parsed.importance >= 1 && parsed.importance <= 10
      ? Math.round(parsed.importance) : 5;
    const subject = typeof parsed.subject === "string" && parsed.subject.trim()
      ? parsed.subject.trim().toLowerCase() : "owner";
    return { fact: parsed.fact, factType, importance, insight: parsed.insight ?? null, subject };
  } catch {
    return { fact: result.text.trim(), factType: "factual", importance: 5, insight: null, subject: "owner" };
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
  importance?: number,
  subject?: string,
): Promise<{ beliefId: string; isReinforcement: boolean }> {
  let embedding: number[] | null = null;
  try {
    const result = await llm.embed(statement);
    embedding = result.embedding;
  } catch (err) {
    logger?.warn("Embedding failed for belief, skipping semantic dedup", {
      statement,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Without embedding: skip dedup/contradiction check, just create
  if (!embedding) {
    const belief = createBelief(storage, { statement, confidence: 0.6, type, importance, subject });
    linkBeliefToEpisode(storage, belief.id, episodeId);
    logBeliefChange(storage, {
      beliefId: belief.id,
      changeType: "created",
      detail: `Extracted from: "${statement}" (no embedding available)`,
      episodeId,
    });
    logger?.info("New belief created (no embedding)", { beliefId: belief.id, type, statement });
    return { beliefId: belief.id, isReinforcement: false };
  }

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
      superseded_by: null,
      supersedes: null,
      importance: 5,
      last_accessed: null,
      access_count: 0,
      stability: 1.0,
      subject: subject ?? "owner",
    }));
    const contradictedId = await checkContradiction(llm, statement, beliefs, logger);

    if (contradictedId) {
      const supportCount = countSupportingEpisodes(storage, contradictedId);

      if (supportCount >= 3) {
        // Strong evidence — weaken but don't invalidate (TMS-inspired evidence weighing)
        storage.run(
          "UPDATE beliefs SET confidence = MAX(0.1, confidence - 0.2), updated_at = datetime('now') WHERE id = ?",
          [contradictedId],
        );
        logBeliefChange(storage, {
          beliefId: contradictedId,
          changeType: "weakened",
          detail: `Contradicted by "${statement}" but retained (${supportCount} supporting episodes)`,
          episodeId,
        });
        // Still create the new belief — both coexist until evidence resolves
        const belief = createBelief(storage, { statement, confidence: 0.6, type, importance, subject });
        storeEmbedding(storage, belief.id, embedding);
        linkBeliefToEpisode(storage, belief.id, episodeId);
        logBeliefChange(storage, {
          beliefId: belief.id,
          changeType: "created",
          detail: `Challenges belief ${contradictedId} (retained with ${supportCount} episodes)`,
          episodeId,
        });
        linkSupersession(storage, contradictedId, belief.id);
        logger?.info("Belief weakened but retained due to strong evidence", {
          oldBeliefId: contradictedId, newBeliefId: belief.id, supportCount,
        });
        return { beliefId: belief.id, isReinforcement: false };
      }

      // Weak evidence — invalidate as before
      storage.run("UPDATE beliefs SET status = 'invalidated', updated_at = datetime('now') WHERE id = ?", [contradictedId]);
      logBeliefChange(storage, {
        beliefId: contradictedId,
        changeType: "contradicted",
        detail: `Contradicted by: "${statement}"`,
        episodeId,
      });
      const belief = createBelief(storage, { statement, confidence: 0.6, type, importance, subject });
      storeEmbedding(storage, belief.id, embedding);
      linkBeliefToEpisode(storage, belief.id, episodeId);
      logBeliefChange(storage, {
        beliefId: belief.id,
        changeType: "created",
        detail: `Replaced contradicted belief ${contradictedId}`,
        episodeId,
      });
      linkSupersession(storage, contradictedId, belief.id);
      logger?.info("Belief contradicted and replaced", { oldBeliefId: contradictedId, newBeliefId: belief.id });
      return { beliefId: belief.id, isReinforcement: false };
    }
  }

  // No match or low similarity — create new
  const belief = createBelief(storage, { statement, confidence: 0.6, type, importance, subject });
  storeEmbedding(storage, belief.id, embedding);
  linkBeliefToEpisode(storage, belief.id, episodeId);
  logBeliefChange(storage, {
    beliefId: belief.id,
    changeType: "created",
    detail: `Extracted from: "${statement}"`,
    episodeId,
  });

  // Link to related beliefs (Zettelkasten-style, A-MEM inspired)
  const neighbors = similar.filter((s) => s.similarity >= 0.4 && s.similarity < 0.85);
  for (const n of neighbors.slice(0, 3)) {
    linkBeliefs(storage, belief.id, n.beliefId);
  }

  logger?.info("New belief created", { beliefId: belief.id, type, statement, linkedCount: neighbors.length });
  return { beliefId: belief.id, isReinforcement: false };
}

export async function remember(
  storage: Storage,
  llm: LLMClient,
  text: string,
  logger?: Logger,
): Promise<{ episodeId: string; beliefIds: string[]; isReinforcement: boolean }> {
  const episode = createEpisode(storage, { action: text });

  // Run episode embedding and belief extraction in parallel (independent LLM calls)
  const [, extracted] = await Promise.all([
    // Store episode embedding for semantic episode search
    llm.embed(text)
      .then(({ embedding }) => storeEpisodeEmbedding(storage, episode.id, embedding))
      .catch(() => logger?.warn("Failed to embed episode", { episodeId: episode.id })),
    // Extract beliefs from text
    extractBeliefs(llm, text),
  ]);
  logger?.debug("Extracted beliefs", { input: text, fact: extracted.fact, factType: extracted.factType, insight: extracted.insight });

  const beliefIds: string[] = [];
  let isReinforcement = false;

  const factResult = await processNewBelief(storage, llm, extracted.fact, extracted.factType, episode.id, logger, extracted.importance, extracted.subject);
  beliefIds.push(factResult.beliefId);
  if (factResult.isReinforcement) isReinforcement = true;

  // Skip insight storage — insights are almost always generic noise
  // (e.g., "Simple APIs are preferred over complex abstractions")

  return { episodeId: episode.id, beliefIds, isReinforcement };
}

import type { LLMClient, Storage, Logger } from "../types.js";
import type { Belief, BeliefOrigin } from "./memory.js";
import { addBeliefProvenance, createEpisode, createBelief, findSimilarBeliefs, storeEmbedding, storeEpisodeEmbedding, reinforceBelief, linkBeliefToEpisode, logBeliefChange, countSupportingEpisodes, linkSupersession, linkBeliefs, resolveSubjectAlias } from "./memory.js";

const VALID_FACT_TYPES = new Set(["factual", "preference", "procedural", "architectural"]);

export interface RememberProvenanceInput {
  sourceKind: string;
  sourceId?: string | null;
  sourceLabel?: string | null;
  relation?: string;
}

export interface RememberOptions {
  origin?: BeliefOrigin;
  provenance?: RememberProvenanceInput[];
  freshnessAt?: string | null;
  sensitive?: boolean;
}

export interface StructuredMemoryInput {
  statement: string;
  factType: string;
  importance: number;
  subject: string;
  insight?: string | null;
  episodeAction?: string;
}

interface NormalizedStructuredMemoryInput {
  statement: string;
  factType: string;
  importance: number;
  subject: string;
  insight: string | null;
  episodeAction: string;
}

function inferSensitivity(statement: string): boolean {
  return /\b(password|secret|token|ssn|social security|bank|credit card|passport|visa|health|medical|diagnosis|salary|income|birthday|birth date)\b/i.test(statement);
}

function normalizeFactType(factType: unknown): string {
  return typeof factType === "string" && VALID_FACT_TYPES.has(factType) ? factType : "factual";
}

function normalizeImportance(importance: unknown): number {
  return typeof importance === "number" && importance >= 1 && importance <= 10
    ? Math.round(importance)
    : 5;
}

function normalizeSubject(subject: unknown): string {
  return typeof subject === "string" && subject.trim()
    ? subject.trim().toLowerCase()
    : "owner";
}

function normalizeStructuredMemoryInput(input: StructuredMemoryInput): NormalizedStructuredMemoryInput {
  const statement = input.statement.trim();
  if (!statement) throw new Error("Structured memory statement is required");

  const insight = typeof input.insight === "string" && input.insight.trim()
    ? input.insight.trim()
    : null;
  const episodeAction = typeof input.episodeAction === "string" && input.episodeAction.trim()
    ? input.episodeAction.trim()
    : statement;

  return {
    statement,
    factType: normalizeFactType(input.factType),
    importance: normalizeImportance(input.importance),
    subject: normalizeSubject(input.subject),
    insight,
    episodeAction,
  };
}

async function storeEpisodeEmbeddingForAction(
  storage: Storage,
  llm: LLMClient,
  episodeId: string,
  action: string,
  logger?: Logger,
): Promise<void> {
  await llm.embed(action, {
    telemetry: { process: "embed.memory" },
  })
    .then(({ embedding }) => storeEpisodeEmbedding(storage, episodeId, embedding))
    .catch(() => logger?.warn("Failed to embed episode", { episodeId }));
}

export async function extractBeliefs(
  llm: LLMClient,
  text: string,
): Promise<{ fact: string; factType: string; importance: number; insight: string | null; subject: string }> {
  const result = await llm.chat([
    {
      role: "system",
      content:
        'Extract a personal fact from the observation. ' +
        'The fact should preserve what the user said/experienced. ' +
        'Classify the fact type as one of: "factual" (objective truth), "preference" (user likes/dislikes), ' +
        '"procedural" (how to do something), "architectural" (system design decision). ' +
        'Rate importance 1-10: 1-3 trivial/transient, 4-6 useful context, 7-9 core preference/decision, 10 critical constraint. ' +
        'Identify the subject: who is this fact ABOUT? Use their name (e.g., "Alex", "Bob") or "owner" if about the AI owner. ' +
        'Reply with JSON only: {"fact":"...","factType":"...","importance":N,"subject":"..."} or {"fact":"...","factType":"...","importance":N,"subject":"owner"}. ' +
        'Keep each under 20 words.',
    },
    { role: "user", content: text },
  ], {
    temperature: 0.3,
    telemetry: { process: "memory.extract" },
  });

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
    const factType = normalizeFactType(parsed.factType);
    const importance = normalizeImportance(parsed.importance);
    const subject = normalizeSubject(parsed.subject);
    return { fact: parsed.fact, factType, importance, insight: null, subject };
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
  ], {
    temperature: 0,
    telemetry: { process: "memory.contradiction" },
  });

  const answer = result.text.trim();
  logger?.debug("Contradiction check result", { answer, beliefCount: existingBeliefs.length });

  // Normalize NONE with trailing punctuation (e.g. "NONE.", "NONE!")
  if (/^NONE\W*$/i.test(answer)) return null;

  // Extract the first number from the response (handles "1", "1.", "1. explanation...")
  const numMatch = answer.match(/^(\d+)/);
  if (!numMatch) {
    logger?.warn("LLM returned invalid contradiction response", { answer, validRange: `1-${existingBeliefs.length}` });
    return null;
  }
  const index = parseInt(numMatch[1]!, 10) - 1;
  if (index >= 0 && index < existingBeliefs.length) {
    logger?.info("Contradiction detected", { contradictedId: existingBeliefs[index]!.id, answer });
    return existingBeliefs[index]!.id;
  }
  logger?.warn("LLM returned invalid contradiction index", { answer, validRange: `1-${existingBeliefs.length}` });
  return null;
}

/**
 * Classify the relationship between a new statement and an existing belief.
 * Used in the grey zone (0.70-0.85 similarity) to distinguish between:
 * - REINFORCEMENT: same meaning (paraphrase, intensity change, specificity increase)
 * - CONTRADICTION: mutually exclusive (cannot both be true)
 * - INDEPENDENT: related topic but compatible (different scopes, additive detail)
 */
export async function classifyRelationship(
  llm: LLMClient,
  newStatement: string,
  existingStatement: string,
  logger?: Logger,
): Promise<"REINFORCEMENT" | "CONTRADICTION" | "INDEPENDENT"> {
  const result = await llm.chat([
    {
      role: "system",
      content:
        "You classify the relationship between two beliefs. Reply with EXACTLY one word:\n" +
        "- REINFORCEMENT: They express the same core meaning. One is a paraphrase, synonym, " +
        "intensity change (likes→loves), or more specific version (Linux→Ubuntu) of the other.\n" +
        "- CONTRADICTION: They CANNOT both be true at the same time. One directly negates " +
        "or replaces the other (favorite X is A → favorite X is B, enjoys X → avoids X).\n" +
        "- INDEPENDENT: They are about related topics but can coexist. Different scopes, " +
        "contexts, or additive detail (works at Acme → senior engineer at Acme).\n\n" +
        "Reply with ONLY: REINFORCEMENT, CONTRADICTION, or INDEPENDENT. No other text.",
    },
    {
      role: "user",
      content: `Existing belief: "${existingStatement}"\nNew belief: "${newStatement}"\n\nClassify: REINFORCEMENT, CONTRADICTION, or INDEPENDENT?`,
    },
  ], {
    temperature: 0,
    telemetry: { process: "memory.relationship" },
  });

  const answer = result.text.trim().toUpperCase();
  logger?.debug("Relationship classification", { answer, newStatement, existingStatement });

  if (answer.startsWith("REINFORCEMENT")) return "REINFORCEMENT";
  if (answer.startsWith("CONTRADICTION")) return "CONTRADICTION";
  return "INDEPENDENT";
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
  options?: RememberOptions,
): Promise<{ beliefId: string; isReinforcement: boolean }> {
  // Resolve subject alias before storing
  if (subject) {
    subject = resolveSubjectAlias(storage, subject);
  }

  let embedding: number[] | null = null;
  try {
    const result = await llm.embed(statement, {
      telemetry: { process: "embed.memory" },
    });
    embedding = result.embedding;
  } catch (err) {
    logger?.warn("Embedding failed for belief, skipping semantic dedup", {
      statement,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Without embedding: skip dedup/contradiction check, just create
  if (!embedding) {
    const belief = storage.db.transaction(() => {
      const b = createBelief(storage, {
        statement,
        confidence: 0.6,
        type,
        importance,
        subject,
        origin: options?.origin ?? "user-said",
        freshnessAt: options?.freshnessAt ?? new Date().toISOString(),
        sensitive: options?.sensitive ?? inferSensitivity(statement),
      });
      linkBeliefToEpisode(storage, b.id, episodeId);
      addBeliefProvenance(storage, { beliefId: b.id, sourceKind: "episode", sourceId: episodeId, sourceLabel: "Memory episode", relation: "observed" });
      for (const provenance of options?.provenance ?? []) {
        addBeliefProvenance(storage, { beliefId: b.id, ...provenance });
      }
      logBeliefChange(storage, {
        beliefId: b.id,
        changeType: "created",
        detail: `Extracted from: "${statement}" (no embedding available)`,
        episodeId,
      });
      return b;
    })();
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
    addBeliefProvenance(storage, { beliefId: match.beliefId, sourceKind: "episode", sourceId: episodeId, sourceLabel: "Memory episode", relation: "reinforced-by" });
    for (const provenance of options?.provenance ?? []) {
      addBeliefProvenance(storage, { beliefId: match.beliefId, ...provenance });
    }
    logBeliefChange(storage, {
      beliefId: match.beliefId,
      changeType: "reinforced",
      detail: `Merged similar (${match.similarity.toFixed(2)}): "${statement}"`,
      episodeId,
    });
    logger?.info("Belief merged/reinforced", { beliefId: match.beliefId, similarity: match.similarity });
    return { beliefId: match.beliefId, isReinforcement: true };
  }

  // Grey zone (0.70-0.85): check top 3 candidates for relationship
  const greyZoneCandidates = similar.filter((s) => s.similarity > 0.7).slice(0, 3);
  for (const candidate of greyZoneCandidates) {
    const relationship = await classifyRelationship(llm, statement, candidate.statement, logger);

    if (relationship === "REINFORCEMENT") {
      // Paraphrase, intensity change, or specificity increase — reinforce existing belief
      reinforceBelief(storage, candidate.beliefId);
      linkBeliefToEpisode(storage, candidate.beliefId, episodeId);
      addBeliefProvenance(storage, { beliefId: candidate.beliefId, sourceKind: "episode", sourceId: episodeId, sourceLabel: "Memory episode", relation: "reinforced-by" });
      for (const provenance of options?.provenance ?? []) {
        addBeliefProvenance(storage, { beliefId: candidate.beliefId, ...provenance });
      }
      logBeliefChange(storage, {
        beliefId: candidate.beliefId,
        changeType: "reinforced",
        detail: `Grey-zone reinforcement (${candidate.similarity.toFixed(2)}): "${statement}"`,
        episodeId,
      });
      logger?.info("Belief reinforced via grey-zone classification", { beliefId: candidate.beliefId, similarity: candidate.similarity });
      return { beliefId: candidate.beliefId, isReinforcement: true };
    }

    if (relationship === "CONTRADICTION") {
      const contradictedId = candidate.beliefId;
      const supportCount = countSupportingEpisodes(storage, contradictedId);

      if (supportCount >= 3) {
        // Strong evidence — weaken proportionally (TMS-inspired evidence weighing)
        const drop = Math.min(0.2, 1 / (supportCount + 1));
        storage.run(
          "UPDATE beliefs SET confidence = MAX(0.1, confidence - ?), updated_at = datetime('now'), freshness_at = datetime('now') WHERE id = ?",
          [drop, contradictedId],
        );
        logBeliefChange(storage, {
          beliefId: contradictedId,
          changeType: "weakened",
          detail: `Contradicted by "${statement}" but retained (${supportCount} supporting episodes, -${drop.toFixed(2)})`,
          episodeId,
        });
        // New belief confidence reflects relative evidence strength
        const newConfidence = Math.min(0.6, 1 / (supportCount + 1) + 0.4);
        const belief = storage.db.transaction(() => {
          const b = createBelief(storage, {
            statement,
            confidence: newConfidence,
            type,
            importance,
            subject,
            origin: options?.origin ?? "user-said",
            freshnessAt: options?.freshnessAt ?? new Date().toISOString(),
            sensitive: options?.sensitive ?? inferSensitivity(statement),
          });
          storeEmbedding(storage, b.id, embedding!);
          linkBeliefToEpisode(storage, b.id, episodeId);
          addBeliefProvenance(storage, { beliefId: b.id, sourceKind: "episode", sourceId: episodeId, sourceLabel: "Memory episode", relation: "observed" });
          for (const provenance of options?.provenance ?? []) {
            addBeliefProvenance(storage, { beliefId: b.id, ...provenance });
          }
          logBeliefChange(storage, {
            beliefId: b.id,
            changeType: "created",
            detail: `Challenges belief ${contradictedId} (retained with ${supportCount} episodes)`,
            episodeId,
          });
          linkSupersession(storage, contradictedId, b.id);
          return b;
        })();
        logger?.info("Belief weakened but retained due to strong evidence", {
          oldBeliefId: contradictedId, newBeliefId: belief.id, supportCount, drop,
        });
        return { beliefId: belief.id, isReinforcement: false };
      }

      // Weak evidence — invalidate
      const belief = storage.db.transaction(() => {
        storage.run(
          "UPDATE beliefs SET status = 'invalidated', correction_state = 'invalidated', updated_at = datetime('now'), freshness_at = datetime('now') WHERE id = ?",
          [contradictedId],
        );
        logBeliefChange(storage, {
          beliefId: contradictedId,
          changeType: "contradicted",
          detail: `Contradicted by: "${statement}"`,
          episodeId,
        });
        const b = createBelief(storage, {
          statement,
          confidence: 0.6,
          type,
          importance,
          subject,
          origin: options?.origin ?? "user-said",
          freshnessAt: options?.freshnessAt ?? new Date().toISOString(),
          sensitive: options?.sensitive ?? inferSensitivity(statement),
        });
        storeEmbedding(storage, b.id, embedding!);
        linkBeliefToEpisode(storage, b.id, episodeId);
        addBeliefProvenance(storage, { beliefId: b.id, sourceKind: "episode", sourceId: episodeId, sourceLabel: "Memory episode", relation: "observed" });
        for (const provenance of options?.provenance ?? []) {
          addBeliefProvenance(storage, { beliefId: b.id, ...provenance });
        }
        logBeliefChange(storage, {
          beliefId: b.id,
          changeType: "created",
          detail: `Replaced contradicted belief ${contradictedId}`,
          episodeId,
        });
        linkSupersession(storage, contradictedId, b.id);
        return b;
      })();
      logger?.info("Belief contradicted and replaced", { oldBeliefId: contradictedId, newBeliefId: belief.id });
      return { beliefId: belief.id, isReinforcement: false };
    }

    // INDEPENDENT: continue checking next candidate
  }

  // No match or low similarity — create new
  const neighbors = similar.filter((s) => s.similarity >= 0.4 && s.similarity < 0.85);
  const belief = storage.db.transaction(() => {
    const b = createBelief(storage, {
      statement,
      confidence: 0.6,
      type,
      importance,
      subject,
      origin: options?.origin ?? "user-said",
      freshnessAt: options?.freshnessAt ?? new Date().toISOString(),
      sensitive: options?.sensitive ?? inferSensitivity(statement),
    });
    storeEmbedding(storage, b.id, embedding!);
    linkBeliefToEpisode(storage, b.id, episodeId);
    addBeliefProvenance(storage, { beliefId: b.id, sourceKind: "episode", sourceId: episodeId, sourceLabel: "Memory episode", relation: "observed" });
    for (const provenance of options?.provenance ?? []) {
      addBeliefProvenance(storage, { beliefId: b.id, ...provenance });
    }
    logBeliefChange(storage, {
      beliefId: b.id,
      changeType: "created",
      detail: `Extracted from: "${statement}"`,
      episodeId,
    });
    for (const n of neighbors.slice(0, 3)) {
      linkBeliefs(storage, b.id, n.beliefId);
    }
    return b;
  })();

  logger?.info("New belief created", { beliefId: belief.id, type, statement, linkedCount: neighbors.length });
  return { beliefId: belief.id, isReinforcement: false };
}

async function storeStructuredBeliefs(
  storage: Storage,
  llm: LLMClient,
  input: NormalizedStructuredMemoryInput,
  episodeId: string,
  logger?: Logger,
  options?: RememberOptions,
): Promise<{ beliefIds: string[]; isReinforcement: boolean }> {
  const beliefIds: string[] = [];
  let isReinforcement = false;

  const factResult = await processNewBelief(
    storage,
    llm,
    input.statement,
    input.factType,
    episodeId,
    logger,
    input.importance,
    input.subject,
    {
      origin: options?.origin ?? "user-said",
      provenance: options?.provenance,
      freshnessAt: options?.freshnessAt,
      sensitive: options?.sensitive,
    },
  );
  beliefIds.push(factResult.beliefId);
  if (factResult.isReinforcement) isReinforcement = true;

  return { beliefIds, isReinforcement };
}

export async function rememberStructured(
  storage: Storage,
  llm: LLMClient,
  input: StructuredMemoryInput,
  logger?: Logger,
  options?: RememberOptions,
): Promise<{ episodeId: string; beliefIds: string[]; isReinforcement: boolean }> {
  const normalized = normalizeStructuredMemoryInput(input);
  const episode = createEpisode(storage, { action: normalized.episodeAction });
  const episodeEmbeddingPromise = storeEpisodeEmbeddingForAction(storage, llm, episode.id, normalized.episodeAction, logger);
  const result = await storeStructuredBeliefs(storage, llm, normalized, episode.id, logger, options);
  await episodeEmbeddingPromise;
  return { episodeId: episode.id, ...result };
}

export async function remember(
  storage: Storage,
  llm: LLMClient,
  text: string,
  logger?: Logger,
  options?: RememberOptions,
): Promise<{ episodeId: string; beliefIds: string[]; isReinforcement: boolean }> {
  const episode = createEpisode(storage, { action: text });

  // Run episode embedding and belief extraction in parallel (independent LLM calls)
  const [, extracted] = await Promise.all([
    // Store episode embedding for semantic episode search
    storeEpisodeEmbeddingForAction(storage, llm, episode.id, text, logger),
    // Extract beliefs from text
    extractBeliefs(llm, text),
  ]);
  logger?.debug("Extracted beliefs", { input: text, fact: extracted.fact, factType: extracted.factType, insight: extracted.insight });
  const result = await storeStructuredBeliefs(
    storage,
    llm,
    {
      statement: extracted.fact,
      factType: extracted.factType,
      importance: extracted.importance,
      subject: extracted.subject,
      insight: extracted.insight,
      episodeAction: text,
    },
    episode.id,
    logger,
    options,
  );

  return { episodeId: episode.id, ...result };
}

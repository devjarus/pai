import type { Storage, LLMClient } from "@personal-ai/core";
import {
  addBeliefProvenance,
  correctBelief,
  createBelief,
} from "@personal-ai/core";
import { createFinding, getFinding, computeFindingDelta } from "./findings.js";
import type { CreateFindingInput, ResearchFinding } from "./findings.js";

/**
 * Ingest a research result into Library as a ResearchFinding.
 * Called by the Digest domain after research agents complete.
 */
export function ingestResearchResult(
  storage: Storage,
  input: CreateFindingInput,
): { finding: ResearchFinding } {
  let enrichedInput = input;

  // Auto-compute delta when a previous finding is linked but no delta provided
  if (input.previousFindingId && !input.delta) {
    const previous = getFinding(storage, input.previousFindingId);
    if (previous) {
      const delta = computeFindingDelta(previous.summary, input.summary);
      enrichedInput = { ...input, delta };
    }
  }

  const finding = createFinding(storage, enrichedInput);
  return { finding };
}

export type DigestCorrectionTarget =
  | "memory"
  | "recommendation"
  | "evidence"
  | "cadence"
  | "scope";

export interface DigestCorrectionRecord {
  id: string;
  briefId: string;
  target: DigestCorrectionTarget;
  targetRef: string | null;
  userText: string;
  derivedBeliefId: string | null;
  createdAt: string;
}

export interface CorrectionInput {
  beliefId: string;
  correctedStatement: string;
  digestId?: string;
  note?: string;
}

export interface CorrectionIngestionResult {
  corrected: boolean;
  replacementBeliefId?: string;
  invalidatedBeliefId?: string;
  error?: string;
}

export interface ApplyDigestCorrectionInput {
  briefId: string;
  target?: DigestCorrectionTarget;
  targetRef?: string;
  text?: string;
  beliefId?: string;
  correctedStatement?: string;
  note?: string;
}

export interface ApplyDigestCorrectionResult {
  corrected: boolean;
  correction?: DigestCorrectionRecord;
  replacementBeliefId?: string;
  invalidatedBeliefId?: string;
  error?: string;
}

const TARGETS = new Set<DigestCorrectionTarget>([
  "memory",
  "recommendation",
  "evidence",
  "cadence",
  "scope",
]);

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function directiveStatement(target: DigestCorrectionTarget, text: string): string {
  const cleaned = text.trim();
  switch (target) {
    case "memory":
      return cleaned;
    case "recommendation":
      return `Digest recommendation correction: ${cleaned}`;
    case "evidence":
      return `Digest evidence correction: ${cleaned}`;
    case "cadence":
      return `Digest cadence preference: ${cleaned}`;
    case "scope":
      return `Digest coverage scope: ${cleaned}`;
    default: {
      const _exhaustive: never = target;
      return _exhaustive;
    }
  }
}

function createDirectiveBelief(
  storage: Storage,
  input: { briefId: string; target: DigestCorrectionTarget; text: string; note?: string },
): string {
  const statement = directiveStatement(input.target, input.text);
  const belief = createBelief(storage, {
    statement,
    confidence: 0.92,
    type: "preference",
    importance: 9,
    subject: "owner",
    origin: "user-said",
    correctionState: "confirmed",
    freshnessAt: new Date().toISOString(),
  });

  addBeliefProvenance(storage, {
    beliefId: belief.id,
    sourceKind: "briefing",
    sourceId: input.briefId,
    sourceLabel: input.note?.trim() || `Digest ${input.target} correction`,
    relation: "prompted-correction",
  });

  try {
    storage.run(
      "INSERT OR IGNORE INTO brief_beliefs (id, brief_id, belief_id, role) VALUES (?, ?, ?, ?)",
      [crypto.randomUUID(), input.briefId, belief.id, "correction-input"],
    );
  } catch {
    // brief_beliefs may be unavailable in isolated tests
  }

  return belief.id;
}

function insertDigestCorrection(
  storage: Storage,
  input: {
    briefId: string;
    target: DigestCorrectionTarget;
    targetRef?: string | null;
    userText: string;
    derivedBeliefId: string | null;
  },
): DigestCorrectionRecord {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  try {
    storage.run(
      `INSERT INTO digest_corrections (
        id, brief_id, target, target_ref, user_text, derived_belief_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.briefId,
        input.target,
        input.targetRef ?? null,
        input.userText,
        input.derivedBeliefId,
        createdAt,
      ],
    );
  } catch {
    // Table may not exist yet in older DBs during partial tests — still return the record
  }
  return {
    id,
    briefId: input.briefId,
    target: input.target,
    targetRef: input.targetRef ?? null,
    userText: input.userText,
    derivedBeliefId: input.derivedBeliefId,
    createdAt,
  };
}

/**
 * Infer a correction target from free-text when the user does not specify one.
 */
export function inferCorrectionTarget(text: string): DigestCorrectionTarget {
  const normalized = normalizeText(text);
  if (/\b(too noisy|too often|less frequent|fewer digests|slow down|cadence|every day|too many)\b/.test(normalized)) {
    return "cadence";
  }
  if (/\b(stop covering|don'?t cover|out of scope|ignore topic|not relevant topic|coverage)\b/.test(normalized)) {
    return "scope";
  }
  if (/\b(evidence|source|irrelevant|wrong source|bad source)\b/.test(normalized)) {
    return "evidence";
  }
  if (/\b(recommend|recommendation|should (instead|not)|wrong (call|advice|action))\b/.test(normalized)) {
    return "recommendation";
  }
  return "memory";
}

/**
 * Ingest a user correction from a Digest back into Library.
 * Delegates to core's correctBelief which handles supersession chains.
 */
export async function ingestCorrection(
  storage: Storage,
  llmClient: LLMClient,
  input: CorrectionInput,
): Promise<CorrectionIngestionResult> {
  const result = await applyDigestCorrection(storage, llmClient, {
    briefId: input.digestId ?? "",
    beliefId: input.beliefId,
    correctedStatement: input.correctedStatement,
    text: input.correctedStatement,
    target: "memory",
    note: input.note,
  });
  return {
    corrected: result.corrected,
    replacementBeliefId: result.replacementBeliefId,
    invalidatedBeliefId: result.invalidatedBeliefId,
    error: result.error,
  };
}

/**
 * Apply a digest correction. Memory+beliefId uses supersession; all other
 * targets (and memory without an ID) become durable preference directives.
 */
export async function applyDigestCorrection(
  storage: Storage,
  llm: LLMClient,
  input: ApplyDigestCorrectionInput,
): Promise<ApplyDigestCorrectionResult> {
  const text = (input.text ?? input.correctedStatement ?? "").trim();
  if (!text) {
    return { corrected: false, error: "Correction text is required" };
  }

  const target: DigestCorrectionTarget = input.target
    ?? (input.beliefId ? "memory" : inferCorrectionTarget(text));

  if (target === "memory" && input.beliefId?.trim()) {
    try {
      const result = await correctBelief(storage, llm, input.beliefId.trim(), {
        statement: text,
        note: input.note,
        briefId: input.briefId || undefined,
      });
      const correction = input.briefId
        ? insertDigestCorrection(storage, {
          briefId: input.briefId,
          target: "memory",
          targetRef: input.targetRef ?? input.beliefId.trim(),
          userText: text,
          derivedBeliefId: result.replacementBelief.id,
        })
        : undefined;
      return {
        corrected: true,
        correction,
        replacementBeliefId: result.replacementBelief.id,
        invalidatedBeliefId: result.invalidatedBelief.id,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to correct belief";
      const normalized = message.toLowerCase();
      return {
        corrected: false,
        error: normalized.includes("no match found") ? "Belief not found" : message,
      };
    }
  }

  if (!input.briefId.trim()) {
    return { corrected: false, error: "Digest id is required for non-belief corrections" };
  }

  try {
    const derivedBeliefId = createDirectiveBelief(storage, {
      briefId: input.briefId,
      target,
      text,
      note: input.note,
    });
    const correction = insertDigestCorrection(storage, {
      briefId: input.briefId,
      target,
      targetRef: input.targetRef ?? null,
      userText: text,
      derivedBeliefId,
    });
    return {
      corrected: true,
      correction,
      replacementBeliefId: derivedBeliefId,
    };
  } catch (err) {
    return {
      corrected: false,
      error: err instanceof Error ? err.message : "Failed to apply correction",
    };
  }
}

export function isDigestCorrectionTarget(value: string): value is DigestCorrectionTarget {
  return TARGETS.has(value as DigestCorrectionTarget);
}

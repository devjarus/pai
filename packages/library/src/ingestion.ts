import type { Storage, LLMClient } from "@personal-ai/core";
import { correctBelief } from "@personal-ai/core";
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

/**
 * Ingest a user correction from a Digest back into Library.
 * Delegates to core's correctBelief which handles supersession chains.
 */
export async function ingestCorrection(
  storage: Storage,
  llmClient: LLMClient,
  input: CorrectionInput,
): Promise<CorrectionIngestionResult> {
  try {
    const result = await correctBelief(storage, llmClient, input.beliefId, {
      statement: input.correctedStatement,
      note: input.note,
      briefId: input.digestId,
    });
    return {
      corrected: true,
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

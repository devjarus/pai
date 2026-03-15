import type { Storage, LLMClient } from "@personal-ai/core";
import { correctBelief } from "@personal-ai/core";
import { createFinding } from "./findings.js";
import type { CreateFindingInput, ResearchFinding } from "./findings.js";

/**
 * Ingest a research result into Library as a ResearchFinding.
 * Called by the Digest domain after research agents complete.
 */
export function ingestResearchResult(
  storage: Storage,
  input: CreateFindingInput,
): { finding: ResearchFinding } {
  const finding = createFinding(storage, input);
  return { finding };
}

export interface CorrectionInput {
  beliefId: string;
  correctedStatement: string;
  digestId?: string;
  note?: string;
}

/**
 * Ingest a user correction from a Digest back into Library.
 * Delegates to core's correctBelief which handles supersession chains.
 */
export async function ingestCorrection(
  storage: Storage,
  llmClient: LLMClient,
  input: CorrectionInput,
): Promise<{ corrected: boolean }> {
  try {
    await correctBelief(storage, llmClient, input.beliefId, {
      statement: input.correctedStatement,
      note: input.note,
    });
    return { corrected: true };
  } catch {
    return { corrected: false };
  }
}

import type { Migration, Storage } from "@personal-ai/core";
import { listBeliefs } from "@personal-ai/core";
import {
  applyDigestCorrection,
  inferCorrectionTarget,
  isDigestCorrectionTarget,
  type ApplyDigestCorrectionInput,
  type ApplyDigestCorrectionResult,
  type DigestCorrectionRecord,
  type DigestCorrectionTarget,
} from "@personal-ai/library";

export type {
  ApplyDigestCorrectionInput,
  ApplyDigestCorrectionResult,
  DigestCorrectionRecord,
  DigestCorrectionTarget,
};

export { applyDigestCorrection, inferCorrectionTarget };

export type DigestCorrection = DigestCorrectionRecord;

export interface AppliedCorrectionSectionItem {
  userText: string;
  target: DigestCorrectionTarget;
  appliedAs: string;
  correctedAt: string;
  correctionId?: string;
}

export const digestCorrectionsMigrations: Migration[] = [
  {
    version: 1,
    up: `
      CREATE TABLE IF NOT EXISTS digest_corrections (
        id TEXT PRIMARY KEY,
        brief_id TEXT NOT NULL,
        target TEXT NOT NULL,
        target_ref TEXT,
        user_text TEXT NOT NULL,
        derived_belief_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_digest_corrections_brief ON digest_corrections(brief_id);
      CREATE INDEX IF NOT EXISTS idx_digest_corrections_belief ON digest_corrections(derived_belief_id);
      CREATE INDEX IF NOT EXISTS idx_digest_corrections_created ON digest_corrections(created_at);
    `,
  },
];

export function listDigestCorrections(
  storage: Storage,
  options?: { briefId?: string; limit?: number },
): DigestCorrection[] {
  const limit = options?.limit ?? 50;
  try {
    const rows = options?.briefId
      ? storage.query<{
        id: string;
        brief_id: string;
        target: string;
        target_ref: string | null;
        user_text: string;
        derived_belief_id: string | null;
        created_at: string;
      }>(
        `SELECT * FROM digest_corrections WHERE brief_id = ? ORDER BY created_at DESC LIMIT ?`,
        [options.briefId, limit],
      )
      : storage.query<{
        id: string;
        brief_id: string;
        target: string;
        target_ref: string | null;
        user_text: string;
        derived_belief_id: string | null;
        created_at: string;
      }>(
        `SELECT * FROM digest_corrections ORDER BY created_at DESC LIMIT ?`,
        [limit],
      );

    return rows
      .filter((row) => isDigestCorrectionTarget(row.target))
      .map((row) => ({
        id: row.id,
        briefId: row.brief_id,
        target: row.target,
        targetRef: row.target_ref,
        userText: row.user_text,
        derivedBeliefId: row.derived_belief_id,
        createdAt: row.created_at,
      }));
  } catch {
    return [];
  }
}

/**
 * Build the applied_corrections section from prior corrections whose derived
 * beliefs are shaping the current brief. Deterministic — no LLM.
 */
export function buildAppliedCorrectionsSection(
  storage: Storage,
  beliefIds: string[],
): AppliedCorrectionSectionItem[] {
  if (beliefIds.length === 0) return [];
  const beliefIdSet = new Set(beliefIds);
  const activeBeliefs = new Map(
    listBeliefs(storage, "active")
      .filter((belief) => beliefIdSet.has(belief.id))
      .map((belief) => [belief.id, belief.statement] as const),
  );
  if (activeBeliefs.size === 0) return [];

  const corrections = listDigestCorrections(storage, { limit: 100 });
  const applied: AppliedCorrectionSectionItem[] = [];
  for (const correction of corrections) {
    if (!correction.derivedBeliefId) continue;
    const appliedAs = activeBeliefs.get(correction.derivedBeliefId);
    if (!appliedAs) continue;
    applied.push({
      userText: correction.userText,
      target: correction.target,
      appliedAs,
      correctedAt: correction.createdAt,
      correctionId: correction.id,
    });
    if (applied.length >= 5) break;
  }
  return applied;
}

/**
 * Attach beliefIds to memory assumptions by exact/normalized statement match.
 */
export function reconcileAssumptionBeliefIds<T extends { statement: string; beliefId?: string }>(
  assumptions: T[],
  beliefs: Array<{ id: string; statement: string }>,
): T[] {
  const byStatement = new Map(
    beliefs.map((belief) => [belief.statement.trim().toLowerCase().replace(/\s+/g, " "), belief.id] as const),
  );
  return assumptions.map((assumption) => {
    if (assumption.beliefId?.trim()) return assumption;
    const match = byStatement.get(assumption.statement.trim().toLowerCase().replace(/\s+/g, " "));
    if (!match) return assumption;
    return { ...assumption, beliefId: match };
  });
}

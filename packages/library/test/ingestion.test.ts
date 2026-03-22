import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStorage, memoryMigrations } from "@personal-ai/core";
import type { Storage, LLMClient } from "@personal-ai/core";
import { findingsMigrations } from "../src/findings.js";
import { ingestResearchResult, ingestCorrection } from "../src/ingestion.js";

/** Minimal stub LLMClient — embed throws so correctBelief skips embedding (best-effort). */
function stubLLMClient(): LLMClient {
  return {
    async chat() { throw new Error("not implemented"); },
    async *streamChat() { throw new Error("not implemented"); },
    async embed() { throw new Error("not implemented"); },
    async health() { return { ok: true, provider: "stub" }; },
    getModel() { return null; },
  };
}

describe("ingestion", () => {
  let storage: Storage;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pai-ingestion-test-"));
    storage = createStorage(join(tmpDir, "test.db"));
    storage.migrate("findings", findingsMigrations);
    storage.migrate("memory", memoryMigrations);
  });

  afterEach(() => {
    storage.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("ingestResearchResult creates a finding from research output and returns it", () => {
    const result = ingestResearchResult(storage, {
      goal: "Track GPU prices",
      domain: "general",
      summary: "RTX 5090 is $1999 at launch",
      confidence: 0.9,
      agentName: "PriceTracker",
      depthLevel: "standard",
      sources: [
        { url: "https://nvidia.com", title: "NVIDIA", fetchedAt: new Date().toISOString(), relevance: 0.95 },
      ],
    });

    expect(result.finding).toBeDefined();
    expect(result.finding.id).toBeTruthy();
    expect(result.finding.summary).toBe("RTX 5090 is $1999 at launch");
    expect(result.finding.domain).toBe("general");
    expect(result.finding.agentName).toBe("PriceTracker");
  });

  it("ingestCorrection stores a correction by calling core correctBelief", async () => {
    // Insert a belief directly into the database
    const beliefId = "test-belief-001";
    storage.run(
      `INSERT INTO beliefs (id, statement, confidence, status, type, importance, stability, origin, correction_state, sensitive)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [beliefId, "The sky is green", 0.7, "active", "insight", 5, 1.0, "inferred", "active", 0],
    );

    const result = await ingestCorrection(storage, stubLLMClient(), {
      beliefId,
      correctedStatement: "The sky is blue",
      note: "User corrected colour",
    });

    expect(result.corrected).toBe(true);
    expect(result.replacementBeliefId).toBeTruthy();
    expect(result.invalidatedBeliefId).toBe(beliefId);

    // Verify the old belief was invalidated
    const rows = storage.query<{ status: string }>(
      "SELECT status FROM beliefs WHERE id = ?",
      [beliefId],
    );
    expect(rows[0].status).toBe("invalidated");
  });

  it("ingestCorrection preserves digest lineage when digestId is provided", async () => {
    storage.run(`
      CREATE TABLE IF NOT EXISTS brief_beliefs (
        id TEXT PRIMARY KEY,
        brief_id TEXT NOT NULL,
        belief_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'assumption',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(brief_id, belief_id)
      );
    `);

    const beliefId = "test-belief-002";
    storage.run(
      `INSERT INTO beliefs (id, statement, confidence, status, type, importance, stability, origin, correction_state, sensitive)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [beliefId, "User wants long narrative updates", 0.7, "active", "preference", 6, 1.0, "inferred", "active", 0],
    );

    const result = await ingestCorrection(storage, stubLLMClient(), {
      beliefId,
      correctedStatement: "User wants concise blocker-focused updates",
      digestId: "brief-42",
    });

    expect(result.corrected).toBe(true);
    expect(result.replacementBeliefId).toBeTruthy();

    const briefLinks = storage.query<{ brief_id: string; belief_id: string; role: string }>(
      "SELECT brief_id, belief_id, role FROM brief_beliefs WHERE brief_id = ?",
      ["brief-42"],
    );
    expect(briefLinks).toEqual([
      {
        brief_id: "brief-42",
        belief_id: result.replacementBeliefId as string,
        role: "correction-input",
      },
    ]);

    const provenance = storage.query<{ source_kind: string; source_id: string | null; relation: string }>(
      "SELECT source_kind, source_id, relation FROM belief_provenance WHERE belief_id = ?",
      [result.replacementBeliefId],
    );
    expect(provenance).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source_kind: "briefing",
          source_id: "brief-42",
          relation: "prompted-correction",
        }),
      ]),
    );
  });

  it("ingestCorrection returns corrected:false when belief does not exist", async () => {
    const result = await ingestCorrection(storage, stubLLMClient(), {
      beliefId: "nonexistent",
      correctedStatement: "Something else",
    });

    expect(result.corrected).toBe(false);
    expect(result.error).toContain("not found");
  });
});

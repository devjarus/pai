import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createStorage, createBelief, memoryMigrations, buildBriefSignalHash } from "@personal-ai/core";
import type { LLMClient } from "@personal-ai/core";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  applyDigestCorrection,
  buildAppliedCorrectionsSection,
  digestCorrectionsMigrations,
  inferCorrectionTarget,
  reconcileAssumptionBeliefIds,
} from "../src/digest-corrections.js";
import { briefingMigrations } from "../src/briefing.js";

function mockLlm(): LLMClient {
  return {
    chat: async () => ({ content: "", usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }),
    streamChat: async function* () {},
    embed: async () => ({ embedding: [0.1, 0.2, 0.3] }),
    health: async () => ({ ok: true, provider: "mock" }),
    getModel: () => null,
  };
}

describe("digest-corrections", () => {
  let storage: ReturnType<typeof createStorage>;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pai-corrections-"));
    storage = createStorage(dir);
    storage.migrate("memory", memoryMigrations);
    storage.migrate("inbox", briefingMigrations);
    storage.migrate("digest_corrections", digestCorrectionsMigrations);
  });

  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("infers correction targets from free text", () => {
    expect(inferCorrectionTarget("too noisy, slow down")).toBe("cadence");
    expect(inferCorrectionTarget("stop covering crypto")).toBe("scope");
    expect(inferCorrectionTarget("that evidence is irrelevant")).toBe("evidence");
    expect(inferCorrectionTarget("wrong recommendation, buy later")).toBe("recommendation");
    expect(inferCorrectionTarget("I prefer morning digests")).toBe("memory");
  });

  it("corrects a memory assumption with beliefId via supersession", async () => {
    const belief = createBelief(storage, {
      statement: "Prefer daily crypto digests",
      confidence: 0.8,
      type: "preference",
      origin: "user-said",
    });

    const result = await applyDigestCorrection(storage, mockLlm(), {
      briefId: "brief-1",
      beliefId: belief.id,
      correctedStatement: "Prefer weekly crypto digests",
      target: "memory",
    });

    expect(result.corrected).toBe(true);
    expect(result.replacementBeliefId).toBeTruthy();
    expect(result.invalidatedBeliefId).toBe(belief.id);
    expect(result.correction?.target).toBe("memory");

    const rows = storage.query<{ user_text: string; derived_belief_id: string | null }>(
      "SELECT user_text, derived_belief_id FROM digest_corrections WHERE brief_id = ?",
      ["brief-1"],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.user_text).toBe("Prefer weekly crypto digests");
    expect(rows[0]!.derived_belief_id).toBe(result.replacementBeliefId);
  });

  it("creates a durable directive belief for cadence corrections without beliefId", async () => {
    const result = await applyDigestCorrection(storage, mockLlm(), {
      briefId: "brief-2",
      text: "too noisy — send fewer digests",
      target: "cadence",
    });

    expect(result.corrected).toBe(true);
    expect(result.replacementBeliefId).toBeTruthy();
    expect(result.correction?.target).toBe("cadence");

    const belief = storage.query<{ statement: string; type: string; origin: string; correction_state: string }>(
      "SELECT statement, type, origin, correction_state FROM beliefs WHERE id = ?",
      [result.replacementBeliefId!],
    )[0];
    expect(belief?.type).toBe("preference");
    expect(belief?.origin).toBe("user-said");
    expect(belief?.correction_state).toBe("confirmed");
    expect(belief?.statement).toContain("cadence");
    expect(belief?.statement).toContain("too noisy");
  });

  it("accepts empty beliefId by creating a memory directive instead of 400ing", async () => {
    const result = await applyDigestCorrection(storage, mockLlm(), {
      briefId: "brief-3",
      text: "I care more about visa timelines than price moves",
      target: "memory",
    });
    expect(result.corrected).toBe(true);
    expect(result.replacementBeliefId).toBeTruthy();
  });

  it("builds applied_corrections from prior corrections used by current beliefs", async () => {
    const applied = await applyDigestCorrection(storage, mockLlm(), {
      briefId: "brief-old",
      text: "too noisy",
      target: "cadence",
    });
    expect(applied.replacementBeliefId).toBeTruthy();

    const section = buildAppliedCorrectionsSection(storage, [applied.replacementBeliefId!]);
    expect(section).toHaveLength(1);
    expect(section[0]!.userText).toBe("too noisy");
    expect(section[0]!.target).toBe("cadence");
    expect(section[0]!.appliedAs).toContain("cadence");
  });

  it("does not include applied_corrections in the signal hash", () => {
    const base = {
      recommendation: { summary: "Hold", confidence: "medium" as const, rationale: "Quiet" },
      what_changed: ["Nothing"],
      evidence: [{ title: "A", detail: "B", sourceLabel: "C" }],
      memory_assumptions: [{ statement: "Prefer quiet digests", confidence: "high" as const, provenance: "User" }],
      next_actions: [{ title: "Wait", timing: "Later", detail: "No change" }],
    };
    const withApplied = {
      ...base,
      applied_corrections: [{
        userText: "too noisy",
        target: "cadence" as const,
        appliedAs: "Digest cadence preference: too noisy",
        correctedAt: "2026-07-22T00:00:00.000Z",
      }],
    };
    expect(buildBriefSignalHash(base)).toBe(buildBriefSignalHash(withApplied));
  });

  it("reconciles assumption beliefIds by statement match", () => {
    const beliefs = [
      { id: "b1", statement: "Prefer weekly digests" },
      { id: "b2", statement: "Focus on visa timelines" },
    ];
    const reconciled = reconcileAssumptionBeliefIds(
      [
        { statement: "Prefer weekly digests", confidence: "high" as const, provenance: "User" },
        { statement: "Unknown assumption", confidence: "low" as const, provenance: "Inferred" },
      ],
      beliefs,
    );
    expect(reconciled[0]!.beliefId).toBe("b1");
    expect(reconciled[1]!.beliefId).toBeUndefined();
  });
});

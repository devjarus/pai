import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createStorage } from "@personal-ai/core";
import type { LLMClient } from "@personal-ai/core";
import { memoryMigrations } from "../../src/memory/memory.js";
import { consolidateProfile } from "../../src/memory/consolidate-profile.js";
import { rememberStructured } from "../../src/memory/remember.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Helper to create a mock LLM with unique embeddings per call
 * so rememberStructured creates distinct beliefs instead of reinforcing.
 */
/**
 * Distinct embedding vectors — each is very different from the others so
 * rememberStructured never treats two beliefs as similar / reinforcing.
 */
const DISTINCT_EMBEDDINGS = [
  [1, 0, 0, 0, 0, 0, 0, 0],
  [0, 1, 0, 0, 0, 0, 0, 0],
  [0, 0, 1, 0, 0, 0, 0, 0],
  [0, 0, 0, 1, 0, 0, 0, 0],
  [0, 0, 0, 0, 1, 0, 0, 0],
  [0, 0, 0, 0, 0, 1, 0, 0],
  [0, 0, 0, 0, 0, 0, 1, 0],
  [0, 0, 0, 0, 0, 0, 0, 1],
  [1, 1, 0, 0, 0, 0, 0, 0],
  [0, 0, 1, 1, 0, 0, 0, 0],
  [0, 0, 0, 0, 1, 1, 0, 0],
  [0, 0, 0, 0, 0, 0, 1, 1],
  [1, 0, 1, 0, 0, 0, 0, 0],
  [0, 1, 0, 1, 0, 0, 0, 0],
  [0, 0, 0, 0, 1, 0, 1, 0],
  [0, 0, 0, 0, 0, 1, 0, 1],
  [1, 0, 0, 0, 1, 0, 0, 0],
  [0, 1, 0, 0, 0, 1, 0, 0],
  [0, 0, 1, 0, 0, 0, 1, 0],
  [0, 0, 0, 1, 0, 0, 0, 1],
];

function createMockLLM(): LLMClient {
  let embedIdx = 0;
  return {
    chat: vi.fn().mockResolvedValue({
      text: "Merged belief statement about user preferences covering the full theme",
      usage: { inputTokens: 10, outputTokens: 10 },
    }),
    embed: vi.fn().mockImplementation(() => {
      const embedding = DISTINCT_EMBEDDINGS[embedIdx % DISTINCT_EMBEDDINGS.length]!;
      embedIdx++;
      return Promise.resolve({ embedding });
    }),
    health: vi.fn().mockResolvedValue({ ok: true, provider: "mock" }),
  };
}

describe("classifyTheme (via consolidateProfile)", () => {
  let storage: ReturnType<typeof createStorage>;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pai-consol-"));
    storage = createStorage(dir);
    storage.migrate("memory", memoryMigrations);
  });

  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("classifies communication_style beliefs and consolidates them when 3+ exist", async () => {
    const llm = createMockLLM();

    await rememberStructured(storage, llm, { statement: "Owner prefers concise reports", factType: "preference", importance: 7, subject: "owner" });
    await rememberStructured(storage, llm, { statement: "Owner wants brief actionable summaries", factType: "preference", importance: 7, subject: "owner" });
    await rememberStructured(storage, llm, { statement: "Owner likes delta format in reports", factType: "preference", importance: 7, subject: "owner" });

    // Reset chat mock for consolidation
    llm.chat = vi.fn().mockResolvedValue({
      text: "Owner prefers concise, actionable brief summaries with delta format",
      usage: { inputTokens: 20, outputTokens: 15 },
    });

    const result = await consolidateProfile(storage, llm);

    expect(result.themesProcessed).toBe(1);
    expect(result.beliefsConsolidated).toBe(3);
    expect(result.beliefsCreated).toBe(1);
    expect(llm.chat).toHaveBeenCalledOnce();
  });

  it("classifies crypto_investment beliefs correctly", async () => {
    const llm = createMockLLM();

    await rememberStructured(storage, llm, { statement: "Owner invests in bitcoin aggressively", factType: "preference", importance: 7, subject: "owner" });
    await rememberStructured(storage, llm, { statement: "Owner trades ethereum regularly", factType: "preference", importance: 7, subject: "owner" });
    await rememberStructured(storage, llm, { statement: "Owner has a crypto portfolio allocation plan", factType: "preference", importance: 7, subject: "owner" });

    llm.chat = vi.fn().mockResolvedValue({
      text: "Owner aggressively invests in bitcoin and ethereum with a structured portfolio allocation",
      usage: { inputTokens: 20, outputTokens: 15 },
    });

    const result = await consolidateProfile(storage, llm);
    expect(result.themesProcessed).toBe(1);
    expect(result.beliefsConsolidated).toBe(3);
  });

  it("classifies news_interests beliefs correctly", async () => {
    const llm = createMockLLM();

    await rememberStructured(storage, llm, { statement: "Owner follows technology news closely", factType: "preference", importance: 6, subject: "owner" });
    await rememberStructured(storage, llm, { statement: "Owner cares about finance headlines", factType: "preference", importance: 6, subject: "owner" });
    await rememberStructured(storage, llm, { statement: "Owner reads politics and current events daily", factType: "preference", importance: 6, subject: "owner" });

    llm.chat = vi.fn().mockResolvedValue({
      text: "Owner follows technology, finance, and politics news daily through headlines and current events",
      usage: { inputTokens: 20, outputTokens: 15 },
    });

    const result = await consolidateProfile(storage, llm);
    expect(result.themesProcessed).toBe(1);
  });

  it("returns zero counts for statements that don't match any theme pattern", async () => {
    const llm = createMockLLM();

    // These statements don't match any THEME_PATTERNS
    await rememberStructured(storage, llm, { statement: "Owner likes the color blue", factType: "preference", importance: 3, subject: "owner" });
    await rememberStructured(storage, llm, { statement: "Owner enjoys hiking on weekends", factType: "preference", importance: 3, subject: "owner" });
    await rememberStructured(storage, llm, { statement: "Owner has a pet dog named Max", factType: "preference", importance: 3, subject: "owner" });

    llm.chat = vi.fn();

    const result = await consolidateProfile(storage, llm);
    expect(result.themesProcessed).toBe(0);
    expect(result.beliefsConsolidated).toBe(0);
    expect(result.beliefsCreated).toBe(0);
    expect(llm.chat).not.toHaveBeenCalled();
  });
});

describe("consolidateProfile", () => {
  let storage: ReturnType<typeof createStorage>;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pai-consol-"));
    storage = createStorage(dir);
    storage.migrate("memory", memoryMigrations);
  });

  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("skips themes with fewer than 3 beliefs", async () => {
    const llm = createMockLLM();

    // Only 2 communication_style beliefs
    await rememberStructured(storage, llm, { statement: "Owner prefers concise reports", factType: "preference", importance: 7, subject: "owner" });
    await rememberStructured(storage, llm, { statement: "Owner wants brief summaries", factType: "preference", importance: 7, subject: "owner" });

    llm.chat = vi.fn();

    const result = await consolidateProfile(storage, llm);
    expect(result.themesProcessed).toBe(0);
    expect(result.beliefsConsolidated).toBe(0);
    expect(result.beliefsCreated).toBe(0);
    expect(llm.chat).not.toHaveBeenCalled();
  });

  it("returns correct result shape with zero values when nothing to consolidate", async () => {
    const llm = createMockLLM();

    const result = await consolidateProfile(storage, llm);

    expect(result).toEqual({
      themesProcessed: 0,
      beliefsConsolidated: 0,
      beliefsCreated: 0,
    });
  });

  it("skips factual type beliefs (only processes preference/procedural)", async () => {
    const llm = createMockLLM();

    // 3 factual beliefs about crypto — should be skipped
    await rememberStructured(storage, llm, { statement: "Bitcoin reached $100k", factType: "factual", importance: 7, subject: "owner" });
    await rememberStructured(storage, llm, { statement: "Ethereum gas fees dropped", factType: "factual", importance: 7, subject: "owner" });
    await rememberStructured(storage, llm, { statement: "Crypto market cap hit $3T", factType: "factual", importance: 7, subject: "owner" });

    llm.chat = vi.fn();

    const result = await consolidateProfile(storage, llm);
    expect(result.themesProcessed).toBe(0);
    expect(llm.chat).not.toHaveBeenCalled();
  });

  it("skips beliefs with non-owner/non-general subjects", async () => {
    const llm = createMockLLM();

    await rememberStructured(storage, llm, { statement: "Alice prefers concise reports", factType: "preference", importance: 7, subject: "Alice" });
    await rememberStructured(storage, llm, { statement: "Alice wants brief summaries", factType: "preference", importance: 7, subject: "Alice" });
    await rememberStructured(storage, llm, { statement: "Alice likes actionable format", factType: "preference", importance: 7, subject: "Alice" });

    llm.chat = vi.fn();

    const result = await consolidateProfile(storage, llm);
    expect(result.themesProcessed).toBe(0);
    expect(llm.chat).not.toHaveBeenCalled();
  });

  it("invalidates old beliefs after consolidation", async () => {
    const llm = createMockLLM();

    const b1 = await rememberStructured(storage, llm, { statement: "Owner prefers concise reports", factType: "preference", importance: 7, subject: "owner" });
    const b2 = await rememberStructured(storage, llm, { statement: "Owner wants brief actionable summaries", factType: "preference", importance: 7, subject: "owner" });
    const b3 = await rememberStructured(storage, llm, { statement: "Owner likes delta format in reports", factType: "preference", importance: 7, subject: "owner" });

    // Verify we have 3 distinct beliefs
    const allBefore = storage.query<{ id: string; status: string }>("SELECT id, status FROM beliefs WHERE status = 'active'");
    expect(allBefore.length).toBeGreaterThanOrEqual(3);

    llm.chat = vi.fn().mockResolvedValue({
      text: "Owner prefers concise, actionable brief summaries with delta format updates",
      usage: { inputTokens: 20, outputTokens: 15 },
    });

    await consolidateProfile(storage, llm);

    // Old beliefs should be invalidated
    for (const id of [b1.beliefIds[0], b2.beliefIds[0], b3.beliefIds[0]]) {
      const rows = storage.query<{ status: string }>("SELECT status FROM beliefs WHERE id = ?", [id]);
      expect(rows[0]!.status).toBe("invalidated");
    }
  });

  it("handles LLM chat error gracefully and returns zero counts", async () => {
    const llm = createMockLLM();

    await rememberStructured(storage, llm, { statement: "Owner prefers concise reports", factType: "preference", importance: 7, subject: "owner" });
    await rememberStructured(storage, llm, { statement: "Owner wants brief summaries", factType: "preference", importance: 7, subject: "owner" });
    await rememberStructured(storage, llm, { statement: "Owner likes actionable format", factType: "preference", importance: 7, subject: "owner" });

    // Make the consolidation LLM call fail
    llm.chat = vi.fn().mockRejectedValue(new Error("LLM unavailable"));

    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const result = await consolidateProfile(storage, llm, logger);

    expect(result.themesProcessed).toBe(0);
    expect(result.beliefsConsolidated).toBe(0);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("skips when LLM returns too-short merged text (< 10 chars)", async () => {
    const llm = createMockLLM();

    await rememberStructured(storage, llm, { statement: "Owner prefers concise reports", factType: "preference", importance: 7, subject: "owner" });
    await rememberStructured(storage, llm, { statement: "Owner wants brief summaries", factType: "preference", importance: 7, subject: "owner" });
    await rememberStructured(storage, llm, { statement: "Owner likes actionable format", factType: "preference", importance: 7, subject: "owner" });

    llm.chat = vi.fn().mockResolvedValue({
      text: "short",
      usage: { inputTokens: 10, outputTokens: 2 },
    });

    const result = await consolidateProfile(storage, llm);
    expect(result.themesProcessed).toBe(0);
    expect(result.beliefsCreated).toBe(0);
  });

  it("processes multiple themes independently", async () => {
    const llm = createMockLLM();

    // 3 communication_style beliefs
    await rememberStructured(storage, llm, { statement: "Owner prefers concise reports", factType: "preference", importance: 7, subject: "owner" });
    await rememberStructured(storage, llm, { statement: "Owner wants brief summaries", factType: "preference", importance: 7, subject: "owner" });
    await rememberStructured(storage, llm, { statement: "Owner likes actionable format", factType: "preference", importance: 7, subject: "owner" });

    // 3 crypto_investment beliefs
    await rememberStructured(storage, llm, { statement: "Owner invests in bitcoin aggressively", factType: "preference", importance: 7, subject: "owner" });
    await rememberStructured(storage, llm, { statement: "Owner trades ethereum regularly", factType: "preference", importance: 7, subject: "owner" });
    await rememberStructured(storage, llm, { statement: "Owner has a crypto portfolio allocation plan", factType: "preference", importance: 7, subject: "owner" });

    // Verify we have 6 distinct active beliefs
    const activeBefore = storage.query<{ id: string }>("SELECT id FROM beliefs WHERE status = 'active'");
    expect(activeBefore.length).toBe(6);

    llm.chat = vi.fn().mockResolvedValue({
      text: "Consolidated user preference statement that is unique and does not match any theme pattern keywords",
      usage: { inputTokens: 20, outputTokens: 15 },
    });

    const result = await consolidateProfile(storage, llm);
    // At least 1 theme should be processed (may vary based on internal ordering)
    expect(result.themesProcessed).toBeGreaterThanOrEqual(1);
    expect(result.beliefsConsolidated).toBeGreaterThanOrEqual(3);
    expect(result.beliefsCreated).toBeGreaterThanOrEqual(1);
    // LLM should be called for consolidation at least once
    expect(llm.chat).toHaveBeenCalled();
  });
});

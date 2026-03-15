import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStorage, memoryMigrations, knowledgeMigrations } from "@personal-ai/core";
import type { Storage } from "@personal-ai/core";
import {
  findingsMigrations,
  createFinding,
  listFindings,
  unifiedSearch,
  ingestResearchResult,
  memoryStats,
  listSources,
} from "../src/index.js";

describe("Library integration", () => {
  let storage: Storage;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pai-library-integration-"));
    storage = createStorage(join(tmpDir, "test.db"));
    storage.migrate("memory", memoryMigrations);
    storage.migrate("knowledge", knowledgeMigrations);
    storage.migrate("findings", findingsMigrations);
  });

  afterEach(() => {
    storage.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("finding creation → unified search → retrieval", () => {
    const finding = createFinding(storage, {
      goal: "Monitor solar panel prices",
      domain: "general",
      summary: "SunPower panels dropped to $2.50/watt in Q1 2026",
      confidence: 0.88,
      agentName: "PriceTracker",
      depthLevel: "standard",
      sources: [
        { url: "https://solarprice.example.com", title: "Solar Price Index", fetchedAt: new Date().toISOString(), relevance: 0.92 },
      ],
    });

    // Appears in unified search with correct sourceType
    const searchResults = unifiedSearch(storage, "SunPower panels");
    expect(searchResults.length).toBeGreaterThanOrEqual(1);
    const findingResult = searchResults.find((r) => r.sourceType === "finding");
    expect(findingResult).toBeDefined();
    expect(findingResult!.id).toBe(finding.id);
    expect(findingResult!.snippet).toContain("SunPower");

    // Appears in listFindings
    const allFindings = listFindings(storage);
    expect(allFindings).toHaveLength(1);
    expect(allFindings[0].id).toBe(finding.id);
  });

  it("memory + finding appear together in search", () => {
    // Insert a belief directly
    storage.run(
      `INSERT INTO beliefs (id, statement, confidence, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ["b-int-1", "Kubernetes simplifies container orchestration", 0.85, "active", "2026-01-15T00:00:00Z", "2026-01-15T00:00:00Z"],
    );

    // Create a finding about the same topic
    createFinding(storage, {
      goal: "Container orchestration trends",
      domain: "general",
      summary: "Kubernetes adoption reached 78% among enterprises in 2026",
      confidence: 0.9,
      agentName: "TrendWatcher",
      depthLevel: "standard",
      sources: [],
    });

    const results = unifiedSearch(storage, "Kubernetes");
    expect(results.length).toBe(2);

    const sourceTypes = results.map((r) => r.sourceType).sort();
    expect(sourceTypes).toEqual(["finding", "memory"]);
  });

  it("ingestion pipeline — research result flows to Library", () => {
    const result = ingestResearchResult(storage, {
      goal: "Track lithium battery costs",
      domain: "general",
      summary: "Lithium battery pack prices fell below $100/kWh for the first time",
      confidence: 0.92,
      agentName: "EnergyResearcher",
      depthLevel: "deep",
      sources: [
        { url: "https://energy.example.com", title: "Energy Report", fetchedAt: new Date().toISOString(), relevance: 0.95 },
      ],
    });

    expect(result.finding).toBeDefined();
    expect(result.finding.id).toBeTruthy();

    // Persisted via listFindings
    const allFindings = listFindings(storage);
    expect(allFindings).toHaveLength(1);
    expect(allFindings[0].summary).toContain("Lithium battery");

    // Appears in unified search
    const searchResults = unifiedSearch(storage, "lithium battery");
    expect(searchResults.length).toBeGreaterThanOrEqual(1);
    expect(searchResults[0].sourceType).toBe("finding");
    expect(searchResults[0].snippet).toContain("Lithium battery");
  });

  it("stats include all three types", () => {
    // Insert a belief
    storage.run(
      `INSERT INTO beliefs (id, statement, confidence, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ["b-stats-1", "Rust is memory safe", 0.95, "active", "2026-02-01T00:00:00Z", "2026-02-01T00:00:00Z"],
    );

    // Insert a knowledge source
    storage.run(
      `INSERT INTO knowledge_sources (id, url, title, fetched_at)
       VALUES (?, ?, ?, ?)`,
      ["ks-stats-1", "https://example.com/rust", "Rust Language Guide", "2026-02-01T00:00:00Z"],
    );

    // Insert a finding
    createFinding(storage, {
      goal: "Language safety comparison",
      domain: "general",
      summary: "Rust eliminates data races at compile time",
      confidence: 0.93,
      agentName: "LangAnalyst",
      depthLevel: "quick",
      sources: [],
    });

    // Verify stats cover all types (mirroring the /api/library/stats endpoint logic)
    const stats = memoryStats(storage);
    const documents = listSources(storage);
    const findings = listFindings(storage);

    expect(stats.beliefs.total).toBe(1);
    expect(stats.beliefs.active).toBe(1);
    expect(documents).toHaveLength(1);
    expect(findings).toHaveLength(1);
  });
});

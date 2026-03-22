import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStorage } from "@personal-ai/core";
import type { Storage } from "@personal-ai/core";
import { findingsMigrations, createFinding, getFinding, listFindings, listFindingsForWatch, deleteFinding, computeFindingDelta } from "../src/findings.js";
import { ingestResearchResult } from "../src/ingestion.js";

describe("findings", () => {
  let storage: Storage;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pai-findings-test-"));
    storage = createStorage(join(tmpDir, "test.db"));
    storage.migrate("findings", findingsMigrations);
  });

  afterEach(() => {
    storage.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates and retrieves a finding", () => {
    const finding = createFinding(storage, {
      goal: "Find cheapest GPU",
      domain: "general",
      summary: "RTX 4090 is $1599 on Newegg",
      confidence: 0.85,
      agentName: "Researcher",
      depthLevel: "standard",
      sources: [{ url: "https://newegg.com", title: "Newegg", fetchedAt: new Date().toISOString(), relevance: 0.9 }],
    });
    expect(finding.id).toBeTruthy();
    expect(finding.summary).toBe("RTX 4090 is $1599 on Newegg");

    const retrieved = getFinding(storage, finding.id);
    expect(retrieved).toEqual(finding);
  });

  it("lists findings filtered by watch", () => {
    createFinding(storage, { goal: "GPU prices", domain: "general", summary: "Finding 1", confidence: 0.8, agentName: "Researcher", depthLevel: "quick", sources: [], watchId: "watch-1" });
    createFinding(storage, { goal: "Flight deals", domain: "flight", summary: "Finding 2", confidence: 0.7, agentName: "FlightScout", depthLevel: "standard", sources: [] });

    const all = listFindings(storage);
    expect(all).toHaveLength(2);

    const forWatch = listFindingsForWatch(storage, "watch-1");
    expect(forWatch).toHaveLength(1);
    expect(forWatch[0].summary).toBe("Finding 1");
  });

  it("deletes a finding", () => {
    const finding = createFinding(storage, { goal: "test", domain: "general", summary: "to delete", confidence: 0.5, agentName: "test", depthLevel: "quick", sources: [] });
    deleteFinding(storage, finding.id);
    expect(getFinding(storage, finding.id)).toBeUndefined();
  });

  it("stores and retrieves delta when provided", () => {
    const delta = { changed: ["+ New sentence added."], significance: 0.5 };
    const finding = createFinding(storage, {
      goal: "test",
      domain: "general",
      summary: "Updated summary",
      confidence: 0.8,
      agentName: "test",
      depthLevel: "quick",
      sources: [],
      delta,
    });

    const retrieved = getFinding(storage, finding.id);
    expect(retrieved?.delta).toEqual(delta);
  });
});

describe("computeFindingDelta", () => {
  it("detects added sentences", () => {
    const prev = "GPU prices are stable.";
    const curr = "GPU prices are stable. A new RTX 5090 was announced.";
    const delta = computeFindingDelta(prev, curr);
    expect(delta.changed).toContain("+ A new RTX 5090 was announced.");
    expect(delta.significance).toBeGreaterThan(0);
  });

  it("detects removed sentences", () => {
    const prev = "GPU prices are stable. RTX 4090 is on sale.";
    const curr = "GPU prices are stable.";
    const delta = computeFindingDelta(prev, curr);
    expect(delta.changed.some((c) => c.startsWith("- "))).toBe(true);
    expect(delta.significance).toBeGreaterThan(0);
  });

  it("returns empty delta for identical summaries", () => {
    const summary = "GPU prices are stable.";
    const delta = computeFindingDelta(summary, summary);
    expect(delta.changed).toHaveLength(0);
    expect(delta.significance).toBe(0);
  });

  it("handles completely different summaries", () => {
    const prev = "Old finding about topic A.";
    const curr = "New finding about topic B.";
    const delta = computeFindingDelta(prev, curr);
    expect(delta.changed.length).toBe(2);
    expect(delta.significance).toBe(1);
  });

  it("normalizes whitespace and case when comparing", () => {
    const prev = "GPU prices are stable.";
    const curr = "gpu  Prices  ARE  stable.";
    const delta = computeFindingDelta(prev, curr);
    expect(delta.changed).toHaveLength(0);
    expect(delta.significance).toBe(0);
  });
});

describe("ingestion with delta", () => {
  let storage: Storage;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pai-ingestion-test-"));
    storage = createStorage(join(tmpDir, "test.db"));
    storage.migrate("findings", findingsMigrations);
  });

  afterEach(() => {
    storage.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("auto-computes delta when previousFindingId is set", () => {
    const prev = ingestResearchResult(storage, {
      goal: "GPU prices",
      domain: "general",
      summary: "RTX 4090 is $1599.",
      confidence: 0.8,
      agentName: "Researcher",
      depthLevel: "standard",
      sources: [],
      watchId: "watch-1",
    });

    const curr = ingestResearchResult(storage, {
      goal: "GPU prices",
      domain: "general",
      summary: "RTX 4090 is $1599. RTX 5090 announced at $1999.",
      confidence: 0.85,
      agentName: "Researcher",
      depthLevel: "standard",
      sources: [],
      watchId: "watch-1",
      previousFindingId: prev.finding.id,
    });

    expect(curr.finding.delta).toBeDefined();
    expect(curr.finding.delta!.changed.length).toBeGreaterThan(0);
    expect(curr.finding.delta!.significance).toBeGreaterThan(0);
    expect(curr.finding.previousFindingId).toBe(prev.finding.id);
  });

  it("preserves explicit delta when provided alongside previousFindingId", () => {
    const prev = ingestResearchResult(storage, {
      goal: "test",
      domain: "general",
      summary: "Old summary.",
      confidence: 0.8,
      agentName: "test",
      depthLevel: "quick",
      sources: [],
    });

    const explicitDelta = { changed: ["custom change"], significance: 0.99 };
    const curr = ingestResearchResult(storage, {
      goal: "test",
      domain: "general",
      summary: "New summary.",
      confidence: 0.8,
      agentName: "test",
      depthLevel: "quick",
      sources: [],
      previousFindingId: prev.finding.id,
      delta: explicitDelta,
    });

    expect(curr.finding.delta).toEqual(explicitDelta);
  });
});

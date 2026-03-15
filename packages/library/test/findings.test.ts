import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStorage } from "@personal-ai/core";
import type { Storage } from "@personal-ai/core";
import { findingsMigrations, createFinding, getFinding, listFindings, listFindingsForWatch, deleteFinding } from "../src/findings.js";

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
});

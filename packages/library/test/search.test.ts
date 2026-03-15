import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStorage, memoryMigrations, knowledgeMigrations } from "@personal-ai/core";
import type { Storage } from "@personal-ai/core";
import { findingsMigrations } from "../src/findings.js";
import { unifiedSearch } from "../src/search.js";

describe("unifiedSearch", () => {
  let storage: Storage;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pai-search-test-"));
    storage = createStorage(join(tmpDir, "test.db"));
    storage.migrate("memory", memoryMigrations);
    storage.migrate("knowledge", knowledgeMigrations);
    storage.migrate("findings", findingsMigrations);
  });

  afterEach(() => {
    storage.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("searches across all three sources and returns results with correct sourceType", () => {
    // Insert a belief
    storage.run(
      `INSERT INTO beliefs (id, statement, confidence, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ["b1", "TypeScript is great for large projects", 0.9, "active", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"],
    );

    // Insert a knowledge source and chunk
    storage.run(
      `INSERT INTO knowledge_sources (id, url, title, fetched_at)
       VALUES (?, ?, ?, ?)`,
      ["ks1", "https://example.com/ts", "TypeScript Guide", "2026-01-01T00:00:00Z"],
    );
    storage.run(
      `INSERT INTO knowledge_chunks (id, source_id, content, chunk_index, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      ["kc1", "ks1", "TypeScript provides static typing for JavaScript", 0, "2026-01-01T00:00:00Z"],
    );

    // Insert a research finding
    storage.run(
      `INSERT INTO research_findings (id, goal, domain, summary, confidence, agent_name, depth_level, sources, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["f1", "Learn TypeScript", "general", "TypeScript adoption has grown 40% year over year", 0.85, "Researcher", "standard", "[]", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"],
    );

    const results = unifiedSearch(storage, "TypeScript");

    expect(results.length).toBe(3);

    const sourceTypes = results.map((r) => r.sourceType).sort();
    expect(sourceTypes).toEqual(["document", "finding", "memory"]);

    const memoryResult = results.find((r) => r.sourceType === "memory");
    expect(memoryResult).toBeDefined();
    expect(memoryResult!.id).toBe("b1");
    expect(memoryResult!.snippet).toContain("TypeScript");

    const docResult = results.find((r) => r.sourceType === "document");
    expect(docResult).toBeDefined();
    expect(docResult!.id).toBe("kc1");

    const findingResult = results.find((r) => r.sourceType === "finding");
    expect(findingResult).toBeDefined();
    expect(findingResult!.id).toBe("f1");
  });

  it("returns empty results for no matches", () => {
    const results = unifiedSearch(storage, "xyznonexistent");
    expect(results).toEqual([]);
  });
});

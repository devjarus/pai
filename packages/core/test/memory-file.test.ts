import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStorage, createLogger } from "../src/index.js";
import { memoryMigrations } from "../src/memory/index.js";
import { generateMemoryFile } from "../src/memory/memory-file.js";

function setupDB() {
  const dir = mkdtempSync(join(tmpdir(), "pai-memfile-"));
  const logger = createLogger({ logLevel: "silent" } as any);
  const storage = createStorage(dir, logger);
  storage.migrate("memory", memoryMigrations);
  return { dir, storage };
}

describe("generateMemoryFile", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs) {
      rmSync(d, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it("should generate markdown with belief statements", () => {
    const { dir, storage } = setupDB();
    dirs.push(dir);

    storage.run(
      `INSERT INTO beliefs (id, statement, confidence, type, status, stability, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      ["test-id-1", "User prefers dark mode", 0.8, "preference", "active", 2.0],
    );
    storage.run(
      `INSERT INTO beliefs (id, statement, confidence, type, status, stability, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      ["test-id-2", "Project uses TypeScript strict mode", 0.9, "factual", "active", 2.0],
    );

    const outputPath = join(dir, "output", "memory.md");
    const result = generateMemoryFile(storage, outputPath);

    expect(result.beliefCount).toBe(2);
    expect(result.path).toBe(outputPath);

    const content = readFileSync(outputPath, "utf-8");
    expect(content).toContain("User prefers dark mode");
    expect(content).toContain("Project uses TypeScript strict mode");
    expect(content).toContain("# Memory");

    storage.close();
  });

  it("should return beliefCount of 0 and write placeholder when no beliefs exist", () => {
    const { dir, storage } = setupDB();
    dirs.push(dir);

    const outputPath = join(dir, "output", "memory.md");
    const result = generateMemoryFile(storage, outputPath);

    expect(result.beliefCount).toBe(0);
    expect(result.path).toBe(outputPath);

    const content = readFileSync(outputPath, "utf-8");
    expect(content).toContain("No established beliefs yet");

    storage.close();
  });

  it("should respect minConfidence filter", () => {
    const { dir, storage } = setupDB();
    dirs.push(dir);

    storage.run(
      `INSERT INTO beliefs (id, statement, confidence, type, status, stability, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      ["high-conf", "High confidence belief", 0.9, "factual", "active", 2.0],
    );
    storage.run(
      `INSERT INTO beliefs (id, statement, confidence, type, status, stability, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      ["low-conf", "Low confidence belief", 0.2, "factual", "active", 1.0],
    );

    const outputPath = join(dir, "output", "memory.md");
    const result = generateMemoryFile(storage, outputPath, { minConfidence: 0.5 });

    expect(result.beliefCount).toBe(1);
    const content = readFileSync(outputPath, "utf-8");
    expect(content).toContain("High confidence belief");
    expect(content).not.toContain("Low confidence belief");

    storage.close();
  });

  it("should group beliefs by type with correct headings", () => {
    const { dir, storage } = setupDB();
    dirs.push(dir);

    storage.run(
      `INSERT INTO beliefs (id, statement, confidence, type, status, stability, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      ["pref-1", "User prefers Vitest", 0.8, "preference", "active", 2.0],
    );
    storage.run(
      `INSERT INTO beliefs (id, statement, confidence, type, status, stability, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      ["proc-1", "Run pnpm build before testing", 0.7, "procedural", "active", 2.0],
    );
    storage.run(
      `INSERT INTO beliefs (id, statement, confidence, type, status, stability, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      ["insight-1", "Testing improves reliability", 0.6, "insight", "active", 2.0],
    );

    const outputPath = join(dir, "output", "memory.md");
    generateMemoryFile(storage, outputPath);

    const content = readFileSync(outputPath, "utf-8");
    expect(content).toContain("## Preferences — always follow these");
    expect(content).toContain("## Procedures — follow these steps");
    expect(content).toContain("## Insights — apply when relevant");

    storage.close();
  });

  it("should respect maxBeliefs limit", () => {
    const { dir, storage } = setupDB();
    dirs.push(dir);

    for (let i = 0; i < 5; i++) {
      storage.run(
        `INSERT INTO beliefs (id, statement, confidence, type, status, stability, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        [`belief-${i}`, `Belief number ${i}`, 0.8 - i * 0.05, "factual", "active", 2.0],
      );
    }

    const outputPath = join(dir, "output", "memory.md");
    const result = generateMemoryFile(storage, outputPath, { maxBeliefs: 2 });

    expect(result.beliefCount).toBe(2);
    const content = readFileSync(outputPath, "utf-8");
    // Should contain the top 2 by confidence
    expect(content).toContain("Belief number 0");
    expect(content).toContain("Belief number 1");
    expect(content).not.toContain("Belief number 4");

    storage.close();
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createStorage } from "../src/storage.js";
import { memoryMigrations } from "../src/memory/memory.js";
import { knowledgeMigrations, chunkContent, learnFromContent, knowledgeSearch, hasSource, listSources, forgetSource, stripChunkHeader, reindexSource, reindexAllSources } from "../src/knowledge.js";
import type { LLMClient, Storage } from "../src/types.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function createTestStorage() {
  const dir = mkdtempSync(join(tmpdir(), "pai-kb-test-"));
  const storage = createStorage(dir);
  storage.migrate("memory", memoryMigrations);
  storage.migrate("knowledge", knowledgeMigrations);
  return { storage, dir };
}

function createMockLLM(): LLMClient {
  let callCount = 0;
  return {
    chat: vi.fn().mockResolvedValue({ text: "", usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }),
    embed: vi.fn().mockImplementation(async () => {
      callCount++;
      const base = Array(8).fill(0).map((_, i) => Math.sin(i + callCount * 0.1));
      return { embedding: base };
    }),
    getModel: vi.fn(),
  } as unknown as LLMClient;
}

describe("chunkContent", () => {
  it("splits content into word-bounded chunks", () => {
    const text = Array(10)
      .fill("This is a paragraph with about ten words in it.")
      .join("\n\n");
    const chunks = chunkContent(text, 30);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeGreaterThan(0);
    }
  });

  it("keeps short content as single chunk", () => {
    const chunks = chunkContent("Hello world.\n\nShort content.");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain("Hello world.");
    expect(chunks[0]).toContain("Short content.");
  });

  it("handles empty content", () => {
    const chunks = chunkContent("");
    expect(chunks).toHaveLength(0);
  });

  it("preserves paragraph boundaries", () => {
    const text = "Paragraph one.\n\nParagraph two.\n\nParagraph three.";
    const chunks = chunkContent(text, 5);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });
});

describe("learnFromContent", () => {
  let storage: Storage;
  let dir: string;
  let llm: LLMClient;

  beforeEach(() => {
    const t = createTestStorage();
    storage = t.storage;
    dir = t.dir;
    llm = createMockLLM();
  });

  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("stores a source and chunks", async () => {
    const result = await learnFromContent(
      storage, llm,
      "https://example.com/article",
      "Test Article",
      "# Test\n\nFirst paragraph.\n\nSecond paragraph.",
    );

    expect(result.skipped).toBe(false);
    expect(result.source.title).toBe("Test Article");
    expect(result.source.url).toBe("https://example.com/article");
    expect(result.chunksStored).toBeGreaterThan(0);
  });

  it("deduplicates by URL", async () => {
    await learnFromContent(storage, llm, "https://example.com/page", "Page", "Content here.");
    const result2 = await learnFromContent(storage, llm, "https://example.com/page", "Page", "Content here.");

    expect(result2.skipped).toBe(true);
    expect(result2.chunksStored).toBe(0);
  });

  it("normalizes URLs for dedup (trailing slash, utm params)", async () => {
    await learnFromContent(storage, llm, "https://example.com/page/", "Page", "Content.");
    const result = await learnFromContent(storage, llm, "https://example.com/page?utm_source=twitter", "Page", "Content.");

    expect(result.skipped).toBe(true);
  });
});

describe("knowledgeSearch", () => {
  let storage: Storage;
  let dir: string;
  let llm: LLMClient;

  beforeEach(async () => {
    const t = createTestStorage();
    storage = t.storage;
    dir = t.dir;
    llm = createMockLLM();

    await learnFromContent(
      storage, llm,
      "https://example.com/react-hooks",
      "React Hooks Guide",
      "React hooks let you use state in function components.\n\nuseState is the most basic hook.\n\nuseEffect runs side effects after render.",
    );
  });

  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns matching chunks with source info", async () => {
    const results = await knowledgeSearch(storage, llm, "React state");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.source.title).toBe("React Hooks Guide");
    expect(results[0]!.source.url).toBe("https://example.com/react-hooks");
    expect(results[0]!.score).toBeGreaterThan(0);
  });

  it("returns empty for no matches when embed fails", async () => {
    const failLlm = {
      ...llm,
      embed: vi.fn().mockRejectedValue(new Error("embed failed")),
    } as unknown as LLMClient;
    const results = await knowledgeSearch(storage, failLlm, "anything");
    expect(results).toHaveLength(0);
  });
});

describe("hasSource", () => {
  let storage: Storage;
  let dir: string;

  beforeEach(() => {
    const t = createTestStorage();
    storage = t.storage;
    dir = t.dir;
  });

  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns null when URL not learned", () => {
    expect(hasSource(storage, "https://example.com/nope")).toBeNull();
  });

  it("returns source when URL exists", async () => {
    const llm = createMockLLM();
    await learnFromContent(storage, llm, "https://example.com/test", "Test", "Content.");
    const source = hasSource(storage, "https://example.com/test");
    expect(source).not.toBeNull();
    expect(source!.title).toBe("Test");
  });
});

describe("listSources", () => {
  let storage: Storage;
  let dir: string;

  beforeEach(() => {
    const t = createTestStorage();
    storage = t.storage;
    dir = t.dir;
  });

  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("lists all learned sources", async () => {
    const llm = createMockLLM();
    await learnFromContent(storage, llm, "https://a.com/1", "A", "Content A.");
    await learnFromContent(storage, llm, "https://b.com/2", "B", "Content B.");
    const sources = listSources(storage);
    expect(sources).toHaveLength(2);
  });
});

describe("forgetSource", () => {
  let storage: Storage;
  let dir: string;

  beforeEach(() => {
    const t = createTestStorage();
    storage = t.storage;
    dir = t.dir;
  });

  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("removes source and chunks", async () => {
    const llm = createMockLLM();
    const result = await learnFromContent(storage, llm, "https://example.com/del", "Delete Me", "Content.");
    expect(forgetSource(storage, result.source.id)).toBe(true);
    expect(hasSource(storage, "https://example.com/del")).toBeNull();
    const chunks = storage.query("SELECT * FROM knowledge_chunks WHERE source_id = ?", [result.source.id]);
    expect(chunks).toHaveLength(0);
  });

  it("returns false for non-existent source", () => {
    expect(forgetSource(storage, "nonexistent")).toBe(false);
  });
});

describe("stripChunkHeader", () => {
  it("strips contextual header from chunk content", () => {
    const content = "# React Hooks Guide\nSource: example.com\n\nReact hooks let you use state.";
    expect(stripChunkHeader(content)).toBe("React hooks let you use state.");
  });

  it("returns content unchanged if no header present", () => {
    const content = "Just plain content without a header.";
    expect(stripChunkHeader(content)).toBe(content);
  });
});

describe("reindexSource", () => {
  let storage: Storage;
  let dir: string;
  let llm: LLMClient;

  beforeEach(() => {
    const t = createTestStorage();
    storage = t.storage;
    dir = t.dir;
    llm = createMockLLM();
  });

  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("re-indexes a source with fresh contextual headers and embeddings", async () => {
    const result = await learnFromContent(storage, llm, "https://example.com/reindex", "Reindex Test", "First paragraph.\n\nSecond paragraph.");
    const originalChunks = storage.query<{ id: string }>("SELECT id FROM knowledge_chunks WHERE source_id = ?", [result.source.id]);

    const newCount = await reindexSource(storage, llm, result.source.id);
    expect(newCount).toBeGreaterThan(0);

    const newChunks = storage.query<{ id: string; content: string }>("SELECT id, content FROM knowledge_chunks WHERE source_id = ?", [result.source.id]);
    // Old chunk IDs should be gone (replaced)
    for (const old of originalChunks) {
      expect(newChunks.find((c) => c.id === old.id)).toBeUndefined();
    }
    // New chunks should have contextual headers
    expect(newChunks[0]!.content).toContain("# Reindex Test");
    expect(newChunks[0]!.content).toContain("Source: example.com");
  });

  it("throws for non-existent source", async () => {
    await expect(reindexSource(storage, llm, "nonexistent")).rejects.toThrow("Source not found");
  });
});

describe("reindexAllSources", () => {
  let storage: Storage;
  let dir: string;
  let llm: LLMClient;

  beforeEach(() => {
    const t = createTestStorage();
    storage = t.storage;
    dir = t.dir;
    llm = createMockLLM();
  });

  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("re-indexes all sources and returns count", async () => {
    await learnFromContent(storage, llm, "https://a.com/1", "A", "Content A paragraph.");
    await learnFromContent(storage, llm, "https://b.com/2", "B", "Content B paragraph.");

    const count = await reindexAllSources(storage, llm);
    expect(count).toBe(2);
  });

  it("returns 0 when no sources exist", async () => {
    const count = await reindexAllSources(storage, llm);
    expect(count).toBe(0);
  });
});

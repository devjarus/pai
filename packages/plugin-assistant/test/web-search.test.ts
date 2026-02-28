import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { webSearch, formatSearchResults, resolveSearchUrl } from "../src/web-search.js";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  // Clear env vars between tests
  delete process.env.PAI_SEARCH_URL;
  delete process.env.RAILWAY_VOLUME_MOUNT_PATH;
  delete process.env.PAI_DATA_DIR;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("resolveSearchUrl", () => {
  it("uses PAI_SEARCH_URL when set", () => {
    process.env.PAI_SEARCH_URL = "http://custom:9090";
    expect(resolveSearchUrl()).toBe("http://custom:9090");
  });

  it("uses Railway internal URL when on Railway", () => {
    process.env.RAILWAY_VOLUME_MOUNT_PATH = "/mount";
    expect(resolveSearchUrl()).toBe("http://searxng.railway.internal:8080");
  });

  it("uses Docker internal URL when PAI_DATA_DIR is /data", () => {
    process.env.PAI_DATA_DIR = "/data";
    expect(resolveSearchUrl()).toBe("http://searxng:8080");
  });

  it("falls back to localhost", () => {
    expect(resolveSearchUrl()).toBe("http://localhost:8080");
  });

  it("PAI_SEARCH_URL takes priority over Railway detection", () => {
    process.env.PAI_SEARCH_URL = "http://explicit:1234";
    process.env.RAILWAY_VOLUME_MOUNT_PATH = "/mount";
    expect(resolveSearchUrl()).toBe("http://explicit:1234");
  });
});

describe("webSearch", () => {
  it("calls SearXNG with correct URL params", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          { title: "Result 1", url: "https://example.com/1", content: "Snippet 1" },
          { title: "Result 2", url: "https://example.com/2", content: "Snippet 2" },
        ],
      }),
    });

    const results = await webSearch("test query");

    expect(mockFetch).toHaveBeenCalledOnce();
    const callUrl = mockFetch.mock.calls[0]![0] as string;
    expect(callUrl).toContain("/search?");
    expect(callUrl).toContain("q=test+query");
    expect(callUrl).toContain("format=json");
    expect(callUrl).toContain("categories=general");

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ title: "Result 1", url: "https://example.com/1", snippet: "Snippet 1" });
  });

  it("passes category to SearXNG", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [] }),
    });

    await webSearch("AI papers", 5, "science");

    const callUrl = mockFetch.mock.calls[0]![0] as string;
    expect(callUrl).toContain("categories=science");
  });

  it("respects maxResults limit", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: Array.from({ length: 10 }, (_, i) => ({
          title: `Result ${i}`,
          url: `https://example.com/${i}`,
          content: `Snippet ${i}`,
        })),
      }),
    });

    const results = await webSearch("test", 3);
    expect(results).toHaveLength(3);
  });

  it("handles empty results", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [] }),
    });

    const results = await webSearch("obscure query");
    expect(results).toEqual([]);
  });

  it("maps thumbnail field from SearXNG response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          { title: "News", url: "https://example.com/1", content: "Snippet", thumbnail: "https://img.example.com/thumb.jpg" },
        ],
      }),
    });

    const results = await webSearch("test");
    expect(results[0]!.thumbnail).toBe("https://img.example.com/thumb.jpg");
  });

  it("uses img_src as fallback when thumbnail is absent", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          { title: "Image", url: "https://example.com/2", content: "Snippet", img_src: "https://img.example.com/full.jpg" },
        ],
      }),
    });

    const results = await webSearch("test");
    expect(results[0]!.thumbnail).toBe("https://img.example.com/full.jpg");
  });

  it("prefers thumbnail over img_src", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          { title: "Both", url: "https://example.com/3", content: "Snippet", thumbnail: "https://thumb.jpg", img_src: "https://full.jpg" },
        ],
      }),
    });

    const results = await webSearch("test");
    expect(results[0]!.thumbnail).toBe("https://thumb.jpg");
  });

  it("omits thumbnail when neither field is present", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          { title: "Plain", url: "https://example.com/4", content: "Snippet" },
        ],
      }),
    });

    const results = await webSearch("test");
    expect(results[0]!.thumbnail).toBeUndefined();
  });

  it("handles missing content field with empty snippet", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [{ title: "No Content", url: "https://example.com" }],
      }),
    });

    const results = await webSearch("test");
    expect(results[0]!.snippet).toBe("");
  });

  it("throws on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });

    await expect(webSearch("test")).rejects.toThrow("SearXNG search failed: 503");
  });

  it("handles missing results key in response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    const results = await webSearch("test");
    expect(results).toEqual([]);
  });
});

describe("formatSearchResults", () => {
  it("returns empty string for no results", () => {
    expect(formatSearchResults([])).toBe("");
  });

  it("formats results with numbering and markdown", () => {
    const results = [
      { title: "First", url: "https://a.com", snippet: "Description A" },
      { title: "Second", url: "https://b.com", snippet: "Description B" },
    ];

    const output = formatSearchResults(results);
    expect(output).toContain("## Web Search Results");
    expect(output).toContain("1. **First**");
    expect(output).toContain("Description A");
    expect(output).toContain("Source: https://a.com");
    expect(output).toContain("2. **Second**");
  });
});

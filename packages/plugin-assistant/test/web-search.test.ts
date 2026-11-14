import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { webSearch, formatSearchResults, resolveSearchUrl, isSearchConfigured, searchHealth } from "../src/web-search.js";

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

  it("does not invent a Railway URL when unset", () => {
    process.env.RAILWAY_VOLUME_MOUNT_PATH = "/mount";
    expect(resolveSearchUrl()).toBeNull();
  });

  it("does not invent a Docker URL when PAI_DATA_DIR is /data", () => {
    process.env.PAI_DATA_DIR = "/data";
    expect(resolveSearchUrl()).toBeNull();
  });

  it("returns null when nothing is configured", () => {
    expect(resolveSearchUrl()).toBeNull();
    expect(isSearchConfigured()).toBe(false);
  });

  it("PAI_SEARCH_URL takes priority over config-less detection", () => {
    process.env.PAI_SEARCH_URL = "http://explicit:1234";
    process.env.RAILWAY_VOLUME_MOUNT_PATH = "/mount";
    expect(resolveSearchUrl()).toBe("http://explicit:1234");
    expect(isSearchConfigured()).toBe(true);
  });
});

describe("searchHealth", () => {
  it("reports not configured when no URL is set", async () => {
    const result = await searchHealth();
    expect(result).toEqual({
      ok: false,
      configured: false,
      detail: expect.stringContaining("not configured"),
    });
  });

  it("reports ok when /healthz succeeds", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });
    const result = await searchHealth("http://searxng:8080");
    expect(result).toEqual({ ok: true, configured: true });
  });
});

describe("webSearch", () => {
  it("throws when search is not configured", async () => {
    await expect(webSearch("test")).rejects.toThrow(/not configured/i);
  });

  it("calls SearXNG with correct URL params", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          { title: "Result 1", url: "https://a.com", content: "Snippet 1" },
          { title: "Result 2", url: "https://b.com", content: "Snippet 2" },
        ],
      }),
    });

    const results = await webSearch("test query", 5, "general", "http://searxng:8080");
    expect(results).toHaveLength(2);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("http://searxng:8080/search?"),
      expect.any(Object),
    );
  });

  it("passes category in the query string", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [] }),
    });
    await webSearch("AI papers", 5, "science" as any, "http://searxng:8080");
    expect(mockFetch.mock.calls[0]![0]).toContain("categories=science");
  });

  it("respects maxResults", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          { title: "1", url: "https://a.com", content: "a" },
          { title: "2", url: "https://b.com", content: "b" },
          { title: "3", url: "https://c.com", content: "c" },
          { title: "4", url: "https://d.com", content: "d" },
        ],
      }),
    });
    const results = await webSearch("test", 3, "general", "http://searxng:8080");
    expect(results).toHaveLength(3);
  });

  it("returns empty array when SearXNG returns no results", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [] }),
    });
    const results = await webSearch("obscure query", 5, "general", "http://searxng:8080");
    expect(results).toEqual([]);
  });

  it("throws on non-OK HTTP status", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });
    await expect(webSearch("test", 5, "general", "http://searxng:8080")).rejects.toThrow("SearXNG search failed: 503");
  });

  it("widens time_range=day to week when day returns empty", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [{ title: "Weekly hit", url: "https://w.com", content: "ok" }],
        }),
      });

    const results = await webSearch("AI news this week", 5, "news", "http://searxng:8080", "day");
    expect(results).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(String(mockFetch.mock.calls[0]![0])).toContain("time_range=day");
    expect(String(mockFetch.mock.calls[1]![0])).toContain("time_range=week");
  });
});

describe("formatSearchResults", () => {
  it("returns empty string for empty results", () => {
    expect(formatSearchResults([])).toBe("");
  });

  it("formats results with titles and sources", () => {
    const text = formatSearchResults([
      { title: "A", url: "https://a.com", snippet: "snip" },
    ]);
    expect(text).toContain("## Web Search Results");
    expect(text).toContain("**A**");
    expect(text).toContain("https://a.com");
  });
});

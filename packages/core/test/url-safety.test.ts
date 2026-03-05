import { describe, it, expect } from "vitest";
import { isDomainBlocked, filterSearchResults, sanitizeReportUrls, resolveBlocklist } from "../src/url-safety.js";

describe("isDomainBlocked", () => {
  it("blocks exact domain match", () => {
    expect(isDomainBlocked("iliashalkin.com")).toBe(true);
  });

  it("blocks subdomain of blocked domain", () => {
    expect(isDomainBlocked("www.iliashalkin.com")).toBe(true);
    expect(isDomainBlocked("blog.iliashalkin.com")).toBe(true);
  });

  it("allows non-blocked domains", () => {
    expect(isDomainBlocked("example.com")).toBe(false);
    expect(isDomainBlocked("google.com")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isDomainBlocked("IliasHalkin.COM")).toBe(true);
  });

  it("uses custom blocklist when provided", () => {
    expect(isDomainBlocked("spam.net", ["spam.net"])).toBe(true);
    expect(isDomainBlocked("good.com", ["spam.net"])).toBe(false);
  });

  it("does not false-positive on partial domain names", () => {
    // "notiliashalkin.com" should NOT be blocked by "iliashalkin.com"
    expect(isDomainBlocked("notiliashalkin.com")).toBe(false);
  });
});

describe("filterSearchResults", () => {
  const results = [
    { title: "Good result", url: "https://example.com/page", snippet: "Useful content" },
    { title: "Blocked result", url: "https://iliashalkin.com/spam", snippet: "Spam content" },
    { title: "Another good result", url: "https://bbc.com/news", snippet: "News article" },
    { title: "Subdomain blocked", url: "https://blog.iliashalkin.com/post", snippet: "Blog spam" },
  ];

  it("removes results from blocked domains", () => {
    const filtered = filterSearchResults(results);
    expect(filtered).toHaveLength(2);
    expect(filtered.map((r) => r.url)).toEqual([
      "https://example.com/page",
      "https://bbc.com/news",
    ]);
  });

  it("removes results with invalid URLs", () => {
    const withInvalid = [
      { title: "OK", url: "https://example.com", snippet: "ok" },
      { title: "Bad", url: "not-a-url", snippet: "bad" },
    ];
    const filtered = filterSearchResults(withInvalid);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.url).toBe("https://example.com");
  });

  it("uses custom blocklist", () => {
    const custom = [{ title: "Custom blocked", url: "https://custom-spam.org/page", snippet: "spam" }];
    const filtered = filterSearchResults(custom, ["custom-spam.org"]);
    expect(filtered).toHaveLength(0);
  });
});

describe("sanitizeReportUrls", () => {
  it("removes markdown links to blocked domains, keeps text", () => {
    const content = "See [Cricket Stats](https://iliashalkin.com/cricket) for details.";
    const sanitized = sanitizeReportUrls(content);
    expect(sanitized).toBe("See Cricket Stats for details.");
    expect(sanitized).not.toContain("iliashalkin.com");
  });

  it("removes bare blocked URLs", () => {
    const content = "Source: https://iliashalkin.com/page\nAnother line.";
    const sanitized = sanitizeReportUrls(content);
    expect(sanitized).not.toContain("iliashalkin.com");
  });

  it("preserves allowed URLs", () => {
    const content = "See [BBC](https://bbc.com/news) and https://example.com/article for more.";
    const sanitized = sanitizeReportUrls(content);
    expect(sanitized).toContain("https://bbc.com/news");
    expect(sanitized).toContain("https://example.com/article");
  });

  it("handles mixed content", () => {
    const content = `## Sources
1. [Good Source](https://reuters.com/article)
2. [Bad Source](https://iliashalkin.com/spam)
3. https://bbc.com/news
4. https://www.iliashalkin.com/other`;
    const sanitized = sanitizeReportUrls(content);
    expect(sanitized).toContain("https://reuters.com/article");
    expect(sanitized).toContain("https://bbc.com/news");
    expect(sanitized).not.toContain("iliashalkin.com");
  });

  it("uses custom blocklist", () => {
    const content = "Visit https://custom-spam.org/page for info.";
    const sanitized = sanitizeReportUrls(content, ["custom-spam.org"]);
    expect(sanitized).not.toContain("custom-spam.org");
  });
});

describe("resolveBlocklist", () => {
  it("returns defaults when no custom list provided", () => {
    const list = resolveBlocklist();
    expect(list).toContain("iliashalkin.com");
  });

  it("merges custom with defaults", () => {
    const list = resolveBlocklist(["spam.net", "junk.org"]);
    expect(list).toContain("iliashalkin.com");
    expect(list).toContain("spam.net");
    expect(list).toContain("junk.org");
  });

  it("deduplicates entries", () => {
    const list = resolveBlocklist(["iliashalkin.com", "spam.net"]);
    const count = list.filter((d) => d === "iliashalkin.com").length;
    expect(count).toBe(1);
  });
});

import { describe, it, expect } from "vitest";
import { markdownToTelegramHTML, splitMessage, telegramPlugin, isComplexContent, stripHtmlTags, formatTelegramResponse } from "../src/index.js";
import { withThreadLock } from "../src/chat.js";

describe("markdownToTelegramHTML", () => {
  it("converts bold markdown", () => {
    expect(markdownToTelegramHTML("**hello**")).toBe("<b>hello</b>");
    expect(markdownToTelegramHTML("__hello__")).toBe("<b>hello</b>");
  });

  it("converts italic markdown", () => {
    expect(markdownToTelegramHTML("*hello*")).toBe("<i>hello</i>");
    expect(markdownToTelegramHTML("_hello_")).toBe("<i>hello</i>");
  });

  it("converts inline code", () => {
    expect(markdownToTelegramHTML("`code here`")).toBe("<code>code here</code>");
  });

  it("converts code blocks", () => {
    const input = "```js\nconsole.log('hi');\n```";
    const output = markdownToTelegramHTML(input);
    expect(output).toContain("<pre>");
    expect(output).toContain("console.log('hi');");
    expect(output).toContain("</pre>");
  });

  it("converts links", () => {
    // sanitizeUrl strips the trailing slash new URL() adds when original didn't have one
    expect(markdownToTelegramHTML("[Google](https://google.com)"))
      .toBe('<a href="https://google.com">Google</a>');
  });

  it("drops unsafe link protocols", () => {
    // sanitizeUrl rejects non-http(s) protocols; link replaced with label only
    expect(markdownToTelegramHTML("[XSS](javascript:alert(1))")).toBe("XSS");
  });

  it("keeps root-relative artifact links", () => {
    expect(markdownToTelegramHTML("[artifact](/api/artifacts/abc123)"))
      .toBe('<a href="/api/artifacts/abc123">artifact</a>');
  });

  it("converts headers to bold", () => {
    expect(markdownToTelegramHTML("# Title")).toBe("<b>Title</b>");
    expect(markdownToTelegramHTML("## Subtitle")).toBe("<b>Subtitle</b>");
    expect(markdownToTelegramHTML("### Section")).toBe("<b>Section</b>");
  });

  it("converts strikethrough", () => {
    expect(markdownToTelegramHTML("~~deleted~~")).toBe("<s>deleted</s>");
  });

  it("escapes HTML entities in regular text", () => {
    expect(markdownToTelegramHTML("a < b > c & d")).toBe("a &lt; b &gt; c &amp; d");
  });

  it("escapes HTML inside code blocks", () => {
    const input = "```\n<script>alert('xss')</script>\n```";
    const output = markdownToTelegramHTML(input);
    expect(output).toContain("&lt;script&gt;");
    expect(output).not.toContain("<script>");
  });

  it("converts list bullets", () => {
    const input = "- item one\n- item two";
    const output = markdownToTelegramHTML(input);
    expect(output).toContain("\u2022 item one");
    expect(output).toContain("\u2022 item two");
  });

  it("handles mixed formatting", () => {
    const input = "**Bold** and *italic* with `code`";
    const output = markdownToTelegramHTML(input);
    expect(output).toContain("<b>Bold</b>");
    expect(output).toContain("<i>italic</i>");
    expect(output).toContain("<code>code</code>");
  });

  it("handles empty string", () => {
    expect(markdownToTelegramHTML("")).toBe("");
  });

  it("handles plain text without markdown", () => {
    expect(markdownToTelegramHTML("Just plain text")).toBe("Just plain text");
  });

  it("converts blockquotes to italic", () => {
    expect(markdownToTelegramHTML("> quoted text")).toBe("<i>quoted text</i>");
  });

  it("converts 2-column tables to bullet format", () => {
    const input = "| Key | Value |\n|-----|-------|\n| Name | Alice |\n| Age | 30 |";
    const output = markdownToTelegramHTML(input);
    expect(output).toContain("\u2022 Name: Alice");
    expect(output).toContain("\u2022 Age: 30");
    expect(output).not.toContain("|");
  });

  it("converts LLM-emitted HTML bold/italic to Telegram HTML", () => {
    expect(markdownToTelegramHTML("<strong>hello</strong>")).toBe("<b>hello</b>");
    expect(markdownToTelegramHTML("<em>world</em>")).toBe("<i>world</i>");
    expect(markdownToTelegramHTML("<b>bold</b> and <i>italic</i>")).toBe("<b>bold</b> and <i>italic</i>");
  });

  it("converts LLM-emitted HTML lists to bullets", () => {
    const input = "<ul><li>one</li><li>two</li></ul>";
    const output = markdownToTelegramHTML(input);
    expect(output).toContain("\u2022 one");
    expect(output).toContain("\u2022 two");
  });

  it("converts LLM-emitted <a> links to Telegram links", () => {
    const input = 'Visit <a href="https://example.com">Example</a> now';
    const output = markdownToTelegramHTML(input);
    expect(output).toContain('<a href="https://example.com">Example</a>');
  });

  it("converts <br> tags to newlines", () => {
    const output = markdownToTelegramHTML("line one<br>line two<br/>line three");
    expect(output).toContain("line one\nline two\nline three");
    expect(output).not.toContain("<br");
  });

  it("converts horizontal rules to visual separator", () => {
    const output = markdownToTelegramHTML("above\n\n---\n\nbelow");
    expect(output).toContain("\u2500");
    expect(output).not.toContain("---");
  });

  it("preserves links with & in URLs without double-encoding", () => {
    const input = "[search](https://example.com/?a=1&b=2)";
    const output = markdownToTelegramHTML(input);
    // Link extracted before escapeHTML, so & stays raw (correct for href attributes)
    expect(output).toContain('href="https://example.com/?a=1&b=2"');
    // Must NOT double-encode
    expect(output).not.toContain("&amp;amp;");
    expect(output).not.toContain("&amp;b=2");
  });

  it("converts image markdown to clickable link", () => {
    const input = "![chart](https://example.com/chart.png)";
    const output = markdownToTelegramHTML(input);
    expect(output).toContain('<a href="https://example.com/chart.png">chart</a>');
  });

  it("strips unknown HTML tags from LLM output", () => {
    const input = "<div>Hello <span>world</span></div>";
    const output = markdownToTelegramHTML(input);
    expect(output).toContain("Hello");
    expect(output).toContain("world");
    expect(output).not.toContain("<div>");
    expect(output).not.toContain("<span>");
  });

  it("converts 3+ column tables to card-style blocks", () => {
    const input = "| Tier | Cost | Benefits |\n|------|------|----------|\n| Free | $0 | Basic CDN |\n| Pro | $20 | Enhanced WAF |";
    const output = markdownToTelegramHTML(input);
    // Each row rendered as labeled fields
    expect(output).toContain("Tier: Free");
    expect(output).toContain("Cost: $20");
    expect(output).toContain("Benefits: Enhanced WAF");
    // Should NOT contain raw backticks or ASCII table separators
    expect(output).not.toContain("```");
    expect(output).not.toContain("-+-");
  });

  it("converts tables with blank lines between rows", () => {
    const input = "| Dimension | Finnhub | Alpha Vantage |\n\n|-----------|---------|---------------|\n\n| Coverage | Global | US only |\n\n| Latency | 15s | 20min |";
    const output = markdownToTelegramHTML(input);
    // Should convert to card-style (3 columns), not show raw pipes
    expect(output).toContain("Dimension: Coverage");
    expect(output).toContain("Finnhub: Global");
    expect(output).toContain("Alpha Vantage: US only");
    expect(output).not.toContain("|");
  });

  it("converts 2-column tables with blank lines between rows", () => {
    const input = "| Key | Value |\n\n|-----|-------|\n\n| Name | Alice |\n\n| Age | 30 |";
    const output = markdownToTelegramHTML(input);
    expect(output).toContain("\u2022 Name: Alice");
    expect(output).toContain("\u2022 Age: 30");
    expect(output).not.toContain("|");
  });
});

describe("splitMessage", () => {
  it("returns single-element array for short messages", () => {
    const result = splitMessage("Hello world");
    expect(result).toEqual(["Hello world"]);
  });

  it("does not split messages at the limit", () => {
    const msg = "a".repeat(4096);
    const result = splitMessage(msg);
    expect(result).toEqual([msg]);
  });

  it("splits at paragraph boundaries", () => {
    const para1 = "a".repeat(2000);
    const para2 = "b".repeat(2000);
    const para3 = "c".repeat(2000);
    const msg = `${para1}\n\n${para2}\n\n${para3}`;
    const result = splitMessage(msg);
    expect(result.length).toBeGreaterThan(1);
    // No part should exceed 4096
    for (const part of result) {
      expect(part.length).toBeLessThanOrEqual(4096);
    }
  });

  it("splits at newlines when no paragraph boundary", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `Line ${i}: ${"x".repeat(50)}`);
    const msg = lines.join("\n");
    const result = splitMessage(msg);
    expect(result.length).toBeGreaterThan(1);
    for (const part of result) {
      expect(part.length).toBeLessThanOrEqual(4096);
    }
  });

  it("hard-splits when no good break point", () => {
    const msg = "x".repeat(10000); // No newlines at all
    const result = splitMessage(msg);
    expect(result.length).toBeGreaterThan(1);
    for (const part of result) {
      expect(part.length).toBeLessThanOrEqual(4096);
    }
  });

  it("handles custom max length", () => {
    const msg = "Hello world, this is a test message";
    const result = splitMessage(msg, 10);
    expect(result.length).toBeGreaterThan(1);
  });

  it("avoids splitting inside HTML tags", () => {
    // Build a message where the natural split point falls inside an <a> tag
    const padding = "x".repeat(4080);
    const msg = `${padding}<a href="https://example.com">link</a> more text here`;
    const result = splitMessage(msg);
    // The first part should not contain a truncated tag
    expect(result[0]).not.toMatch(/<a[^>]*$/);
    expect(result.length).toBeGreaterThan(1);
  });
});

describe("telegramPlugin", () => {
  it("has correct name and version", () => {
    expect(telegramPlugin.name).toBe("telegram");
    expect(telegramPlugin.version).toBe("0.1.0");
  });

  it("has telegram_threads migration", () => {
    expect(telegramPlugin.migrations).toHaveLength(1);
    expect(telegramPlugin.migrations[0]!.version).toBe(1);
    expect(telegramPlugin.migrations[0]!.up).toContain("telegram_threads");
  });

  it("returns empty commands", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cmds = telegramPlugin.commands({} as any);
    expect(cmds).toEqual([]);
  });
});

describe("withThreadLock", () => {
  it("serializes concurrent calls for the same threadId", async () => {
    const order: number[] = [];
    const p1 = withThreadLock("t1", async () => {
      await new Promise((r) => setTimeout(r, 50));
      order.push(1);
    });
    const p2 = withThreadLock("t1", async () => {
      order.push(2);
    });
    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2]); // Must be serial, not [2, 1]
  });

  it("allows parallel execution for different threadIds", async () => {
    const order: number[] = [];
    const p1 = withThreadLock("t1", async () => {
      await new Promise((r) => setTimeout(r, 50));
      order.push(1);
    });
    const p2 = withThreadLock("t2", async () => {
      order.push(2);
    });
    await Promise.all([p1, p2]);
    expect(order).toEqual([2, 1]); // t2 finishes first (no blocking)
  });

  it("cleans up queue after completion", async () => {
    await withThreadLock("cleanup-test", async () => {});
    // Allow microtask to run cleanup
    await new Promise((r) => setTimeout(r, 10));
    // No way to check Map directly, but no memory leak
  });

  it("continues after previous failure", async () => {
    const p1 = withThreadLock("t-fail", async () => {
      throw new Error("fail");
    }).catch(() => {}); // Swallow

    let ran = false;
    const p2 = withThreadLock("t-fail", async () => {
      ran = true;
    });
    await Promise.all([p1, p2]);
    expect(ran).toBe(true);
  });
});

describe("isComplexContent", () => {
  it("returns false for short simple text", () => {
    expect(isComplexContent("Hello world")).toBe(false);
  });

  it("returns true for long text", () => {
    expect(isComplexContent("x".repeat(2001))).toBe(true);
  });

  it("returns true for markdown tables", () => {
    const table = "| Key | Value |\n|-----|-------|\n| A | B |";
    expect(isComplexContent(table)).toBe(true);
  });

  it("returns true for large code blocks", () => {
    const code = "```\n" + "x".repeat(101) + "\n```";
    expect(isComplexContent(code)).toBe(true);
  });

  it("returns true for large JSON blocks", () => {
    const json = "{" + '"key": "value", '.repeat(20) + '"end": true}';
    expect(isComplexContent(json)).toBe(true);
  });
});

describe("stripHtmlTags", () => {
  it("strips all HTML tags", () => {
    expect(stripHtmlTags("<b>bold</b> and <i>italic</i>")).toBe("bold and italic");
  });

  it("converts block closing tags to newlines", () => {
    const result = stripHtmlTags("<p>line one</p><p>line two</p>");
    expect(result).toContain("line one");
    expect(result).toContain("line two");
  });

  it("decodes HTML entities", () => {
    expect(stripHtmlTags("a &lt; b &gt; c &amp; d")).toBe("a < b > c & d");
  });

  it("converts <br> to newlines", () => {
    expect(stripHtmlTags("one<br>two<br/>three")).toBe("one\ntwo\nthree");
  });
});

describe("formatTelegramResponse", () => {
  it("strips jsonrender blocks", () => {
    const input = "Hello\n```jsonrender\n{\"root\":\"x\"}\n```\nWorld";
    const result = formatTelegramResponse(input);
    expect(result).toContain("Hello");
    expect(result).toContain("World");
    expect(result).not.toContain("jsonrender");
  });

  it("converts fenced JSON to readable markdown", () => {
    const input = '```json\n{"name": "Alice", "age": 30}\n```';
    const result = formatTelegramResponse(input);
    expect(result).toContain("Name");
    expect(result).toContain("Alice");
    expect(result).not.toContain("```");
  });

  it("strips residual raw JSON blocks", () => {
    const json = '{"ticker": "AAPL", "price": 150, "change": 2.5, "volume": 1000000, "marketCap": 2500000000000, "pe": 25.3}';
    const input = `Here is the data:\n${json}`;
    const result = formatTelegramResponse(input);
    expect(result).not.toContain('"ticker"');
    expect(result).toContain("AAPL");
  });

  it("collapses excessive whitespace after stripping", () => {
    const input = "Hello\n\n\n\n\n\nWorld";
    const result = formatTelegramResponse(input);
    expect(result).not.toMatch(/\n{3,}/);
  });
});

describe("splitMessage tag repair", () => {
  it("closes and reopens bold tags across split boundaries", () => {
    const html = "<b>" + "x".repeat(4090) + " continued</b>";
    const parts = splitMessage(html);
    expect(parts.length).toBeGreaterThan(1);
    // First part should have closing </b>
    expect(parts[0]).toContain("</b>");
    // Second part should reopen <b>
    expect(parts[1]).toMatch(/^<b>/);
  });

  it("handles nested tags across splits", () => {
    const html = "<b><i>" + "x".repeat(4090) + "</i></b>";
    const parts = splitMessage(html);
    expect(parts.length).toBeGreaterThan(1);
    // First part closes both tags
    expect(parts[0]).toContain("</i>");
    expect(parts[0]).toContain("</b>");
    // Second part reopens both
    expect(parts[1]).toMatch(/^<b><i>/);
  });

  it("does not add spurious tags when not needed", () => {
    const html = "<b>short</b>";
    const parts = splitMessage(html);
    expect(parts).toEqual(["<b>short</b>"]);
  });
});

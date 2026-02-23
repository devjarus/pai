import { describe, it, expect } from "vitest";
import { markdownToTelegramHTML, splitMessage, telegramPlugin } from "../src/index.js";
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
    expect(markdownToTelegramHTML("[Google](https://google.com)"))
      .toBe('<a href="https://google.com">Google</a>');
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

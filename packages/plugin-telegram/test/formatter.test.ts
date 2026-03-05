import { describe, it, expect } from "vitest";
import { formatBriefingHTML, escapeHTML, formatTelegramResponse, markdownToReportHTML } from "../src/formatter.js";
import type { BriefingSections } from "../src/formatter.js";

describe("escapeHTML", () => {
  it("escapes ampersand", () => {
    expect(escapeHTML("a & b")).toBe("a &amp; b");
  });

  it("escapes less-than", () => {
    expect(escapeHTML("a < b")).toBe("a &lt; b");
  });

  it("escapes greater-than", () => {
    expect(escapeHTML("a > b")).toBe("a &gt; b");
  });

  it("escapes all entities in a single string", () => {
    expect(escapeHTML("<script>alert('xss')</script> & more"))
      .toBe("&lt;script&gt;alert('xss')&lt;/script&gt; &amp; more");
  });

  it("returns unchanged string when no entities present", () => {
    expect(escapeHTML("Hello world")).toBe("Hello world");
  });

  it("handles empty string", () => {
    expect(escapeHTML("")).toBe("");
  });
});




describe("markdownToReportHTML", () => {
  it("renders headings, paragraphs, lists, links, blockquotes, and code", () => {
    const md = `# Title

Intro with **bold**, _italic_, ~~strike~~ and [link](https://example.com).

- one
- two

1. first
2. second

> quoted line

\`\`\`ts
const x = 1;
\`\`\``;

    const html = markdownToReportHTML(md);
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<p>Intro with <strong>bold</strong>, <em>italic</em>, <del>strike</del>");
    expect(html).toContain('<a href="https://example.com/" target="_blank" rel="noopener noreferrer">link</a>');
    expect(html).toContain("<ul>");
    expect(html).toContain("<ol>");
    expect(html).toContain("<blockquote>");
    expect(html).toContain('<pre><code class="language-ts">const x = 1;</code></pre>');
  });

  it("escapes unsafe html while preserving markdown formatting", () => {
    const html = markdownToReportHTML("<script>alert(1)</script> and **safe**");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("<strong>safe</strong>");
    expect(html).not.toContain("<script>");
  });

  it("drops unsafe link protocols", () => {
    const html = markdownToReportHTML("See [payload](javascript:alert1) now");
    expect(html).toContain("<p>See payload now</p>");
    expect(html).not.toContain("javascript:");
  });
});

describe("formatTelegramResponse", () => {
  it("formats raw JSON payloads into readable markdown sections", () => {
    const output = formatTelegramResponse('{"ticker":"AMZN","company":"Amazon","metrics":{"price":208.39},"risks":["Outage","Earnings miss"]}');
    expect(output).toContain("**AMZN — Amazon**");
    expect(output).toContain("**Metrics**");
    expect(output).toContain("- **Price:** 208.39");
    expect(output).toContain("**Risks**");
    expect(output).toContain("- Outage");
  });

  it("returns original text when response is not JSON", () => {
    const input = "Here is your analysis in markdown.";
    expect(formatTelegramResponse(input)).toBe(input);
  });

  it("returns original text for invalid JSON", () => {
    const input = '{"ticker":"AMZN"';
    expect(formatTelegramResponse(input)).toBe(input);
  });

  it("formats JSON arrays of objects as readable text, not raw JSON", () => {
    const input = JSON.stringify([
      { ticker: "AAPL", price: 185.5, change: "+2.3%" },
      { ticker: "MSFT", price: 412.0, change: "-0.5%" },
    ]);
    const output = formatTelegramResponse(input);
    expect(output).toContain("**Results**");
    expect(output).toContain("**Ticker:** AAPL");
    expect(output).toContain("**Price:** 185.5");
    expect(output).toContain("**Ticker:** MSFT");
    // Must NOT contain raw JSON
    expect(output).not.toContain('{"ticker"');
    expect(output).not.toContain('"price":');
  });


  it("formats prose followed by raw JSON into readable markdown", () => {
    const input = `Based on my research, here is the result.

{"topic":"Breaking News","summary":"Top story summary","sources":[{"title":"BBC","url":"https://example.com"}]}`;
    const output = formatTelegramResponse(input);
    expect(output).toContain("Based on my research, here is the result.");
    expect(output).toContain("**Analysis Summary**");
    expect(output).toContain("**Topic:** Breaking News");
    expect(output).toContain("**Sources**");
    expect(output).not.toContain('{"topic"');
  });

  it("formats fenced json blocks in mixed responses", () => {
    const input = `Research finished.

\`\`\`json
{"ticker":"AAPL","company":"Apple","metrics":{"price":210}}
\`\`\``;
    const output = formatTelegramResponse(input);
    expect(output).toContain("Research finished.");
    expect(output).toContain("**AAPL — Apple**");
    expect(output).toContain("**Metrics**");
    expect(output).not.toContain("```json");
  });

});
describe("formatBriefingHTML", () => {
  it("formats full sections with all fields", () => {
    const sections: BriefingSections = {
      greeting: "Good morning!",
      taskFocus: {
        summary: "3 tasks due today",
        items: [
          { title: "Deploy v2", priority: "high", insight: "Blocking the release" },
          { title: "Write docs", priority: "medium", insight: "Half done" },
          { title: "Update deps", priority: "low", insight: "" },
        ],
      },
      memoryInsights: {
        summary: "2 new insights",
        highlights: [
          { statement: "User prefers TypeScript", type: "preference", detail: "Mentioned 5 times" },
          { statement: "Project uses Vitest", type: "factual", detail: "Set up last week" },
        ],
      },
      suggestions: [
        { title: "Take a break", reason: "You've been working for 4 hours" },
        { title: "Review PRs", reason: "3 PRs awaiting review" },
      ],
    };

    const html = formatBriefingHTML(sections);

    // Greeting
    expect(html).toContain("<b>Good morning!</b>");

    // Tasks with priority icons
    expect(html).toContain("\uD83D\uDD34"); // red circle for high
    expect(html).toContain("<b>Deploy v2</b>");
    expect(html).toContain("<i>Blocking the release</i>");
    expect(html).toContain("\uD83D\uDFE1"); // yellow circle for medium
    expect(html).toContain("<b>Write docs</b>");
    expect(html).toContain("\uD83D\uDFE2"); // green circle for low
    expect(html).toContain("<b>Update deps</b>");
    expect(html).toContain("3 tasks due today");

    // Memory insights
    expect(html).toContain("<b>Memory Insights</b>");
    expect(html).toContain("2 new insights");
    expect(html).toContain("\uD83E\uDDE0"); // brain emoji
    expect(html).toContain("User prefers TypeScript");
    expect(html).toContain("<i>Mentioned 5 times</i>");

    // Suggestions
    expect(html).toContain("<b>Suggestions</b>");
    expect(html).toContain("<b>Take a break</b>");
    expect(html).toContain("You've been working for 4 hours");
  });

  it("formats with empty task items", () => {
    const sections: BriefingSections = {
      greeting: "Hello",
      taskFocus: { summary: "Nothing to do", items: [] },
      memoryInsights: { summary: "", highlights: [] },
      suggestions: [],
    };

    const html = formatBriefingHTML(sections);

    // Greeting should still be present
    expect(html).toContain("<b>Hello</b>");

    // No tasks/memory/suggestions sections rendered
    expect(html).not.toContain("<b>Tasks</b>");
    expect(html).not.toContain("<b>Memory Insights</b>");
    expect(html).not.toContain("<b>Suggestions</b>");
  });

  it("escapes HTML entities in section content", () => {
    const sections: BriefingSections = {
      greeting: "Hello <user> & friends",
      taskFocus: {
        summary: "Fix the <bug> & deploy",
        items: [
          { title: "Fix <script> injection", priority: "high", insight: "Use & escape" },
        ],
      },
      memoryInsights: { summary: "", highlights: [] },
      suggestions: [],
    };

    const html = formatBriefingHTML(sections);

    expect(html).toContain("Hello &lt;user&gt; &amp; friends");
    expect(html).toContain("Fix the &lt;bug&gt; &amp; deploy");
    expect(html).toContain("Fix &lt;script&gt; injection");
    expect(html).toContain("Use &amp; escape");
  });

  it("limits tasks to 5 items", () => {
    const sections: BriefingSections = {
      greeting: "Hi",
      taskFocus: {
        summary: "Many tasks",
        items: Array.from({ length: 8 }, (_, i) => ({
          title: `Task ${i + 1}`,
          priority: "low",
          insight: "",
        })),
      },
      memoryInsights: { summary: "", highlights: [] },
      suggestions: [],
    };

    const html = formatBriefingHTML(sections);

    expect(html).toContain("Task 5");
    expect(html).not.toContain("Task 6");
  });

  it("limits memory highlights to 3 items", () => {
    const sections: BriefingSections = {
      greeting: "Hi",
      taskFocus: { summary: "", items: [] },
      memoryInsights: {
        summary: "Many insights",
        highlights: Array.from({ length: 5 }, (_, i) => ({
          statement: `Insight ${i + 1}`,
          type: "factual",
          detail: "",
        })),
      },
      suggestions: [],
    };

    const html = formatBriefingHTML(sections);

    expect(html).toContain("Insight 3");
    expect(html).not.toContain("Insight 4");
  });

  it("limits suggestions to 3 items", () => {
    const sections: BriefingSections = {
      greeting: "Hi",
      taskFocus: { summary: "", items: [] },
      memoryInsights: { summary: "", highlights: [] },
      suggestions: Array.from({ length: 5 }, (_, i) => ({
        title: `Suggestion ${i + 1}`,
        reason: `Reason ${i + 1}`,
      })),
    };

    const html = formatBriefingHTML(sections);

    expect(html).toContain("Suggestion 3");
    expect(html).not.toContain("Suggestion 4");
  });

  it("skips insight line when insight is empty", () => {
    const sections: BriefingSections = {
      greeting: "Hi",
      taskFocus: {
        summary: "One task",
        items: [{ title: "Do something", priority: "high", insight: "" }],
      },
      memoryInsights: { summary: "", highlights: [] },
      suggestions: [],
    };

    const html = formatBriefingHTML(sections);

    expect(html).toContain("<b>Do something</b>");
    // No <i></i> with empty content after the task
    expect(html).not.toContain("<i></i>");
  });

  it("skips detail line when highlight detail is empty", () => {
    const sections: BriefingSections = {
      greeting: "Hi",
      taskFocus: { summary: "", items: [] },
      memoryInsights: {
        summary: "One insight",
        highlights: [{ statement: "A fact", type: "factual", detail: "" }],
      },
      suggestions: [],
    };

    const html = formatBriefingHTML(sections);

    expect(html).toContain("A fact");
    // No empty italic tag after the highlight
    const lines = html.split("\n");
    const factLine = lines.findIndex((l) => l.includes("A fact"));
    // Next non-empty line should not be an empty italic
    if (factLine >= 0 && factLine + 1 < lines.length) {
      expect(lines[factLine + 1]).not.toContain("<i></i>");
    }
  });
});

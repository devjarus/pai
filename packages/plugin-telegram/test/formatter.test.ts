import { describe, it, expect } from "vitest";
import { formatBriefingHTML, escapeHTML } from "../src/formatter.js";
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

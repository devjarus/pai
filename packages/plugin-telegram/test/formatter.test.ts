import { describe, it, expect } from "vitest";
import type { StandardBriefSection } from "@personal-ai/core";

import {
  formatBriefingHTML,
  buildTelegramDigestMarkdown,
  escapeHTML,
  formatTelegramResponse,
  markdownToReportHTML,
} from "../src/formatter.js";

describe("escapeHTML", () => {
  it("escapes ampersands and angle brackets", () => {
    expect(escapeHTML("<script>alert('xss')</script> & more"))
      .toBe("&lt;script&gt;alert('xss')&lt;/script&gt; &amp; more");
  });

  it("returns unchanged text when nothing needs escaping", () => {
    expect(escapeHTML("Hello world")).toBe("Hello world");
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
    expect(html).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">link</a>');
    expect(html).toContain("<ul>");
    expect(html).toContain("<ol>");
    expect(html).toContain("<blockquote>");
    expect(html).toContain('<pre><code class="language-ts">const x = 1;</code></pre>');
  });

  it("drops unsafe link protocols", () => {
    const html = markdownToReportHTML("See [payload](javascript:alert1) now");
    expect(html).toContain("<p>See payload now</p>");
    expect(html).not.toContain("javascript:");
  });
});

describe("formatTelegramResponse", () => {
  it("formats raw JSON payloads into readable markdown", () => {
    const output = formatTelegramResponse('{"ticker":"AMZN","company":"Amazon","metrics":{"price":208.39},"risks":["Outage","Earnings miss"]}');
    expect(output).toContain("**AMZN — Amazon**");
    expect(output).toContain("**Metrics**");
    expect(output).toContain("- **Price:** 208.39");
    expect(output).toContain("**Risks**");
    expect(output).toContain("- Outage");
  });

  it("formats mixed prose plus fenced JSON", () => {
    const input = `Research finished.

\`\`\`json
{"ticker":"AAPL","company":"Apple","metrics":{"price":210}}
\`\`\``;
    const output = formatTelegramResponse(input);
    expect(output).toContain("Research finished.");
    expect(output).toContain("**AAPL — Apple**");
    expect(output).not.toContain("```json");
  });
});

describe("formatBriefingHTML", () => {
  const sections: Pick<StandardBriefSection, "recommendation" | "what_changed" | "evidence" | "next_actions" | "correction_hook"> = {
    recommendation: {
      summary: "Buy the outbound fare in the next 24 hours.",
      confidence: "high",
      rationale: "The fare is inside your target band and inventory is tightening.",
    },
    what_changed: [
      "The tracked fare dropped by $112 overnight.",
      "Only two nonstop seats remain on the preferred itinerary.",
      "Alternative dates stayed flat.",
    ],
    evidence: [
      {
        title: "Fare change",
        detail: "SFO to DEL dropped from $1,084 to $972.",
        sourceLabel: "Flight scan",
      },
      {
        title: "Seat pressure",
        detail: "Preferred itinerary now shows only two seats left.",
        sourceLabel: "Inventory signal",
      },
    ],
    next_actions: [
      {
        title: "Buy outbound ticket",
        timing: "Today",
        detail: "Lock the nonstop outbound before the lower fare disappears.",
      },
      {
        title: "Hold return leg",
        timing: "Later",
        detail: "Keep watching the return until the fare drops under your threshold.",
      },
    ],
    correction_hook: {
      prompt: "If your date window changed, correct it so the next brief uses the right target.",
    },
  };

  it("formats a recommendation-first Telegram digest from the unified brief contract", () => {
    const html = formatBriefingHTML({
      title: "May ticket watch",
      label: "Research Complete",
      footer: "Full report attached as PDF.",
      sections,
    });

    expect(html).toContain("<b>Research Complete: May ticket watch</b>");
    expect(html).toContain("<b>Recommendation</b>");
    expect(html).toContain("Buy the outbound fare in the next 24 hours.");
    expect(html).toContain("<b>What changed</b>");
    expect(html).toContain("<b>Evidence</b>");
    expect(html).toContain("<b>Recommended moves</b>");
    expect(html).toContain("<b>Buy outbound ticket</b> (Today)");
    expect(html).toContain("<i>Full report attached as PDF.</i>");
  });

  it("limits optional sections and falls back to the correction hook when no footer is provided", () => {
    const html = formatBriefingHTML({
      title: "May ticket watch",
      sections,
      maxChanged: 1,
      maxEvidence: 1,
      maxActions: 1,
    });

    expect(html).toContain("The tracked fare dropped by $112 overnight.");
    expect(html).not.toContain("Alternative dates stayed flat.");
    expect(html).toContain("SFO to DEL dropped from $1,084 to $972.");
    expect(html).not.toContain("Seat pressure");
    expect(html).toContain("<b>Recommended move</b>");
    expect(html).not.toContain("Hold return leg");
    expect(html).toContain("If your date window changed, correct it so the next brief uses the right target.");
  });
});

describe("buildTelegramDigestMarkdown", () => {
  it("strips heavy blocks and adds a PDF note when the digest is truncated", () => {
    const digest = buildTelegramDigestMarkdown(
      `# Deep report

First section with the key conclusion.

| date | price |
| --- | --- |
| today | 972 |

\`\`\`jsonrender
{"spec":"huge"}
\`\`\`

\`\`\`json
{"raw":"payload"}
\`\`\`

Second section with the important rationale.

Third section with more details that should fall past the truncation point.
`,
      60,
    );

    expect(digest).toContain("First section with the key conclusion.");
    expect(digest).not.toContain("| date | price |");
    expect(digest).not.toContain("```jsonrender");
    expect(digest).not.toContain("```json");
    expect(digest).toContain("_Full response attached as PDF._");
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { artifactMigrations, createStorage, storeArtifact } from "../src/index.js";
import {
  buildReportPresentation,
  collectReportVisuals,
  deriveReportVisuals,
  extractPresentationBlocks,
  hasSubstantiveReportContent,
  mergeRenderSpecWithVisuals,
  parseVisualManifest,
  stripLeakedToolMarkup,
} from "../src/report-presentation.js";

describe("report presentation helpers", () => {
  let dir: string;
  let storage: ReturnType<typeof createStorage>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pai-report-presentation-"));
    storage = createStorage(dir);
    storage.migrate("artifacts", artifactMigrations);
  });

  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("extracts structured JSON and render spec fences from a report", () => {
    const blocks = extractPresentationBlocks(`
# Report

\`\`\`json
{"foo":"bar"}
\`\`\`

\`\`\`jsonrender
{"root":"r","elements":{"r":{"type":"Section","props":{"title":"Hello","subtitle":null,"collapsible":false,"defaultOpen":true},"children":[]}}}
\`\`\`
    `);

    expect(blocks.structuredResult).toBe('{"foo":"bar"}');
    expect(blocks.renderSpec).toContain('"root":"r"');
    expect(blocks.report).toBe("# Report");
  });

  it("extracts raw JSON (no code fences) as structuredResult with markdown fallback", () => {
    const rawJson = JSON.stringify({
      topic: "Global Conflict Escalation",
      summary: "The conflict has escalated dramatically.",
      articles: [
        {
          title: "Daily Report: Second Iran War",
          source: "Israel-Alma",
          url: "https://example.com/report",
          date: "2026-03-17",
          keyPoints: ["Iran attacked 7+ cities", "UAE intercepted missiles"],
        },
      ],
      timeline: [
        { date: "2026-03-15", event: "Iran launches missile attacks" },
      ],
      sources: [
        { title: "Reuters", url: "https://reuters.com" },
      ],
    });

    const blocks = extractPresentationBlocks(rawJson);

    expect(blocks.structuredResult).toBe(rawJson);
    expect(blocks.report).toContain("# Global Conflict Escalation");
    expect(blocks.report).toContain("The conflict has escalated dramatically.");
    expect(blocks.report).toContain("Daily Report: Second Iran War");
    expect(blocks.report).toContain("Iran attacked 7+ cities");
    expect(blocks.report).toContain("2026-03-15");
    expect(blocks.report).toContain("[Reuters](https://reuters.com)");
  });

  it("repairs truncated news JSON and converts it to markdown", () => {
    const truncated = `{
  "topic": "Future of AI and its Impact",
  "summary": "AI continues to reshape software development.",
  "articles": [
    {
      "title": "IBM Advances Enterprise AI",
      "source": "IBM Newsroom",
      "決済URL": "https://newsroom.ibm.com/ai",
      "date": "2026-07-09",
      "keyPoints": [
        "Enterprise tools now include copilots",
        "Code-generation is effectively a commodity"
      ]
    },
    {
      "title": "AI Tools Accelerates Coding",
      "source"`;

    const blocks = extractPresentationBlocks(truncated);

    expect(blocks.structuredResult).toBeTruthy();
    expect(blocks.report).toContain("# Future of AI and its Impact");
    expect(blocks.report).toContain("AI continues to reshape software development.");
    expect(blocks.report).toContain("IBM Advances Enterprise AI");
    expect(blocks.report).toContain("[Read more](https://newsroom.ibm.com/ai)");
    expect(blocks.report).toContain("Enterprise tools now include copilots");
    expect(blocks.report).not.toContain('"決済URL"');
    expect(blocks.report.trim().startsWith("{")).toBe(false);
  });

  it("strips leaked tool_call markup from research report text", () => {
    const leaked = `Let me search for the latest developments on AI's impact on software since July 24th, 2026.
<tool_call>web_search <arg_key>query</arg_key><arg_value>AI changing software development 2026 latest news</arg_value><arg_key>num</arg_key><arg_value>10</arg_value>
<tool_call>web_search <arg_key>query</arg_key><arg_value>AI coding agents software engineering 2026</arg_value><arg_key>num</arg_key><arg_value>10</arg_value>
<tool_call>web_search <arg_key>query</arg_key><arg_value>AI impact on software industry trends July 2026</arg_value><arg_key>num</arg_key><arg_value>10</arg_value>

## Key Findings

Enterprise coding agents moved from demos into production workflows.`;

    const blocks = extractPresentationBlocks(leaked);
    expect(blocks.report).toContain("## Key Findings");
    expect(blocks.report).toContain("Enterprise coding agents moved from demos into production workflows.");
    expect(blocks.report).not.toContain("<tool_call>");
    expect(blocks.report).not.toContain("<arg_key>");
    expect(blocks.report).not.toContain("<arg_value>");
    expect(blocks.report).not.toContain("AI changing software development 2026 latest news");
  });

  it("treats tool-call-only reports as non-substantive", () => {
    const leaked = `Let me search for updates.
<tool_call>web_search <arg_key>query</arg_key><arg_value>AI news</arg_value><arg_key>num</arg_key><arg_value>10</arg_value>`;
    expect(stripLeakedToolMarkup(leaked)).toContain("Let me search");
    expect(hasSubstantiveReportContent(leaked)).toBe(false);
  });

  it("does not extract non-report JSON as structuredResult", () => {
    const blocks = extractPresentationBlocks('{"random": "data", "count": 42}');
    expect(blocks.structuredResult).toBeUndefined();
    expect(blocks.report).toContain('"random"');
  });

  it("parses visuals.json manifests", () => {
    const visuals = parseVisualManifest(JSON.stringify({
      visuals: [
        {
          file: "trend.png",
          title: "7-day trend",
          caption: "Orders by day",
          kind: "chart",
          order: 2,
        },
      ],
    }));

    expect(visuals).toEqual([
      {
        file: "trend.png",
        title: "7-day trend",
        caption: "Orders by day",
        kind: "chart",
        order: 2,
      },
    ]);
  });

  it("collects visuals from manifest data and falls back to image filenames", () => {
    const visuals = collectReportVisuals(
      [
        { id: "a1", jobId: "job-1", name: "trend.png", mimeType: "image/png", size: 10, createdAt: "now" },
        { id: "a2", jobId: "job-1", name: "balance_sheet.png", mimeType: "image/png", size: 10, createdAt: "now" },
      ],
      [
        JSON.stringify({
          visuals: [
            { file: "trend.png", title: "7-day trend", caption: "Orders by day", kind: "chart", order: 5 },
          ],
        }),
      ],
    );

    expect(visuals).toEqual([
      {
        artifactId: "a1",
        mimeType: "image/png",
        kind: "chart",
        title: "7-day trend",
        caption: "Orders by day",
        order: 5,
      },
      {
        artifactId: "a2",
        mimeType: "image/png",
        kind: "image",
        title: "Balance Sheet",
        order: 6,
      },
    ]);
  });

  it("derives visuals from stored job artifacts and visuals.json", () => {
    const pngData = Buffer.from("png");
    storeArtifact(storage, dir, {
      jobId: "job-1",
      name: "trend.png",
      mimeType: "image/png",
      data: pngData,
    });
    const imageId = storeArtifact(storage, dir, {
      jobId: "job-1",
      name: "heatmap.png",
      mimeType: "image/png",
      data: pngData,
    });
    storeArtifact(storage, dir, {
      jobId: "job-1",
      name: "visuals.json",
      mimeType: "application/json",
      data: Buffer.from(JSON.stringify({
        visuals: [{ file: "trend.png", title: "Named visual", order: 1 }],
      }), "utf-8"),
    });

    const visuals = deriveReportVisuals(storage, "job-1");
    expect(visuals).toHaveLength(2);
    expect(visuals[0]?.title).toBe("Named visual");
    expect(visuals[1]?.artifactId).toBe(imageId);
  });

  it("merges a charts section into specs that do not reference visuals", () => {
    const merged = mergeRenderSpecWithVisuals(
      "# Report",
      JSON.stringify({
        root: "report",
        elements: {
          report: {
            type: "Section",
            props: { title: "Report", subtitle: null, collapsible: false, defaultOpen: true },
            children: ["body"],
          },
          body: {
            type: "Markdown",
            props: { content: "# Report" },
          },
        },
      }),
      [
        {
          artifactId: "art-1",
          mimeType: "image/png",
          kind: "chart",
          title: "Trend",
          order: 1,
        },
      ],
      "analysis",
    );

    expect(merged).toContain("generated-charts-section");
    expect(merged).toContain("/api/artifacts/art-1");
  });

  it("keeps specs that already reference a visual", () => {
    const spec = JSON.stringify({
      root: "report",
      elements: {
        report: {
          type: "Section",
          props: { title: "Report", subtitle: null, collapsible: false, defaultOpen: true },
          children: ["chart"],
        },
        chart: {
          type: "ChartImage",
          props: { src: "/api/artifacts/art-1", alt: "Trend", caption: null },
        },
      },
    });

    const merged = mergeRenderSpecWithVisuals(
      "# Report",
      spec,
      [
        {
          artifactId: "art-1",
          mimeType: "image/png",
          kind: "chart",
          title: "Trend",
          order: 1,
        },
      ],
      "analysis",
    );

    expect(merged).toBe(spec);
  });

  it("builds a fallback presentation when no valid render spec exists", () => {
    const presentation = buildReportPresentation({
      report: "# Report",
      visuals: [
        {
          artifactId: "art-1",
          mimeType: "image/png",
          kind: "chart",
          title: "Trend",
          order: 1,
        },
      ],
      resultType: "stock",
      execution: "analysis",
    });

    expect(presentation.execution).toBe("analysis");
    expect(presentation.resultType).toBe("stock");
    expect(presentation.renderSpec).toContain("Analysis Report");
    expect(presentation.renderSpec).toContain("/api/artifacts/art-1");
  });
});

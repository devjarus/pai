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
  mergeRenderSpecWithVisuals,
  parseVisualManifest,
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

import { describe, expect, it } from "vitest";
import {
  artifactReferencesToVisuals,
  buildVisualResultSpec,
  extractPresentationBlocks,
} from "../src/lib/report-presentation";

describe("extractPresentationBlocks", () => {
  it("extracts markdown, structured data, and render spec", () => {
    const input = `## Summary

Here is the analysis.

\`\`\`json
{"ticker":"NVDA"}
\`\`\`

\`\`\`jsonrender
{"root":"report","elements":{"report":{"type":"Section","props":{"title":"Report"},"children":[]}}}
\`\`\``;

    expect(extractPresentationBlocks(input)).toEqual({
      markdown: "## Summary\n\nHere is the analysis.",
      structuredResult: '{"ticker":"NVDA"}',
      renderSpec:
        '{"root":"report","elements":{"report":{"type":"Section","props":{"title":"Report"},"children":[]}}}',
    });
  });

  it("leaves invalid render specs in markdown", () => {
    const input = `Hello

\`\`\`jsonrender
{"elements":{}}
\`\`\``;

    expect(extractPresentationBlocks(input)).toEqual({
      markdown: input,
    });
  });
});

describe("artifactReferencesToVisuals", () => {
  it("converts only image artifacts into visuals", () => {
    const visuals = artifactReferencesToVisuals([
      { id: "img-1", name: "price-chart.jpg", mimeType: "image/jpeg" },
      { id: "file-1", name: "notes.csv", mimeType: "text/csv" },
      { id: "img-2", name: "overview.png", mimeType: "image/png" },
    ]);

    expect(visuals).toEqual([
      {
        artifactId: "img-2",
        mimeType: "image/png",
        kind: "image",
        title: "Overview",
        order: 1,
      },
      {
        artifactId: "img-1",
        mimeType: "image/jpeg",
        kind: "chart",
        title: "Price Chart",
        order: 2,
      },
    ]);
  });
});

describe("buildVisualResultSpec", () => {
  it("creates a grid-backed spec for multiple visuals", () => {
    const spec = buildVisualResultSpec({
      title: "Generated visuals",
      subtitle: "Sandbox output",
      visuals: [
        {
          artifactId: "a1",
          mimeType: "image/png",
          kind: "chart",
          title: "First chart",
          order: 1,
        },
        {
          artifactId: "a2",
          mimeType: "image/png",
          kind: "chart",
          title: "Second chart",
          order: 2,
        },
      ],
    });

    expect(spec).toEqual({
      root: "visual-root",
      elements: {
        "visual-1": {
          type: "ChartImage",
          props: {
            src: "/api/artifacts/a1",
            alt: "First chart",
            caption: null,
          },
        },
        "visual-2": {
          type: "ChartImage",
          props: {
            src: "/api/artifacts/a2",
            alt: "Second chart",
            caption: null,
          },
        },
        "visual-root": {
          type: "Section",
          props: {
            title: "Generated visuals",
            subtitle: "Sandbox output",
            collapsible: false,
            defaultOpen: true,
          },
          children: ["visual-grid"],
        },
        "visual-grid": {
          type: "Grid",
          props: {
            columns: 2,
            gap: "md",
          },
          children: ["visual-1", "visual-2"],
        },
      },
    });
  });
});

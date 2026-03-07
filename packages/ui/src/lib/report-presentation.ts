import type { ArtifactReference, ReportVisual } from "@/types";

interface JsonRenderElement {
  type: string;
  props?: Record<string, unknown>;
  children?: string[];
}

interface JsonRenderSpec {
  root: string;
  elements: Record<string, JsonRenderElement>;
}

export interface ExtractedPresentationBlocks {
  markdown: string;
  structuredResult?: string;
  renderSpec?: string;
}

function parseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function isJsonRenderSpec(value: unknown): value is JsonRenderSpec {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<JsonRenderSpec>;
  return (
    typeof candidate.root === "string" &&
    candidate.root.length > 0 &&
    !!candidate.elements &&
    typeof candidate.elements === "object"
  );
}

function trimMarkdown(markdown: string): string {
  return markdown.trim().replace(/\n{3,}/g, "\n\n");
}

export function extractPresentationBlocks(text: string): ExtractedPresentationBlocks {
  let markdown = text ?? "";
  let structuredResult: string | undefined;
  let renderSpec: string | undefined;

  const specMatch = markdown.match(/```jsonrender\s*([\s\S]*?)```/i);
  if (specMatch?.[1]) {
    const candidate = specMatch[1].trim();
    if (isJsonRenderSpec(parseJson<JsonRenderSpec>(candidate))) {
      renderSpec = candidate;
      markdown = markdown.replace(/```jsonrender\s*[\s\S]*?```/i, "").trim();
    }
  }

  const jsonMatch = markdown.match(/```json\s*([\s\S]*?)```/i);
  if (jsonMatch?.[1]) {
    const candidate = jsonMatch[1].trim();
    if (parseJson<unknown>(candidate) !== null) {
      structuredResult = candidate;
      markdown = markdown.replace(/```json\s*[\s\S]*?```/i, "").trim();
    }
  }

  return {
    markdown: trimMarkdown(markdown),
    ...(structuredResult ? { structuredResult } : {}),
    ...(renderSpec ? { renderSpec } : {}),
  };
}

function inferVisualKind(name: string): "chart" | "image" {
  return /(chart|graph|plot|trend|price|forecast|volume|compare)/i.test(name)
    ? "chart"
    : "image";
}

function titleFromFilename(name: string): string {
  const withoutExt = name.replace(/\.[^.]+$/, "");
  const normalized = withoutExt
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "Visual";
  return normalized.replace(/\b\w/g, (match) => match.toUpperCase());
}

export function artifactReferencesToVisuals(artifacts: ArtifactReference[]): ReportVisual[] {
  return artifacts
    .filter((artifact) => artifact.mimeType.startsWith("image/"))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((artifact, index) => ({
      artifactId: artifact.id,
      mimeType: artifact.mimeType,
      kind: inferVisualKind(artifact.name),
      title: titleFromFilename(artifact.name),
      order: index + 1,
    }));
}

export function buildVisualResultSpec(input: {
  title: string;
  subtitle?: string;
  visuals: ReportVisual[];
}): JsonRenderSpec | undefined {
  if (input.visuals.length === 0) return undefined;

  const elements: JsonRenderSpec["elements"] = {};
  const visualIds = input.visuals.map((visual, index) => {
    const id = `visual-${index + 1}`;
    elements[id] = {
      type: "ChartImage",
      props: {
        src: `/api/artifacts/${visual.artifactId}`,
        alt: visual.title,
        caption: visual.caption ?? null,
      },
    };
    return id;
  });

  const rootChildren =
    visualIds.length > 1
      ? ["visual-grid"]
      : visualIds;

  elements["visual-root"] = {
    type: "Section",
    props: {
      title: input.title,
      subtitle: input.subtitle ?? null,
      collapsible: false,
      defaultOpen: true,
    },
    children: rootChildren,
  };

  if (visualIds.length > 1) {
    elements["visual-grid"] = {
      type: "Grid",
      props: {
        columns: 2,
        gap: "md",
      },
      children: visualIds,
    };
  }

  return {
    root: "visual-root",
    elements,
  };
}

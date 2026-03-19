import { getArtifact, listArtifacts } from "./artifacts.js";
import type { ArtifactMeta } from "./artifacts.js";
import type { Storage } from "./types.js";

export type ReportExecution = "research" | "analysis";

export interface ReportVisual {
  artifactId: string;
  mimeType: string;
  kind: "chart" | "image";
  title: string;
  caption?: string;
  order: number;
}

export interface ReportPresentation {
  report: string;
  structuredResult?: string;
  renderSpec?: string;
  visuals: ReportVisual[];
  resultType: string;
  execution: ReportExecution;
}

interface VisualManifestEntry {
  file: string;
  title?: string;
  caption?: string;
  kind?: "chart" | "image";
  order?: number;
}

interface VisualManifest {
  visuals?: VisualManifestEntry[];
}

interface JsonRenderSpec {
  root: string;
  elements: Record<string, {
    type: string;
    props?: Record<string, unknown>;
    children?: string[];
  }>;
}

function parseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function parseJsonRenderSpec(spec: string | undefined): JsonRenderSpec | null {
  if (!spec) return null;
  const parsed = parseJson<JsonRenderSpec>(spec);
  if (!parsed || typeof parsed !== "object") return null;
  if (typeof parsed.root !== "string" || !parsed.root) return null;
  if (!parsed.elements || typeof parsed.elements !== "object") return null;
  return parsed;
}

function trimReport(report: string): string {
  return report.trim().replace(/\n{3,}/g, "\n\n");
}

/** Convert structured JSON (news/research) into readable markdown when LLM forgot code fences. */
function structuredJsonToMarkdown(data: Record<string, unknown>): string {
  const lines: string[] = [];
  const topic = data.topic ?? data.title ?? "Research Report";
  const summary = data.summary ?? data.description ?? "";

  lines.push(`# ${topic}`);
  if (summary) lines.push("", String(summary));

  // Articles / findings array
  const items = (data.articles ?? data.findings ?? data.results) as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(items) && items.length > 0) {
    lines.push("", "## Key Findings");
    for (const item of items) {
      const title = item.title ?? item.name ?? "Untitled";
      const source = item.source ?? "";
      const url = item.url ?? "";
      const keyPoints = item.keyPoints as string[] | undefined;
      lines.push("", `### ${title}`);
      if (source) lines.push(`*Source: ${source}*`);
      if (url) lines.push(`[Read more](${url})`);
      if (Array.isArray(keyPoints)) {
        for (const point of keyPoints) lines.push(`- ${point}`);
      }
    }
  }

  // Timeline
  const timeline = data.timeline as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(timeline) && timeline.length > 0) {
    lines.push("", "## Timeline");
    for (const event of timeline) {
      lines.push(`- **${event.date}** — ${event.event}`);
    }
  }

  // Sources
  const sources = data.sources as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(sources) && sources.length > 0) {
    lines.push("", "## Sources");
    for (const src of sources) {
      const title = src.title ?? src.name ?? "Source";
      const url = src.url ?? "";
      lines.push(url ? `- [${title}](${url})` : `- ${title}`);
    }
  }

  return lines.join("\n");
}

function inferVisualKind(name: string): "chart" | "image" {
  return /(chart|graph|plot|trend|price|forecast|volume|compare)/i.test(name) ? "chart" : "image";
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

function artifactUrl(artifactId: string): string {
  return `/api/artifacts/${artifactId}`;
}

function referencedArtifactIds(spec: JsonRenderSpec | null): Set<string> {
  const ids = new Set<string>();
  if (!spec) return ids;

  for (const element of Object.values(spec.elements)) {
    const props = element.props ?? {};
    const src = typeof props.src === "string" ? props.src : null;
    const url = typeof props.url === "string" ? props.url : null;

    for (const candidate of [src, url]) {
      if (!candidate) continue;
      const match = candidate.match(/\/api\/artifacts\/([^/?#]+)/);
      if (match?.[1]) ids.add(match[1]);
    }
  }

  return ids;
}

function appendVisualSection(spec: JsonRenderSpec, visuals: ReportVisual[]): JsonRenderSpec {
  const cloned: JsonRenderSpec = JSON.parse(JSON.stringify(spec)) as JsonRenderSpec;
  const rootElement = cloned.elements[cloned.root];
  if (!rootElement) return spec;

  const sectionId = "generated-charts-section";
  const gridId = "generated-charts-grid";
  if (cloned.elements[sectionId]) return cloned;

  const children = Array.isArray(rootElement.children) ? [...rootElement.children] : [];
  children.push(sectionId);
  rootElement.children = children;

  const visualIds: string[] = [];
  visuals.forEach((visual, index) => {
    const visualId = `generated-chart-${index + 1}`;
    visualIds.push(visualId);
    cloned.elements[visualId] = {
      type: "ChartImage",
      props: {
        src: artifactUrl(visual.artifactId),
        alt: visual.title,
        caption: visual.caption ?? null,
      },
    };
  });

  const sectionChildren =
    visualIds.length > 1
      ? [gridId]
      : visualIds;

  cloned.elements[sectionId] = {
    type: "Section",
    props: {
      title: "Charts",
      subtitle: null,
      collapsible: false,
      defaultOpen: true,
    },
    children: sectionChildren,
  };

  if (visualIds.length > 1) {
    cloned.elements[gridId] = {
      type: "Grid",
      props: { columns: 2, gap: "md" },
      children: visualIds,
    };
  }

  return cloned;
}

function buildFallbackSpec(report: string, visuals: ReportVisual[], execution: ReportExecution): JsonRenderSpec {
  const title = execution === "analysis" ? "Analysis Report" : "Research Report";
  const children = ["report-markdown"];
  const elements: JsonRenderSpec["elements"] = {
    "report-root": {
      type: "Section",
      props: {
        title,
        subtitle: null,
        collapsible: false,
        defaultOpen: true,
      },
      children,
    },
    "report-markdown": {
      type: "Markdown",
      props: { content: report },
    },
  };

  if (visuals.length > 0) {
    const sectionId = "report-charts-section";
    const gridId = "report-charts-grid";
    const visualIds: string[] = [];

    visuals.forEach((visual, index) => {
      const visualId = `report-chart-${index + 1}`;
      visualIds.push(visualId);
      elements[visualId] = {
        type: "ChartImage",
        props: {
          src: artifactUrl(visual.artifactId),
          alt: visual.title,
          caption: visual.caption ?? null,
        },
      };
    });

    elements[sectionId] = {
      type: "Section",
      props: {
        title: "Charts",
        subtitle: null,
        collapsible: false,
        defaultOpen: true,
      },
      children: visualIds.length > 1 ? [gridId] : visualIds,
    };

    if (visualIds.length > 1) {
      elements[gridId] = {
        type: "Grid",
        props: { columns: 2, gap: "md" },
        children: visualIds,
      };
    }

    children.push(sectionId);
  }

  return { root: "report-root", elements };
}

export function extractPresentationBlocks(text: string): {
  report: string;
  structuredResult?: string;
  renderSpec?: string;
} {
  let report = text ?? "";
  let structuredResult: string | undefined;
  let renderSpec: string | undefined;

  const jsonMatch = report.match(/```json\s*([\s\S]*?)```/);
  if (jsonMatch?.[1]) {
    const candidate = jsonMatch[1].trim();
    if (parseJson<unknown>(candidate) !== null) {
      structuredResult = candidate;
      report = report.replace(/```json\s*[\s\S]*?```/, "").trim();
    }
  }

  const specMatch = report.match(/```jsonrender\s*([\s\S]*?)```/);
  if (specMatch?.[1]) {
    const candidate = specMatch[1].trim();
    if (parseJsonRenderSpec(candidate)) {
      renderSpec = candidate;
      report = report.replace(/```jsonrender\s*[\s\S]*?```/, "").trim();
    }
  }

  // Strip any remaining json/jsonrender fenced blocks (LLM sometimes produces multiples)
  report = report.replace(/```(?:json|jsonrender)\s*[\s\S]*?```/g, "");

  // Strip leftover section headings that were just labels for the extracted blocks
  report = report.replace(/^#{1,4}\s*(?:Part\s*\d+[:\s]*)?(?:Render(?:ed)?\s*Spec|Structured\s*(?:Data|Result)|JSON\s*(?:Data|Output|Render))\s*$/gim, "");

  // Strip LLM-echoed instruction text about the render spec
  report = report.replace(/^(?:Fill in (?:the )?actual values|IMPORTANT:.*Fill in|Available components:).*$/gim, "");

  // If the report is raw JSON (LLM forgot code fences), extract it as structuredResult
  // and generate a readable markdown summary so the UI has something to render
  if (!structuredResult) {
    const trimmed = report.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      const parsed = parseJson<Record<string, unknown>>(trimmed);
      if (parsed && (parsed.topic || parsed.summary || parsed.articles || parsed.ticker || parsed.findings)) {
        structuredResult = trimmed;
        report = structuredJsonToMarkdown(parsed);
      }
    }
  }

  return { report: trimReport(report), structuredResult, renderSpec };
}

export function parseVisualManifest(manifestText: string): VisualManifestEntry[] {
  const parsed = parseJson<VisualManifest>(manifestText);
  if (!parsed?.visuals || !Array.isArray(parsed.visuals)) return [];

  return parsed.visuals
    .filter((entry): entry is VisualManifestEntry => !!entry && typeof entry.file === "string")
    .map((entry, index) => ({
      file: entry.file,
      title: typeof entry.title === "string" ? entry.title : undefined,
      caption: typeof entry.caption === "string" ? entry.caption : undefined,
      kind: entry.kind === "image" ? "image" : "chart",
      order: typeof entry.order === "number" ? entry.order : index + 1,
    }));
}

export function collectReportVisuals(
  artifacts: ArtifactMeta[],
  manifestTexts: string[] = [],
): ReportVisual[] {
  const manifestEntries = manifestTexts.flatMap(parseVisualManifest);
  const safeArtifacts = artifacts.filter(
    (artifact): artifact is ArtifactMeta =>
      !!artifact &&
      typeof artifact.id === "string" &&
      typeof artifact.name === "string" &&
      typeof artifact.mimeType === "string",
  );
  const imageArtifacts = safeArtifacts.filter(
    (artifact) =>
      artifact.mimeType.startsWith("image/") &&
      !artifact.name.toLowerCase().endsWith("visuals.json"),
  );
  const artifactByName = new Map(
    imageArtifacts.map((artifact) => [artifact.name.toLowerCase(), artifact]),
  );

  const visuals: ReportVisual[] = [];
  const usedIds = new Set<string>();

  manifestEntries.forEach((entry, index) => {
    const artifact = artifactByName.get(entry.file.toLowerCase());
    if (!artifact) return;
    usedIds.add(artifact.id);
    visuals.push({
      artifactId: artifact.id,
      mimeType: artifact.mimeType,
      kind: entry.kind ?? inferVisualKind(artifact.name),
      title: entry.title?.trim() || titleFromFilename(artifact.name),
      caption: entry.caption?.trim() || undefined,
      order: entry.order ?? index + 1,
    });
  });

  const maxManifestOrder = manifestEntries.reduce(
    (max, entry) => Math.max(max, entry.order ?? 0),
    0,
  );

  imageArtifacts
    .filter((artifact) => !usedIds.has(artifact.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((artifact, index) => {
      visuals.push({
        artifactId: artifact.id,
        mimeType: artifact.mimeType,
        kind: inferVisualKind(artifact.name),
        title: titleFromFilename(artifact.name),
        order: maxManifestOrder + index + 1,
      });
    });

  return visuals.sort((a, b) => a.order - b.order);
}

export function deriveReportVisuals(storage: Storage, jobId: string): ReportVisual[] {
  try {
    const artifacts = listArtifacts(storage, jobId);
    const manifestTexts = artifacts
      .filter((artifact) => typeof artifact.name === "string" && artifact.name.toLowerCase().endsWith("visuals.json"))
      .map((artifact) => getArtifact(storage, artifact.id)?.data.toString("utf-8"))
      .filter((manifest): manifest is string => typeof manifest === "string" && manifest.length > 0);

    return collectReportVisuals(artifacts, manifestTexts);
  } catch {
    return [];
  }
}

export function mergeRenderSpecWithVisuals(
  report: string,
  renderSpec: string | undefined,
  visuals: ReportVisual[],
  execution: ReportExecution,
): string | undefined {
  const parsed = parseJsonRenderSpec(renderSpec);
  if (parsed) {
    const referenced = referencedArtifactIds(parsed);
    if (visuals.some((visual) => referenced.has(visual.artifactId))) {
      return JSON.stringify(parsed);
    }
    if (visuals.length === 0) {
      return JSON.stringify(parsed);
    }
    return JSON.stringify(appendVisualSection(parsed, visuals));
  }

  if (!report && visuals.length === 0) return undefined;
  return JSON.stringify(buildFallbackSpec(report, visuals, execution));
}

export function buildReportPresentation(input: {
  report: string;
  structuredResult?: string;
  renderSpec?: string;
  visuals?: ReportVisual[];
  resultType?: string;
  execution: ReportExecution;
}): ReportPresentation {
  const visuals = [...(input.visuals ?? [])].sort((a, b) => a.order - b.order);
  const report = trimReport(input.report);
  const mergedSpec = mergeRenderSpecWithVisuals(report, input.renderSpec, visuals, input.execution);

  return {
    report,
    ...(input.structuredResult ? { structuredResult: input.structuredResult } : {}),
    ...(mergedSpec ? { renderSpec: mergedSpec } : {}),
    visuals,
    resultType: input.resultType ?? "general",
    execution: input.execution,
  };
}

export function getReferencedVisualsFromSpec(
  spec: string | undefined,
  visuals: ReportVisual[],
): ReportVisual[] {
  const parsed = parseJsonRenderSpec(spec);
  const referenced = referencedArtifactIds(parsed);
  return visuals.filter((visual) => referenced.has(visual.artifactId));
}

import { Renderer, StateProvider, ActionProvider, VisibilityProvider } from "@json-render/react";
import type { Spec, StateModel } from "@json-render/react";
import { registry, handlers } from "../../lib/render-registry";
import MarkdownContent from "../MarkdownContent";
import { AlertTriangle } from "lucide-react";
import { useState, useCallback, useRef, type ReactNode } from "react";
import type { ReportVisual } from "@/types";
import { VisualGallery } from "./VisualGallery";

interface ResultRendererProps {
  /** json-render spec from LLM (parsed JSON object or JSON string) */
  spec?: unknown;
  /** Structured result data (flight/stock/etc JSON) */
  structuredResult?: unknown;
  /** Markdown report fallback */
  markdown?: string;
  /** Result type for context */
  resultType?: string;
  /** Persisted chart/image visuals */
  visuals?: ReportVisual[];
  /** Show debug info */
  debug?: boolean;
}

function getReferencedArtifactIds(spec: Spec | null): Set<string> {
  const ids = new Set<string>();
  if (!spec) return ids;

  for (const element of Object.values(spec.elements)) {
    const props = (element as { props?: Record<string, unknown> }).props ?? {};
    for (const candidate of [props.src, props.url]) {
      if (typeof candidate !== "string") continue;
      const match = candidate.match(/\/api\/artifacts\/([^/?#]+)/);
      if (match?.[1]) ids.add(match[1]);
    }
  }

  return ids;
}

/**
 * Parse and validate a json-render spec from unknown input.
 * Returns null if the input is not a valid spec.
 */
function parseSpec(spec: unknown): Spec | null {
  if (!spec) return null;
  try {
    const obj =
      typeof spec === "string" ? JSON.parse(spec) : (spec as Record<string, unknown>);
    if (obj && typeof obj === "object" && "root" in obj && "elements" in obj) {
      return obj as Spec;
    }
  } catch {
    // invalid JSON string
  }
  return null;
}

/**
 * Detect raw JSON report text and convert to readable markdown.
 * Handles cases where the LLM output JSON without code fences.
 */
function sanitizeMarkdown(text: string | undefined): string | undefined {
  if (!text) return text;
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return text;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    // Only convert known report structures (news, research, etc.)
    if (!parsed.topic && !parsed.summary && !parsed.articles && !parsed.ticker && !parsed.findings) {
      return text;
    }
    const lines: string[] = [];
    const topic = (parsed.topic ?? parsed.title ?? "Research Report") as string;
    const summary = (parsed.summary ?? parsed.description ?? "") as string;
    lines.push(`# ${topic}`);
    if (summary) lines.push("", summary);

    const items = (parsed.articles ?? parsed.findings ?? parsed.results) as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(items) && items.length > 0) {
      lines.push("", "## Key Findings");
      for (const item of items) {
        lines.push("", `### ${item.title ?? "Untitled"}`);
        if (item.source) lines.push(`*Source: ${item.source as string}*`);
        if (item.url) lines.push(`[Read more](${item.url as string})`);
        const keyPoints = item.keyPoints as string[] | undefined;
        if (Array.isArray(keyPoints)) {
          for (const point of keyPoints) lines.push(`- ${point}`);
        }
      }
    }

    const timeline = parsed.timeline as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(timeline) && timeline.length > 0) {
      lines.push("", "## Timeline");
      for (const event of timeline) lines.push(`- **${event.date as string}** — ${event.event as string}`);
    }

    const sources = parsed.sources as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(sources) && sources.length > 0) {
      lines.push("", "## Sources");
      for (const src of sources) {
        const title = (src.title ?? src.name ?? "Source") as string;
        const url = src.url as string | undefined;
        lines.push(url ? `- [${title}](${url})` : `- ${title}`);
      }
    }

    return lines.join("\n");
  } catch {
    return text;
  }
}

/**
 * Universal result renderer with fallback chain:
 * 1. json-render spec -> <Renderer />
 * 2. markdown -> <MarkdownContent />
 * 3. Nothing -> empty message
 *
 * Never shows raw JSON to users (unless debug mode).
 */
export function ResultRenderer({
  spec,
  structuredResult,
  markdown: rawMarkdown,
  resultType,
  visuals = [],
  debug,
}: ResultRendererProps) {
  const markdown = sanitizeMarkdown(rawMarkdown);
  const [showDebug, setShowDebug] = useState(false);
  const stateRef = useRef<StateModel>({});
  const setStateRef = useRef<
    ((updater: (prev: Record<string, unknown>) => Record<string, unknown>) => void) | undefined
  >(undefined);

  // StateProvider onStateChange callback — keep stateRef in sync
  const handleStateChange = useCallback(
    (changes: Array<{ path: string; value: unknown }>) => {
      const next = { ...stateRef.current };
      for (const { path, value } of changes) {
        next[path] = value;
      }
      stateRef.current = next;
    },
    [],
  );

  // Build ActionProvider-compatible handlers using the registry's handler factory.
  // The factory expects getter functions so handlers always read the latest state.
  const actionHandlers = handlers(
    () => setStateRef.current,
    () => stateRef.current,
  );

  const parsedSpec = parseSpec(spec);
  const referencedArtifactIds = getReferencedArtifactIds(parsedSpec);
  const remainingVisuals = visuals.filter((visual) => !referencedArtifactIds.has(visual.artifactId));

  // Determine which content to render via the fallback chain
  let content: ReactNode;
  if (parsedSpec) {
    content = (
      <StateProvider initialState={{}} onStateChange={handleStateChange}>
        <VisibilityProvider>
          <ActionProvider handlers={actionHandlers}>
            <Renderer spec={parsedSpec} registry={registry} />
          </ActionProvider>
        </VisibilityProvider>
      </StateProvider>
    );
  } else if (visuals.length > 0 && markdown) {
    content = (
      <div className="space-y-4">
        <VisualGallery visuals={visuals} />
        <MarkdownContent content={markdown} />
      </div>
    );
  } else if (visuals.length > 0) {
    content = <VisualGallery visuals={visuals} />;
  } else if (markdown) {
    content = <MarkdownContent content={markdown} />;
  } else {
    content = (
      <div className="flex items-center gap-2 text-sm text-zinc-500">
        <AlertTriangle className="w-4 h-4" />
        <span>No report available yet.</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {content}
      {parsedSpec && remainingVisuals.length > 0 && (
        <VisualGallery visuals={remainingVisuals} title="Additional visuals" />
      )}

      {/* Debug section (only when enabled) */}
      {debug === true && (structuredResult != null || spec != null || visuals.length > 0) && (
        <div className="mt-4">
          <button
            onClick={() => setShowDebug(!showDebug)}
            className="text-xs text-zinc-500 hover:text-zinc-400 flex items-center gap-1"
          >
            {showDebug ? "\u25BC" : "\u25B6"} Debug: Raw Data
          </button>
          {showDebug && (
            <pre className="mt-2 p-3 bg-zinc-900 border border-zinc-700/50 rounded text-xs text-zinc-400 overflow-x-auto max-h-96 overflow-y-auto">
              {JSON.stringify({ resultType, structuredResult, spec, visuals }, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

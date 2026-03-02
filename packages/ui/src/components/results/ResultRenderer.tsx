import { Renderer, StateProvider, ActionProvider, VisibilityProvider } from "@json-render/react";
import type { Spec, StateModel } from "@json-render/react";
import { registry, handlers } from "../../lib/render-registry";
import MarkdownContent from "../MarkdownContent";
import { AlertTriangle } from "lucide-react";
import { useState, useCallback, useRef, type ReactNode } from "react";

interface ResultRendererProps {
  /** json-render spec from LLM (parsed JSON object or JSON string) */
  spec?: unknown;
  /** Structured result data (flight/stock/etc JSON) */
  structuredResult?: unknown;
  /** Markdown report fallback */
  markdown?: string;
  /** Result type for context */
  resultType?: string;
  /** Show debug info */
  debug?: boolean;
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
  markdown,
  resultType,
  debug,
}: ResultRendererProps) {
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

      {/* Debug section (only when enabled) */}
      {debug === true && (structuredResult != null || spec != null) && (
        <div className="mt-4">
          <button
            onClick={() => setShowDebug(!showDebug)}
            className="text-xs text-zinc-500 hover:text-zinc-400 flex items-center gap-1"
          >
            {showDebug ? "\u25BC" : "\u25B6"} Debug: Raw Data
          </button>
          {showDebug && (
            <pre className="mt-2 p-3 bg-zinc-900 border border-zinc-700/50 rounded text-xs text-zinc-400 overflow-x-auto max-h-96 overflow-y-auto">
              {JSON.stringify({ resultType, structuredResult, spec }, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

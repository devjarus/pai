import { LibraryIcon, AlertCircleIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface SourceItem {
  id: string;
  title: string;
  url: string;
  chunks?: number;
  learnedAt?: string;
}

interface ToolKnowledgeSourcesProps {
  state: string;
  input?: unknown;
  output?: SourceItem[] | string;
}

function parseSources(output: SourceItem[] | string): SourceItem[] {
  if (Array.isArray(output)) return output;
  if (typeof output === "string") {
    try {
      const parsed = JSON.parse(output);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // not JSON
    }
  }
  return [];
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function ToolKnowledgeSources({ state, output }: ToolKnowledgeSourcesProps) {
  if (state === "input-available") {
    return (
      <Card className="gap-0 rounded-lg border-border/50 py-0 shadow-none">
        <CardContent className="flex items-center gap-2 px-3 py-2.5">
          <LibraryIcon className="size-3.5 shrink-0 animate-pulse text-primary" />
          <span className="text-xs text-muted-foreground">Loading sources...</span>
        </CardContent>
      </Card>
    );
  }

  if (state === "output-error") {
    return (
      <Card className="gap-0 rounded-lg border-destructive/50 py-0 shadow-none">
        <CardContent className="flex items-center gap-2 px-3 py-2.5">
          <AlertCircleIcon className="size-3.5 shrink-0 text-destructive" />
          <span className="text-xs text-destructive">Failed to load sources.</span>
        </CardContent>
      </Card>
    );
  }

  if (state === "output-available") {
    if (typeof output === "string" && output.trim()) {
      if (output.includes("No sources") || output.includes("empty")) {
        return (
          <Card className="gap-0 rounded-lg border-border/50 py-0 shadow-none">
            <CardContent className="flex items-center gap-2 px-3 py-2.5">
              <LibraryIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Knowledge base is empty.</span>
            </CardContent>
          </Card>
        );
      }

      return (
        <Card className="gap-0 rounded-lg border-border/50 py-0 shadow-none">
          <CardContent className="px-3 py-2.5">
            <div className="flex items-center gap-2">
              <LibraryIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="text-xs font-medium text-foreground">Knowledge sources</span>
            </div>
            <p className="mt-1.5 line-clamp-4 text-xs leading-relaxed text-muted-foreground">
              {output.slice(0, 500)}
            </p>
          </CardContent>
        </Card>
      );
    }

    const sources = parseSources(output as SourceItem[] | string);

    if (sources.length === 0) {
      return (
        <Card className="gap-0 rounded-lg border-border/50 py-0 shadow-none">
          <CardContent className="flex items-center gap-2 px-3 py-2.5">
            <LibraryIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Knowledge base is empty.</span>
          </CardContent>
        </Card>
      );
    }

    return (
      <Card className="gap-0 rounded-lg border-border/50 py-0 shadow-none">
        <CardContent className="px-3 py-2.5">
          <div className="flex items-center gap-2">
            <LibraryIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="text-xs font-medium text-foreground">
              {sources.length} source{sources.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="mt-2 flex flex-col gap-1">
            {sources.slice(0, 8).map((source) => (
              <div
                key={source.id}
                className="flex items-center gap-2 rounded-md bg-muted/30 px-2 py-1.5"
              >
                <span className="flex-1 truncate text-xs text-foreground">
                  {source.title || getDomain(source.url)}
                </span>
                {source.chunks != null && (
                  <span className="shrink-0 text-[10px] text-muted-foreground/60">
                    {source.chunks} chunk{source.chunks !== 1 ? "s" : ""}
                  </span>
                )}
                <span className="shrink-0 text-[10px] text-muted-foreground/60">
                  {getDomain(source.url)}
                </span>
              </div>
            ))}
            {sources.length > 8 && (
              <span className="mt-1 text-[10px] text-muted-foreground">
                +{sources.length - 8} more
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return null;
}

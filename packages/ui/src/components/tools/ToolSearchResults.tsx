import { GlobeIcon, AlertCircleIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface ToolSearchResultsProps {
  state: string;
  input?: { query?: string };
  output?: string;
}

interface ParsedResult {
  title: string;
  snippet: string;
  domain: string;
}

function parseSearchResults(output: string): ParsedResult[] {
  const results: ParsedResult[] = [];
  // Each result block is typically separated by blank lines
  // Format varies but commonly: "Title\nSnippet\nURL" or markdown-style
  const lines = output.split("\n").filter((l) => l.trim());
  let current: Partial<ParsedResult> = {};

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip header lines like "## Web Search Results" or "---"
    if (trimmed.startsWith("##") || trimmed === "---") continue;

    // Detect URL lines to extract domain
    const urlMatch = trimmed.match(/https?:\/\/([^/\s]+)/);
    if (urlMatch) {
      current.domain = urlMatch[1];
      if (current.title) {
        results.push({
          title: current.title,
          snippet: current.snippet || "",
          domain: current.domain,
        });
        current = {};
      }
      continue;
    }

    // Bold title pattern: **Title** or ### Title
    const boldMatch = trimmed.match(/^\*\*(.+?)\*\*$/) || trimmed.match(/^###?\s+(.+)/);
    if (boldMatch) {
      if (current.title && current.snippet) {
        results.push({
          title: current.title,
          snippet: current.snippet,
          domain: current.domain || "",
        });
        current = {};
      }
      current.title = boldMatch[1];
      continue;
    }

    // Numbered result: "1. Title - snippet" pattern
    const numberedMatch = trimmed.match(/^\d+\.\s+(.+)/);
    if (numberedMatch && !current.title) {
      current.title = numberedMatch[1];
      continue;
    }

    // Bullet point snippets
    const bulletMatch = trimmed.match(/^[-*]\s+(.*)/);
    if (bulletMatch) {
      if (!current.snippet) {
        current.snippet = bulletMatch[1];
      } else {
        current.snippet += " " + bulletMatch[1];
      }
      continue;
    }

    // Treat as snippet text if we already have a title
    if (current.title && !current.snippet) {
      current.snippet = trimmed;
    }
  }

  // Push last accumulated result
  if (current.title) {
    results.push({
      title: current.title,
      snippet: current.snippet || "",
      domain: current.domain || "",
    });
  }

  return results;
}

export function ToolSearchResults({ state, input, output }: ToolSearchResultsProps) {
  // Loading state
  if (state === "input-available") {
    return (
      <Card className="my-2 gap-0 rounded-lg border-border/50 py-0 shadow-none">
        <CardContent className="flex items-center gap-2 px-3 py-2.5">
          <GlobeIcon className="size-3.5 shrink-0 animate-pulse text-primary" />
          <span className="text-xs text-muted-foreground">
            Searching the web for{" "}
            <span className="font-medium text-foreground">
              {input?.query ? `"${input.query}"` : "..."}
            </span>
          </span>
        </CardContent>
      </Card>
    );
  }

  // Error state
  if (state === "output-error") {
    return (
      <Card className="my-2 gap-0 rounded-lg border-destructive/50 py-0 shadow-none">
        <CardContent className="flex items-center gap-2 px-3 py-2.5">
          <AlertCircleIcon className="size-3.5 shrink-0 text-destructive" />
          <span className="text-xs text-destructive">Web search failed.</span>
        </CardContent>
      </Card>
    );
  }

  // Success state
  if (state === "output-available" && output) {
    const results = parseSearchResults(output);

    if (results.length === 0) {
      // Fallback: show raw output truncated
      return (
        <Card className="my-2 gap-0 rounded-lg border-border/50 py-0 shadow-none">
          <CardContent className="px-3 py-2.5">
            <div className="flex items-center gap-2">
              <GlobeIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="text-xs font-medium text-foreground">
                Web results{input?.query ? ` for "${input.query}"` : ""}
              </span>
            </div>
            <p className="mt-1.5 line-clamp-4 text-xs leading-relaxed text-muted-foreground">
              {output.slice(0, 500)}
            </p>
          </CardContent>
        </Card>
      );
    }

    return (
      <Card className="my-2 gap-0 rounded-lg border-border/50 py-0 shadow-none">
        <CardContent className="px-3 py-2.5">
          <div className="flex items-center gap-2">
            <GlobeIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="text-xs font-medium text-foreground">
              Web results{input?.query ? ` for "${input.query}"` : ""}
            </span>
          </div>
          <div className="mt-2 flex flex-col gap-1.5">
            {results.slice(0, 5).map((r, i) => (
              <div
                key={i}
                className={cn(
                  "rounded-md bg-muted/30 px-2 py-1.5",
                )}
              >
                <div className="text-xs font-medium text-foreground">{r.title}</div>
                {r.snippet && (
                  <p className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-muted-foreground">
                    {r.snippet}
                  </p>
                )}
                {r.domain && (
                  <span className="mt-0.5 block text-[10px] text-muted-foreground/60">
                    {r.domain}
                  </span>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return null;
}

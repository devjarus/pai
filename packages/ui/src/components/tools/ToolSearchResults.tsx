import { useState } from "react";
import { GlobeIcon, AlertCircleIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CollapsibleToolCard } from "./CollapsibleToolCard";

interface StructuredResult {
  title: string;
  url: string;
  snippet: string;
  thumbnail?: string;
}

interface StructuredOutput {
  text: string;
  results: StructuredResult[];
  query: string;
  category?: string;
}

interface ToolSearchResultsProps {
  state: string;
  input?: { query?: string; category?: string };
  output?: string | StructuredOutput;
}

/** Extract domain from a URL string */
function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Parse legacy plain-text output into structured results (backward compat) */
function parseLegacyOutput(output: string): StructuredResult[] {
  const results: StructuredResult[] = [];
  const lines = output.split("\n").filter((l) => l.trim());
  let current: Partial<StructuredResult> = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("##") || trimmed === "---") continue;

    const urlMatch = trimmed.match(/Source:\s*(https?:\/\/\S+)/);
    if (urlMatch) {
      current.url = urlMatch[1];
      if (current.title) {
        results.push({
          title: current.title,
          url: current.url,
          snippet: current.snippet || "",
        });
        current = {};
      }
      continue;
    }

    const boldMatch = trimmed.match(/^\d+\.\s+\*\*(.+?)\*\*$/);
    if (boldMatch) {
      if (current.title) {
        results.push({
          title: current.title,
          url: current.url || "",
          snippet: current.snippet || "",
        });
        current = {};
      }
      current.title = boldMatch[1];
      continue;
    }

    if (current.title && !current.snippet && !trimmed.startsWith("Source:")) {
      current.snippet = trimmed;
    }
  }

  if (current.title) {
    results.push({
      title: current.title,
      url: current.url || "",
      snippet: current.snippet || "",
    });
  }

  return results;
}

function ResultThumbnail({ src, domain }: { src?: string; domain: string }) {
  const [failed, setFailed] = useState(false);

  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        className="size-12 shrink-0 rounded-md object-cover"
        onError={() => setFailed(true)}
        loading="lazy"
      />
    );
  }

  // Favicon fallback
  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
      alt=""
      className="size-8 shrink-0 rounded"
      loading="lazy"
    />
  );
}

function ResultCard({ result }: { result: StructuredResult }) {
  const domain = getDomain(result.url);

  return (
    <div className="flex gap-2.5 rounded-md bg-muted/30 px-2.5 py-2">
      <ResultThumbnail src={result.thumbnail} domain={domain} />
      <div className="min-w-0 flex-1">
        <a
          href={result.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-medium text-foreground hover:underline"
        >
          {result.title}
        </a>
        {result.snippet && (
          <p className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-muted-foreground">
            {result.snippet}
          </p>
        )}
        <span className="mt-0.5 block text-[10px] text-muted-foreground/60">
          {domain}
        </span>
      </div>
    </div>
  );
}

export function ToolSearchResults({ state, input, output }: ToolSearchResultsProps) {
  const category = input?.category;
  const categoryLabel = category && category !== "general" ? category : undefined;

  // Loading state
  if (state === "input-available") {
    return (
      <Card className="my-2 gap-0 rounded-lg border-border/50 py-0 shadow-none">
        <CardContent className="flex items-center gap-2 px-3 py-2.5">
          <GlobeIcon className="size-3.5 shrink-0 animate-pulse text-primary" />
          <span className="text-xs text-muted-foreground">
            Searching{categoryLabel ? ` ${categoryLabel}` : " the web"} for{" "}
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
    let results: StructuredResult[];
    let outputCategory: string | undefined;

    // Output may arrive as a JSON string or already-parsed object
    let parsed: StructuredOutput | null = null;
    if (typeof output === "string") {
      try {
        const obj = JSON.parse(output);
        if (obj && Array.isArray(obj.results)) {
          parsed = obj as StructuredOutput;
        }
      } catch {
        // Not JSON — legacy plain-text format
      }
    } else if (output && typeof output === "object") {
      parsed = output as StructuredOutput;
    }

    if (parsed) {
      results = parsed.results ?? [];
      outputCategory = parsed.category;
    } else {
      // Legacy plain-text format
      results = parseLegacyOutput(typeof output === "string" ? output : String(output));
    }

    const displayCategory = categoryLabel || (outputCategory && outputCategory !== "general" ? outputCategory : undefined);

    if (results.length === 0) {
      return (
        <Card className="my-2 gap-0 rounded-lg border-border/50 py-0 shadow-none">
          <CardContent className="px-3 py-2.5">
            <div className="flex items-center gap-2">
              <GlobeIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="text-xs font-medium text-foreground">
                No results{input?.query ? ` for "${input.query}"` : ""}
              </span>
            </div>
          </CardContent>
        </Card>
      );
    }

    return (
      <CollapsibleToolCard
        icon={<GlobeIcon className="size-3.5 shrink-0 text-muted-foreground" />}
        label={
          <span className="flex items-center gap-1.5">
            Web results{input?.query ? ` for "${input.query}"` : ""} ({results.length})
            {displayCategory && (
              <Badge variant="secondary" className="text-[9px] px-1.5 py-0">
                {displayCategory}
              </Badge>
            )}
          </span>
        }
      >
        <div className="flex flex-col gap-1.5">
          {results.slice(0, 5).map((r, i) => (
            <ResultCard key={i} result={r} />
          ))}
        </div>
      </CollapsibleToolCard>
    );
  }

  return null;
}

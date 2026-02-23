import { BookOpenIcon, AlertCircleIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { CollapsibleToolCard } from "./CollapsibleToolCard";

interface ChunkResult {
  content: string;
  source?: string;
  url?: string;
  relevance?: number;
}

interface ToolKnowledgeSearchProps {
  state: string;
  input?: { query?: string };
  output?: ChunkResult[] | string;
}

function parseChunks(output: ChunkResult[] | string): ChunkResult[] {
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

export function ToolKnowledgeSearch({ state, input, output }: ToolKnowledgeSearchProps) {
  if (state === "input-available") {
    return (
      <Card className="gap-0 rounded-lg border-border/50 py-0 shadow-none">
        <CardContent className="flex items-center gap-2 px-3 py-2.5">
          <BookOpenIcon className="size-3.5 shrink-0 animate-pulse text-primary" />
          <span className="text-xs text-muted-foreground">
            Searching knowledge for{" "}
            <span className="font-medium text-foreground">
              {input?.query ? `"${input.query}"` : "..."}
            </span>
          </span>
        </CardContent>
      </Card>
    );
  }

  if (state === "output-error") {
    return (
      <Card className="gap-0 rounded-lg border-destructive/50 py-0 shadow-none">
        <CardContent className="flex items-center gap-2 px-3 py-2.5">
          <AlertCircleIcon className="size-3.5 shrink-0 text-destructive" />
          <span className="text-xs text-destructive">Knowledge search failed.</span>
        </CardContent>
      </Card>
    );
  }

  if (state === "output-available") {
    // Handle string output (formatted text from the tool)
    if (typeof output === "string") {
      if (!output.trim() || output.includes("No relevant knowledge")) {
        return (
          <Card className="gap-0 rounded-lg border-border/50 py-0 shadow-none">
            <CardContent className="flex items-center gap-2 px-3 py-2.5">
              <BookOpenIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">No relevant knowledge found.</span>
            </CardContent>
          </Card>
        );
      }

      return (
        <CollapsibleToolCard
          icon={<BookOpenIcon className="size-3.5 shrink-0 text-muted-foreground" />}
          label={<>Knowledge results{input?.query ? ` for "${input.query}"` : ""}</>}
        >
          <p className="line-clamp-4 text-xs leading-relaxed text-muted-foreground">
            {output.slice(0, 500)}
          </p>
        </CollapsibleToolCard>
      );
    }

    const chunks = parseChunks(output ?? []);

    if (chunks.length === 0) {
      return (
        <Card className="gap-0 rounded-lg border-border/50 py-0 shadow-none">
          <CardContent className="flex items-center gap-2 px-3 py-2.5">
            <BookOpenIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">No relevant knowledge found.</span>
          </CardContent>
        </Card>
      );
    }

    return (
      <CollapsibleToolCard
        icon={<BookOpenIcon className="size-3.5 shrink-0 text-muted-foreground" />}
        label={<>{chunks.length} result{chunks.length !== 1 ? "s" : ""}{input?.query ? ` for "${input.query}"` : ""}</>}
      >
        <div className="flex flex-col gap-1.5">
          {chunks.slice(0, 5).map((chunk, i) => (
            <div key={i} className="rounded-md bg-muted/30 px-2 py-1.5">
              {chunk.source && (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-foreground">{chunk.source}</span>
                  {chunk.relevance != null && (
                    <span className="text-[10px] text-muted-foreground/60">
                      {Math.round(chunk.relevance * 100)}%
                    </span>
                  )}
                </div>
              )}
              <p className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-muted-foreground">
                {chunk.content}
              </p>
              {chunk.url && (
                <span className="mt-0.5 block text-[10px] text-muted-foreground/60">
                  {chunk.url.replace(/^https?:\/\//, "").split("/")[0]}
                </span>
              )}
            </div>
          ))}
        </div>
      </CollapsibleToolCard>
    );
  }

  return null;
}

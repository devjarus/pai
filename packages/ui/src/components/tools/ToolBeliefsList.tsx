import { BrainIcon, AlertCircleIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CollapsibleToolCard } from "./CollapsibleToolCard";
import { cn } from "@/lib/utils";

interface BeliefItem {
  id: string;
  type: string;
  statement: string;
  confidence: number;
}

interface ToolBeliefsListProps {
  state: string;
  input?: unknown;
  output?: BeliefItem[] | string;
}

const TYPE_STYLES: Record<string, string> = {
  factual: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/20",
  preference: "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/20",
  procedural: "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/20",
  architectural: "bg-teal-500/15 text-teal-600 dark:text-teal-400 border-teal-500/20",
  insight: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/20",
};

function parseBeliefs(output: BeliefItem[] | string): BeliefItem[] {
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

export function ToolBeliefsList({ state, output }: ToolBeliefsListProps) {
  if (state === "input-available") {
    return (
      <Card className="my-2 gap-0 rounded-lg border-border/50 py-0 shadow-none">
        <CardContent className="flex items-center gap-2 px-3 py-2.5">
          <BrainIcon className="size-3.5 shrink-0 animate-pulse text-primary" />
          <span className="text-xs text-muted-foreground">Loading beliefs...</span>
        </CardContent>
      </Card>
    );
  }

  if (state === "output-error") {
    return (
      <Card className="my-2 gap-0 rounded-lg border-destructive/50 py-0 shadow-none">
        <CardContent className="flex items-center gap-2 px-3 py-2.5">
          <AlertCircleIcon className="size-3.5 shrink-0 text-destructive" />
          <span className="text-xs text-destructive">Failed to load beliefs.</span>
        </CardContent>
      </Card>
    );
  }

  if (state === "output-available" && output) {
    const beliefs = parseBeliefs(output);

    if (beliefs.length === 0) {
      return (
        <Card className="my-2 gap-0 rounded-lg border-border/50 py-0 shadow-none">
          <CardContent className="flex items-center gap-2 px-3 py-2.5">
            <BrainIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">No beliefs found.</span>
          </CardContent>
        </Card>
      );
    }

    return (
      <CollapsibleToolCard
        icon={<BrainIcon className="size-3.5 shrink-0 text-muted-foreground" />}
        label={<>{beliefs.length} belief{beliefs.length !== 1 ? "s" : ""}</>}
      >
        <div className="flex flex-col gap-1">
          {beliefs.map((belief) => (
            <div
              key={belief.id}
              className="flex items-start gap-2 rounded-md bg-muted/30 px-2 py-1.5"
            >
              <Badge
                variant="outline"
                className={cn(
                  "mt-0.5 h-4 shrink-0 px-1 text-[9px] font-medium",
                  TYPE_STYLES[belief.type] ?? "bg-muted text-muted-foreground border-border",
                )}
              >
                {belief.type}
              </Badge>
              <span className="flex-1 text-xs leading-relaxed text-foreground">
                {belief.statement}
              </span>
              <span className="shrink-0 text-[10px] text-muted-foreground/60">
                {Math.round(belief.confidence * 100)}%
              </span>
            </div>
          ))}
        </div>
      </CollapsibleToolCard>
    );
  }

  return null;
}

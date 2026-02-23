import { useState } from "react";
import { WrenchIcon, BrainIcon, CheckIcon, AlertCircleIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface BeliefItem {
  id: string;
  type: string;
  statement: string;
  confidence: number;
}

interface ToolCuratorActionProps {
  state: string;
  toolName: "fix_issues" | "list_beliefs";
  input?: unknown;
  output?: { ok?: boolean; message?: string } | BeliefItem[] | string;
}

const TYPE_STYLES: Record<string, string> = {
  factual: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/20",
  preference: "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/20",
  procedural: "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/20",
  architectural: "bg-teal-500/15 text-teal-600 dark:text-teal-400 border-teal-500/20",
  insight: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/20",
};

function parseBeliefs(output: unknown): BeliefItem[] {
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

export function ToolCuratorAction({ state, toolName, input, output }: ToolCuratorActionProps) {
  const [expanded, setExpanded] = useState(false);
  const COLLAPSED_LIMIT = 5;
  const inputObj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;

  if (state === "input-available") {
    return (
      <Card className="gap-0 rounded-lg border-border/50 py-0 shadow-none">
        <CardContent className="flex items-center gap-2 px-3 py-2.5">
          {toolName === "fix_issues" ? (
            <WrenchIcon className="size-3.5 shrink-0 animate-pulse text-primary" />
          ) : (
            <BrainIcon className="size-3.5 shrink-0 animate-pulse text-primary" />
          )}
          <span className="text-xs text-muted-foreground">
            {toolName === "fix_issues"
              ? `Fixing ${inputObj.action ? String(inputObj.action) : "issues"}...`
              : "Browsing beliefs..."}
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
          <span className="text-xs text-destructive">
            {toolName === "fix_issues" ? "Failed to fix issues." : "Failed to load beliefs."}
          </span>
        </CardContent>
      </Card>
    );
  }

  if (state === "output-available") {
    if (toolName === "fix_issues") {
      const outObj = typeof output === "object" && output && !Array.isArray(output) ? output as { ok?: boolean; message?: string } : null;
      const outStr = typeof output === "string" ? output : null;

      return (
        <Card className="gap-0 rounded-lg border-green-500/10 py-0 shadow-none">
          <CardContent className="flex items-center gap-2 px-3 py-2.5">
            <CheckIcon className="size-3.5 shrink-0 text-green-500" />
            <span className="text-xs text-foreground">
              {outObj?.message || outStr || "Issues fixed."}
            </span>
          </CardContent>
        </Card>
      );
    }

    // list_beliefs
    const beliefs = parseBeliefs(output);

    if (beliefs.length === 0) {
      const fallback = typeof output === "string" ? output : null;
      return (
        <Card className="gap-0 rounded-lg border-border/50 py-0 shadow-none">
          <CardContent className="flex items-center gap-2 px-3 py-2.5">
            <BrainIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              {fallback || "No beliefs found."}
            </span>
          </CardContent>
        </Card>
      );
    }

    const visible = expanded ? beliefs : beliefs.slice(0, COLLAPSED_LIMIT);
    const hasMore = beliefs.length > COLLAPSED_LIMIT;

    return (
      <Card className="gap-0 rounded-lg border-border/50 py-0 shadow-none">
        <CardContent className="px-3 py-2.5">
          <div className="flex items-center gap-2">
            <BrainIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="text-xs font-medium text-foreground">
              {beliefs.length} belief{beliefs.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="mt-2 flex flex-col gap-1">
            {visible.map((belief) => (
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
          {hasMore && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-1.5 flex items-center gap-1 text-[10px] text-primary hover:underline"
            >
              {expanded ? (
                <>
                  <ChevronUpIcon className="size-3" />
                  Show less
                </>
              ) : (
                <>
                  <ChevronDownIcon className="size-3" />
                  Show {beliefs.length - COLLAPSED_LIMIT} more
                </>
              )}
            </button>
          )}
        </CardContent>
      </Card>
    );
  }

  return null;
}

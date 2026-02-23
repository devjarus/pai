import { ShieldCheckIcon, AlertCircleIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface CurationResult {
  stats?: { activeBeliefs?: number; episodes?: number };
  duplicates?: number | { count?: number };
  stale?: number | { count?: number };
  contradictions?: number | { count?: number };
  summary?: string;
}

interface ToolCurateMemoryProps {
  state: string;
  input?: unknown;
  output?: CurationResult | string;
}

function getCount(value: number | { count?: number } | undefined): number {
  if (typeof value === "number") return value;
  if (value && typeof value === "object" && value.count != null) return value.count;
  return 0;
}

export function ToolCurateMemory({ state, output }: ToolCurateMemoryProps) {
  if (state === "input-available") {
    return (
      <Card className="gap-0 rounded-lg border-border/50 py-0 shadow-none">
        <CardContent className="flex items-center gap-2 px-3 py-2.5">
          <ShieldCheckIcon className="size-3.5 shrink-0 animate-pulse text-primary" />
          <span className="text-xs text-muted-foreground">Analyzing memory health...</span>
        </CardContent>
      </Card>
    );
  }

  if (state === "output-error") {
    return (
      <Card className="gap-0 rounded-lg border-destructive/50 py-0 shadow-none">
        <CardContent className="flex items-center gap-2 px-3 py-2.5">
          <AlertCircleIcon className="size-3.5 shrink-0 text-destructive" />
          <span className="text-xs text-destructive">Memory analysis failed.</span>
        </CardContent>
      </Card>
    );
  }

  if (state === "output-available") {
    if (typeof output === "string") {
      return (
        <Card className="gap-0 rounded-lg border-border/50 py-0 shadow-none">
          <CardContent className="px-3 py-2.5">
            <div className="flex items-center gap-2">
              <ShieldCheckIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="text-xs font-medium text-foreground">Memory Health</span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              {output.slice(0, 500)}
            </p>
          </CardContent>
        </Card>
      );
    }

    const result = output as CurationResult | undefined;
    if (!result) return null;

    const duplicates = getCount(result.duplicates);
    const stale = getCount(result.stale);
    const contradictions = getCount(result.contradictions);
    const totalIssues = duplicates + stale + contradictions;

    return (
      <Card className="gap-0 rounded-lg border-border/50 py-0 shadow-none">
        <CardContent className="px-3 py-2.5">
          <div className="flex items-center gap-2">
            <ShieldCheckIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="text-xs font-medium text-foreground">Memory Health</span>
            {totalIssues === 0 ? (
              <Badge variant="outline" className="h-4 border-green-500/20 bg-green-500/15 px-1 text-[9px] font-medium text-green-600 dark:text-green-400">
                Healthy
              </Badge>
            ) : (
              <Badge variant="outline" className="h-4 border-yellow-500/20 bg-yellow-500/15 px-1 text-[9px] font-medium text-yellow-600 dark:text-yellow-400">
                {totalIssues} issue{totalIssues !== 1 ? "s" : ""}
              </Badge>
            )}
          </div>

          {result.stats && (
            <div className="mt-2 flex gap-3 text-[10px] text-muted-foreground">
              {result.stats.activeBeliefs != null && (
                <span>{result.stats.activeBeliefs} active beliefs</span>
              )}
              {result.stats.episodes != null && (
                <span>{result.stats.episodes} episodes</span>
              )}
            </div>
          )}

          {totalIssues > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {duplicates > 0 && (
                <Badge variant="outline" className="h-4 border-blue-500/20 bg-blue-500/15 px-1.5 text-[9px] font-medium text-blue-600 dark:text-blue-400">
                  {duplicates} duplicate{duplicates !== 1 ? "s" : ""}
                </Badge>
              )}
              {stale > 0 && (
                <Badge variant="outline" className="h-4 border-orange-500/20 bg-orange-500/15 px-1.5 text-[9px] font-medium text-orange-600 dark:text-orange-400">
                  {stale} stale
                </Badge>
              )}
              {contradictions > 0 && (
                <Badge variant="outline" className="h-4 border-red-500/20 bg-red-500/15 px-1.5 text-[9px] font-medium text-red-600 dark:text-red-400">
                  {contradictions} contradiction{contradictions !== 1 ? "s" : ""}
                </Badge>
              )}
            </div>
          )}

          {result.summary && (
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {result.summary}
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  return null;
}

import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Belief } from "../types";

const typeColorMap: Record<string, string> = {
  factual: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  preference: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  procedural: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  architectural: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  insight: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  meta: "bg-pink-500/15 text-pink-400 border-pink-500/30",
};

interface BeliefCardProps {
  belief: Belief;
  onForget?: (id: string) => void;
  onClick?: (belief: Belief) => void;
}

export default function BeliefCard({ belief, onForget, onClick }: BeliefCardProps) {
  const confidencePercent = Math.round(belief.confidence * 100);
  const typeClass = typeColorMap[belief.type] ?? "bg-muted text-muted-foreground border-border";
  const isActive = belief.status === "active";

  return (
    <Card
      className={cn(
        "group cursor-pointer gap-3 border-border/50 bg-card/50 py-4 transition-all hover:border-primary/30 hover:shadow-md hover:shadow-primary/5",
        !isActive && "opacity-50",
      )}
      onClick={() => onClick?.(belief)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick?.(belief);
        }
      }}
    >
      {/* Header: type badge + confidence */}
      <div className="flex items-center justify-between px-4">
        <Badge
          variant="outline"
          className={cn("rounded-md text-[10px] font-medium uppercase tracking-wider", typeClass)}
        >
          {belief.type}
        </Badge>
        <span className="font-mono text-xs text-muted-foreground">
          {confidencePercent}%
        </span>
      </div>

      {/* Statement */}
      <CardContent className="px-4 py-0">
        <p className="text-sm leading-relaxed text-foreground/85">
          {belief.statement}
        </p>
      </CardContent>

      {/* Confidence bar */}
      <div className="px-4">
        <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${confidencePercent}%` }}
          />
        </div>
      </div>

      {/* Footer */}
      <CardFooter className="flex items-center justify-between px-4 py-0 text-[11px] text-muted-foreground">
        <span>{new Date(belief.created_at.replace(" ", "T")).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
        <div className="flex items-center gap-2">
          {!isActive && (
            <Badge variant="destructive" className="text-[10px]">
              {belief.status}
            </Badge>
          )}
          {onForget && isActive && (
            <Button
              variant="ghost"
              size="xs"
              className="text-muted-foreground opacity-100 transition-opacity hover:text-destructive md:opacity-0 md:group-hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                onForget(belief.id);
              }}
            >
              forget
            </Button>
          )}
        </div>
      </CardFooter>
    </Card>
  );
}

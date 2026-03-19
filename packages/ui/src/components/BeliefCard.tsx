import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { typeColorMap, typeBorderLeftMap } from "@/lib/belief-colors";
import type { Belief } from "../types";
import { formatWithTimezone, parseApiDate } from "@/lib/datetime";
import { useAppTimezone } from "@/hooks";

interface BeliefCardProps {
  belief: Belief;
  onForget?: (id: string) => void;
  onClick?: (belief: Belief) => void;
}

export default function BeliefCard({ belief, onForget, onClick }: BeliefCardProps) {
  const timezone = useAppTimezone();
  const confidencePercent = Math.round(belief.confidence * 100);
  const typeClass = typeColorMap[belief.type] ?? "bg-muted text-muted-foreground border-border";
  const borderLeft = typeBorderLeftMap[belief.type] ?? "border-l-border";
  const isActive = belief.status === "active";

  return (
    <div
      className={cn(
        "group cursor-pointer border-l-2 rounded-r-lg bg-card/30 px-4 py-3.5 transition-all hover:bg-card/60",
        borderLeft,
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
      <div className="flex items-center justify-between">
        <Badge
          variant="outline"
          className={cn("rounded-md text-[10px] font-medium uppercase tracking-wider", typeClass)}
        >
          {belief.type}
        </Badge>
        <span className="font-mono text-xs text-muted-foreground/70">
          {confidencePercent}%
        </span>
      </div>

      {/* Statement */}
      <p className="mt-2 text-sm leading-relaxed text-foreground/85">
        {belief.statement}
      </p>

      {/* Confidence bar */}
      <div className="mt-3">
        <div className="h-0.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary/60 transition-all"
            style={{ width: `${confidencePercent}%` }}
          />
        </div>
      </div>

      {/* Footer */}
      <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground/60">
        <span>{formatWithTimezone(parseApiDate(belief.created_at), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }, timezone)}</span>
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
      </div>
    </div>
  );
}

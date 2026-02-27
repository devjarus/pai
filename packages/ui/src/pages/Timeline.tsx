import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { InfoBubble } from "../components/InfoBubble";
import { useBeliefs } from "@/hooks";
import type { Belief, BeliefType } from "../types";

const TYPES: BeliefType[] = ["factual", "preference", "procedural", "architectural", "insight", "meta"];

const typeColorMap: Record<string, string> = {
  factual: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  preference: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  procedural: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  architectural: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  insight: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  meta: "bg-pink-500/15 text-pink-400 border-pink-500/30",
};

const dotColors: Record<string, string> = {
  factual: "bg-blue-500",
  preference: "bg-purple-500",
  procedural: "bg-emerald-500",
  architectural: "bg-orange-500",
  insight: "bg-amber-500",
  meta: "bg-pink-500",
};

const cardAccentColors: Record<string, string> = {
  factual: "border-l-blue-500/60",
  preference: "border-l-purple-500/60",
  procedural: "border-l-emerald-500/60",
  architectural: "border-l-orange-500/60",
  insight: "border-l-amber-500/60",
  meta: "border-l-pink-500/60",
};

export default function Timeline() {
  const [filterType, setFilterType] = useState<string>("");

  useEffect(() => { document.title = "Timeline - pai"; }, []);

  const { data: rawBeliefs = [], isLoading: loading } = useBeliefs({
    type: filterType || undefined,
  });

  // Sort by updated_at descending
  const beliefs = [...rawBeliefs].sort(
    (a, b) => new Date(b.updated_at.replace(" ", "T")).getTime() - new Date(a.updated_at.replace(" ", "T")).getTime(),
  );

  // Group by date
  const grouped = beliefs.reduce<Record<string, Belief[]>>((acc, belief) => {
    const date = new Date(belief.updated_at.replace(" ", "T")).toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    if (!acc[date]) acc[date] = [];
    acc[date].push(belief);
    return acc;
  }, {});

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <header className="space-y-4 border-b border-border/40 bg-[#0a0a0a] px-4 py-4 md:px-6">
        <h1 className="flex items-center gap-1.5 font-mono text-sm font-semibold text-foreground">
          Timeline
          <InfoBubble text="A chronological feed of all beliefs, showing when they were created or updated. Filter by type to focus on specific categories." />
        </h1>

        {/* Type filter badges */}
        <div className="flex flex-wrap gap-1.5">
          <Badge
            variant={filterType === "" ? "default" : "ghost"}
            className="cursor-pointer text-[10px]"
            onClick={() => setFilterType("")}
          >
            All types
          </Badge>
          {TYPES.map((t) => (
            <Badge
              key={t}
              variant="ghost"
              className={cn(
                "cursor-pointer border text-[10px] capitalize transition-colors",
                filterType === t
                  ? typeColorMap[t]
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setFilterType(filterType === t ? "" : t)}
            >
              {t}
            </Badge>
          ))}
        </div>
      </header>

      {/* Timeline content */}
      <ScrollArea className="flex-1">
        <div className="p-4 md:p-6">
          {loading ? (
            <div className="mx-auto max-w-2xl space-y-6">
              {Array.from({ length: 3 }).map((_, gi) => (
                <div key={gi} className="space-y-3">
                  <Skeleton className="h-4 w-48" />
                  {Array.from({ length: 2 }).map((_, ci) => (
                    <div key={ci} className="flex gap-3">
                      <Skeleton className="mt-1 h-4 w-4 shrink-0 rounded-full" />
                      <div className="flex-1 space-y-2 rounded-xl border border-border/50 bg-card/50 p-4">
                        <div className="flex items-center justify-between">
                          <Skeleton className="h-4 w-16" />
                          <Skeleton className="h-3 w-12" />
                        </div>
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-2/3" />
                        <Skeleton className="h-3 w-24" />
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : beliefs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-sm text-muted-foreground">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="mb-4 opacity-30">
                <line x1="12" y1="20" x2="12" y2="4" />
                <polyline points="6 10 12 4 18 10" />
              </svg>
              <div className="text-center">
                <p>No beliefs to display yet.</p>
                <p className="mt-1 text-xs">Beliefs will appear here chronologically as you chat and build your memory.</p>
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-2xl space-y-8">
              {Object.entries(grouped).map(([date, items]) => (
                <div key={date}>
                  <div className="mb-4 flex items-center gap-3">
                    <h2 className="shrink-0 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {date}
                    </h2>
                    <Separator className="flex-1 opacity-30" />
                  </div>

                  <div className="relative space-y-0">
                    {/* Vertical line */}
                    <div className="absolute left-[7px] top-2 bottom-2 w-px bg-border/40" />

                    {items.map((belief) => {
                      const dotClass = dotColors[belief.type] ?? "bg-muted-foreground";
                      const accentClass = cardAccentColors[belief.type] ?? "border-l-border";
                      const badgeClass = typeColorMap[belief.type] ?? "bg-muted text-muted-foreground";

                      return (
                        <div key={belief.id} className="relative flex gap-3 py-2">
                          {/* Dot */}
                          <div className={cn("relative z-10 mt-2 h-[15px] w-[15px] shrink-0 rounded-full border-2 border-[#0f0f0f]", dotClass)} />

                          {/* Card */}
                          <Card className={cn("flex-1 gap-2 border-border/50 border-l-2 bg-card/40 py-3 transition-colors hover:bg-card/70", accentClass)}>
                            <div className="flex items-center justify-between px-4">
                              <Badge
                                variant="outline"
                                className={cn("rounded-md text-[10px] font-medium uppercase tracking-wider", badgeClass)}
                              >
                                {belief.type}
                              </Badge>
                              <span className="font-mono text-[10px] text-muted-foreground">
                                {new Date(belief.updated_at.replace(" ", "T")).toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </span>
                            </div>

                            <CardContent className="px-4 py-0">
                              <p className="text-sm leading-relaxed text-foreground/85">
                                {belief.statement}
                              </p>
                            </CardContent>

                            <div className="flex items-center gap-3 px-4">
                              <span className="font-mono text-[10px] text-muted-foreground">
                                confidence: {Math.round(belief.confidence * 100)}%
                              </span>
                              {belief.status !== "active" && (
                                <Badge variant="destructive" className="text-[10px]">
                                  {belief.status}
                                </Badge>
                              )}
                            </div>
                          </Card>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

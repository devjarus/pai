import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useBriefProvenance } from "../hooks/use-brief-provenance";
import type { BriefProvenanceBelief } from "../types";

const SOURCE_COLORS: Record<string, string> = {
  episode: "border-blue-500/20 bg-blue-500/10 text-blue-300",
  "user-said": "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
  document: "border-cyan-500/20 bg-cyan-500/10 text-cyan-300",
  web: "border-purple-500/20 bg-purple-500/10 text-purple-300",
  brief: "border-amber-500/20 bg-amber-500/10 text-amber-300",
  inferred: "border-orange-500/20 bg-orange-500/10 text-orange-300",
  synthesized: "border-pink-500/20 bg-pink-500/10 text-pink-300",
};

const SOURCE_ICONS: Record<string, string> = {
  episode: "\uD83D\uDCAC",
  "user-said": "\uD83D\uDC64",
  document: "\uD83D\uDCC4",
  web: "\uD83C\uDF10",
  brief: "\uD83D\uDCCB",
  inferred: "\uD83D\uDD2E",
  synthesized: "\uD83E\uDDE0",
};

const ORIGIN_BADGE: Record<string, { icon: string; label: string }> = {
  "user-said": { icon: "\uD83D\uDC64", label: "you said" },
  document: { icon: "\uD83D\uDCC4", label: "document" },
  web: { icon: "\uD83C\uDF10", label: "web" },
  inferred: { icon: "\uD83D\uDD2E", label: "inferred" },
  synthesized: { icon: "\uD83E\uDDE0", label: "synthesized" },
};

function ArrowSeparator() {
  return (
    <div className="flex justify-center py-1 text-muted-foreground/40">
      <ChevronDown className="h-4 w-4" />
    </div>
  );
}

export default function BriefProvenancePanel({
  briefId,
  onScrollToBelief,
}: {
  briefId: string;
  onScrollToBelief?: (beliefId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useBriefProvenance(briefId, open);

  const summaryParts: string[] = [];
  if (data) {
    if (data.beliefs.length > 0) summaryParts.push(`${data.beliefs.length} belief${data.beliefs.length === 1 ? "" : "s"}`);
    if (data.sources.length > 0) summaryParts.push(`${data.sources.length} source${data.sources.length === 1 ? "" : "s"}`);
    const corrections = data.beliefs.filter((b: BriefProvenanceBelief) => b.correctionState === "corrected").length;
    if (corrections > 0) summaryParts.push(`${corrections} correction${corrections === 1 ? "" : "s"}`);
  }

  return (
    <div className="rounded-lg border border-border/20 bg-card/30">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <span>Why this brief?</span>
        {summaryParts.length > 0 && (
          <span className="text-xs text-muted-foreground/60">
            {"\u00B7 " + summaryParts.join(" \u00B7 ")}
          </span>
        )}
      </button>

      {open && (
        <div className="border-t border-border/10 px-4 pb-4 pt-3 space-y-1">
          {isLoading && (
            <p className="text-xs text-muted-foreground animate-pulse">Loading provenance...</p>
          )}

          {data && (
            <>
              {/* Sources */}
              {data.sources.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-2">Sources</p>
                  <div className="flex flex-wrap gap-1.5">
                    {data.sources.map((s, i) => (
                      <Badge
                        key={i}
                        variant="outline"
                        className={`text-[10px] ${SOURCE_COLORS[s.kind] ?? "border-zinc-500/20 bg-zinc-500/10 text-zinc-300"}`}
                      >
                        {SOURCE_ICONS[s.kind] ?? "\u2753"} {s.label}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {data.sources.length > 0 && data.beliefs.length > 0 && <ArrowSeparator />}

              {/* Beliefs */}
              {data.beliefs.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-2">Beliefs</p>
                  <div className="space-y-2">
                    {data.beliefs.map((b: BriefProvenanceBelief) => (
                      <div
                        key={b.id}
                        className={`rounded-md border px-3 py-2 text-sm cursor-pointer transition-colors hover:border-foreground/20 ${
                          b.correctionState === "corrected"
                            ? "border-l-2 border-l-amber-500/60 border-border/20 bg-card/40"
                            : "border-border/20 bg-card/40"
                        }`}
                        onClick={() => onScrollToBelief?.(b.id)}
                      >
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-xs text-foreground">{b.statement}</span>
                          {b.origin && ORIGIN_BADGE[b.origin] && (
                            <Badge variant="outline" className="text-[10px] border-sky-500/20 bg-sky-500/10 text-sky-300">
                              {ORIGIN_BADGE[b.origin].icon} {ORIGIN_BADGE[b.origin].label}
                            </Badge>
                          )}
                          <Badge variant="outline" className="text-[10px]">
                            {b.confidence >= 0.8 ? "high" : b.confidence >= 0.5 ? "medium" : "low"}
                          </Badge>
                        </div>
                        {b.correctionState === "corrected" && b.supersedes && (
                          <p className="mt-1 text-[11px] text-amber-400/80">
                            was: {b.supersedes.statement}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {data.beliefs.length > 0 && data.evidence.length > 0 && <ArrowSeparator />}

              {/* Evidence */}
              {data.evidence.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-2">Evidence</p>
                  <div className="flex flex-wrap gap-1.5">
                    {data.evidence.map((e, i) => (
                      <Badge
                        key={i}
                        variant="outline"
                        className="text-[10px] border-border/30 bg-card/40 text-muted-foreground"
                      >
                        {e.title}
                        {e.freshness && <span className="ml-1 opacity-60">{e.freshness}</span>}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {data.evidence.length > 0 && data.recommendation && <ArrowSeparator />}

              {/* Recommendation */}
              {data.recommendation && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-2">Recommendation</p>
                  <div className="rounded-md border border-blue-500/20 bg-blue-500/5 px-3 py-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs text-foreground">{data.recommendation.summary}</span>
                      {data.recommendation.confidence && (
                        <Badge variant="outline" className="text-[10px] uppercase border-blue-500/20 bg-blue-500/10 text-blue-300">
                          {data.recommendation.confidence}
                        </Badge>
                      )}
                    </div>
                    {data.recommendation.rationale && (
                      <p className="mt-1 text-[11px] text-muted-foreground">{data.recommendation.rationale}</p>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

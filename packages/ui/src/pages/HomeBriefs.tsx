import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRightIcon, ChevronRightIcon, ChevronDownIcon, CheckCircleIcon, AlertCircleIcon } from "lucide-react";
import { useInboxAll } from "@/hooks/use-inbox";
import { usePrograms } from "@/hooks";
import { parseApiDate } from "@/lib/datetime";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

function timeAgo(dateStr: string): string {
  const diff = Date.now() - parseApiDate(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  return `${days}d ago`;
}

interface BriefSections {
  title?: string;
  recommendation?: { summary?: string; confidence?: string; rationale?: string };
  what_changed?: string[];
  evidence?: Array<{ title?: string; detail?: string; sourceLabel?: string; freshness?: string }>;
  memory_assumptions?: Array<{ statement?: string; confidence?: string; provenance?: string }>;
  next_actions?: Array<{ title?: string; timing?: string; detail?: string }>;
  correction_hook?: { prompt?: string };
  // Legacy fields
  greeting?: string;
  report?: string;
}

const confidenceColor: Record<string, string> = {
  high: "text-emerald-400",
  medium: "text-amber-400",
  low: "text-red-400",
};

export default function HomeBriefs() {
  const navigate = useNavigate();
  const { data, isLoading } = useInboxAll();
  const { data: programs = [] } = usePrograms();
  const briefings = data?.briefings ?? [];
  const activePrograms = programs.filter(p => p.status === "active" || p.status === "running");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-2xl px-6 py-8">

        {/* Programs overview */}
        {activePrograms.length > 0 && (
          <section className="mb-10">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground/60">Active Programs</h2>
              <button onClick={() => navigate("/programs")} className="flex items-center gap-1 text-[11px] text-primary hover:underline">
                View all <ChevronRightIcon className="size-3" />
              </button>
            </div>
            <div className="flex gap-3 overflow-x-auto pb-1">
              {activePrograms.slice(0, 5).map((p) => (
                <button
                  key={p.id}
                  onClick={() => navigate(`/programs?id=${p.id}`)}
                  className="shrink-0 rounded-lg border border-border/40 bg-card/50 px-4 py-3 text-left transition-colors hover:bg-card/80"
                  style={{ minWidth: 200 }}
                >
                  <p className="truncate text-sm font-medium text-foreground">{p.title}</p>
                  <div className="mt-2 flex items-center gap-2">
                    {p.phase && <Badge variant="outline" className="h-4 px-2 text-[9px]">{p.phase}</Badge>}
                    <span className="text-[10px] text-muted-foreground/50">
                      {p.latestBriefSummary ? timeAgo(p.latestBriefSummary.generatedAt) : "No briefs yet"}
                    </span>
                  </div>
                  {p.actionSummary && p.actionSummary.openCount > 0 && (
                    <p className="mt-2 text-[10px] text-amber-400">{p.actionSummary.openCount} open action{p.actionSummary.openCount !== 1 ? "s" : ""}</p>
                  )}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Briefs feed */}
        <section>
          <h2 className="mb-6 text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground/60">Recent Briefs</h2>

          {isLoading && (
            <div className="space-y-8">
              {[1, 2, 3].map((i) => (
                <div key={i} className="space-y-3 rounded-lg border border-border/30 p-4">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-5 w-3/4" />
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              ))}
            </div>
          )}

          {!isLoading && briefings.length === 0 && (
            <p className="py-16 text-center text-sm text-muted-foreground">No briefs yet. Create a Program to start.</p>
          )}

          <div className="flex flex-col gap-6">
            {briefings.map((brief) => {
              const s = brief.sections as BriefSections;
              const title = s.title || s.greeting?.slice(0, 80) || (brief.type === "research" ? "Research Report" : "Daily Briefing");
              const rec = s.recommendation;
              const changes = s.what_changed ?? [];
              const actions = s.next_actions ?? [];
              const evidence = s.evidence ?? [];
              const memories = s.memory_assumptions ?? [];
              const correction = s.correction_hook;
              const isExpanded = expandedId === brief.id;

              return (
                <article
                  key={brief.id}
                  className="group rounded-lg border border-border/30 bg-card/30 p-4 transition-colors hover:bg-card/50"
                >
                  {/* Clickable collapsed header */}
                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : brief.id)}
                    className="flex w-full items-start gap-3 text-left"
                  >
                    <ChevronDownIcon
                      className={cn(
                        "mt-1 size-4 shrink-0 text-muted-foreground/40 transition-transform duration-200",
                        isExpanded ? "rotate-0" : "-rotate-90"
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      {/* Badge + timestamp */}
                      <div className="mb-2 flex items-center gap-2">
                        <Badge variant="outline" className="h-4 px-2 text-[9px]">
                          {brief.type === "research" ? "Research" : "Brief"}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground/40">{timeAgo(brief.generatedAt)}</span>
                      </div>

                      {/* Title */}
                      <h3 className="mb-2 text-sm font-semibold text-foreground">{title}</h3>

                      {/* Recommendation summary (always visible) */}
                      {rec?.summary && (
                        <p className="text-xs text-muted-foreground line-clamp-2">{rec.summary}</p>
                      )}
                    </div>
                  </button>

                  {/* Expanded content */}
                  <div
                    className={cn(
                      "overflow-hidden transition-all duration-300",
                      isExpanded ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0"
                    )}
                  >
                    <div className="mt-4 space-y-3 pl-7">
                      {/* What changed */}
                      {changes.length > 0 && (
                        <div>
                          <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground/50">What Changed</h4>
                          <ul className="space-y-1">
                            {changes.slice(0, 3).map((c, i) => (
                              <li key={i} className="text-xs text-muted-foreground">• {c}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Recommendation detail */}
                      {rec?.summary && (
                        <div className="rounded-md bg-primary/5 border border-primary/10 px-3 py-2">
                          <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-primary/60">Recommendation</h4>
                          <p className="text-sm text-foreground">{rec.summary}</p>
                          {rec.confidence && (
                            <span className={cn("mt-1 inline-block text-[10px]", confidenceColor[rec.confidence] ?? "text-muted-foreground")}>
                              {rec.confidence} confidence
                            </span>
                          )}
                        </div>
                      )}

                      {/* Evidence */}
                      {evidence.length > 0 && (
                        <div>
                          <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground/50">Evidence</h4>
                          {evidence.slice(0, 2).map((e, i) => (
                            <div key={i} className="mb-1 text-xs text-muted-foreground">
                              <span className="font-medium text-foreground/80">{e.title}</span>
                              {e.detail && <span> — {e.detail}</span>}
                              {e.freshness && <span className="ml-1 text-[10px] text-muted-foreground/40">({e.freshness})</span>}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Memory assumptions */}
                      {memories.length > 0 && (
                        <div>
                          <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground/50">Memory Used</h4>
                          {memories.slice(0, 2).map((m, i) => (
                            <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                              <AlertCircleIcon className="mt-1 size-3 shrink-0 text-muted-foreground/40" />
                              <span>{m.statement}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Actions */}
                      {actions.length > 0 && (
                        <div>
                          <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground/50">Next Actions</h4>
                          {actions.slice(0, 3).map((a, i) => (
                            <div key={i} className="flex items-center gap-2 py-1 text-xs">
                              <CheckCircleIcon className="size-3 shrink-0 text-muted-foreground/40" />
                              <span className="text-foreground/80">{a.title}</span>
                              {a.timing && <span className="text-[10px] text-muted-foreground/40">{a.timing}</span>}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Correction hook */}
                      {correction?.prompt && (
                        <p className="text-[11px] italic text-muted-foreground/50">{correction.prompt}</p>
                      )}

                      {/* View full */}
                      <button
                        onClick={() => navigate(`/inbox/${brief.id}`)}
                        className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                      >
                        View full brief <ArrowRightIcon className="size-3" />
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}

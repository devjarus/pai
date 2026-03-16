import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { PlusIcon, SearchIcon, MoreVerticalIcon, PlayIcon, PauseIcon, ClockIcon, CheckCircleIcon } from "lucide-react";
import { usePrograms, usePauseProgram, useResumeProgram } from "@/hooks";
import { parseApiDate } from "@/lib/datetime";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type Tab = "active" | "drafts" | "archived";

function statusBadge(status: string) {
  const s = status.toLowerCase();
  if (s === "active" || s === "running") return <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-[10px]">● Active</Badge>;
  if (s === "paused") return <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30 text-[10px]">● Paused</Badge>;
  if (s === "draft") return <Badge className="bg-muted text-muted-foreground text-[10px]">● Draft</Badge>;
  return <Badge variant="outline" className="text-[10px]">{status}</Badge>;
}

function cadenceLabel(hours: number): string {
  if (hours <= 1) return "Hourly";
  if (hours <= 24) return "Daily";
  if (hours <= 168) return "Weekly";
  if (hours <= 720) return "Monthly";
  return "Quarterly";
}

function timeUntil(dateStr: string | null): string {
  if (!dateStr) return "—";
  const diff = parseApiDate(dateStr).getTime() - Date.now();
  if (diff < 0) return "Overdue";
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return "< 1h";
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export default function ProgramsNew() {
  const navigate = useNavigate();
  const { data: programs = [], isLoading } = usePrograms();
  const pauseMut = usePauseProgram();
  const resumeMut = useResumeProgram();
  const [tab, setTab] = useState<Tab>("active");
  const [search, setSearch] = useState("");

  const filtered = programs.filter((p) => {
    const s = p.status.toLowerCase();
    if (tab === "active") return s === "active" || s === "running";
    if (tab === "drafts") return s === "draft" || s === "paused";
    if (tab === "archived") return s === "completed" || s === "done" || s === "archived";
    return true;
  }).filter((p) => !search || p.title.toLowerCase().includes(search.toLowerCase()));

  const counts = {
    active: programs.filter(p => p.status === "active" || p.status === "running").length,
    drafts: programs.filter(p => p.status === "draft" || p.status === "paused").length,
    archived: programs.filter(p => ["completed", "done", "archived"].includes(p.status)).length,
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Header */}
      <header className="border-b border-border/40 bg-background">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-base font-bold tracking-tight text-foreground">Programs</h1>
            <p className="text-xs text-muted-foreground">Recurring decision workflows</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <SearchIcon className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 w-40 rounded-md border border-border/50 bg-muted/30 pl-8 pr-3 text-xs outline-none placeholder:text-muted-foreground focus:border-primary/50"
              />
            </div>
            <Button size="sm" className="gap-1.5 text-xs" onClick={() => navigate("/programs?create=true")}>
              <PlusIcon className="size-3.5" /> New Program
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-6 py-6">
          {/* Tabs */}
          <div className="mb-5 flex gap-6 border-b border-border/30">
            {(["active", "drafts", "archived"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  "pb-2 text-xs font-medium capitalize transition-colors",
                  tab === t ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t === "active" ? `Active (${counts.active})` : t === "drafts" ? `Drafts (${counts.drafts})` : `Archived (${counts.archived})`}
              </button>
            ))}
          </div>

          {/* Stats row */}
          <div className="mb-6 grid grid-cols-3 gap-3">
            <div className="rounded-lg border border-border/30 bg-card/40 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Active</p>
              <p className="mt-0.5 text-xl font-bold text-foreground">{counts.active}</p>
            </div>
            <div className="rounded-lg border border-border/30 bg-card/40 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Due This Week</p>
              <p className="mt-0.5 text-xl font-bold text-foreground">
                {programs.filter(p => p.nextRunAt && (parseApiDate(p.nextRunAt).getTime() - Date.now()) < 7 * 86400000 && (parseApiDate(p.nextRunAt).getTime() - Date.now()) > 0).length}
              </p>
            </div>
            <div className="rounded-lg border border-border/30 bg-card/40 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Open Actions</p>
              <p className="mt-0.5 text-xl font-bold text-foreground">
                {programs.reduce((sum, p) => sum + (p.actionSummary?.openCount ?? 0), 0)}
              </p>
            </div>
          </div>

          {/* Table */}
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-sm text-muted-foreground">
                {programs.length === 0 ? "No programs yet. Create one to start tracking decisions." : "No programs match your filter."}
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border/30">
              <div className="grid grid-cols-[2fr_1fr_1fr_1.5fr_auto] gap-3 border-b border-border/20 bg-card/20 px-4 py-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Program</span>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Status</span>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Cadence</span>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Latest</span>
                <span className="w-8" />
              </div>
              {filtered.map((program) => (
                <div
                  key={program.id}
                  onClick={() => navigate(`/programs?id=${program.id}`)}
                  className="grid cursor-pointer grid-cols-[2fr_1fr_1fr_1.5fr_auto] items-center gap-3 border-b border-border/10 px-4 py-3 transition-colors hover:bg-card/30 last:border-b-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{program.title}</p>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <span className="text-[10px] text-muted-foreground/50 capitalize">{program.family}</span>
                      {program.phase && <Badge variant="outline" className="h-3.5 px-1 text-[8px]">{program.phase}</Badge>}
                    </div>
                  </div>
                  <div>{statusBadge(program.status)}</div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <ClockIcon className="size-3" />
                    {cadenceLabel(program.intervalHours)}
                  </div>
                  <div className="min-w-0">
                    {program.latestBriefSummary ? (
                      <div>
                        <p className="truncate text-xs text-foreground/80">{program.latestBriefSummary.recommendationSummary || "Brief generated"}</p>
                        <p className="text-[10px] text-muted-foreground/40">{timeUntil(program.nextRunAt)} until next</p>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground/40">No briefs yet</span>
                    )}
                    {program.actionSummary && program.actionSummary.openCount > 0 && (
                      <div className="mt-0.5 flex items-center gap-1 text-[10px] text-amber-400">
                        <CheckCircleIcon className="size-3" />
                        {program.actionSummary.openCount} open
                      </div>
                    )}
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button onClick={(e) => e.stopPropagation()} className="p-1 text-muted-foreground/40 hover:text-foreground">
                        <MoreVerticalIcon className="size-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-32">
                      {program.status === "paused" ? (
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); resumeMut.mutate(program.id); }}>
                          <PlayIcon className="size-3.5" /> Resume
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); pauseMut.mutate(program.id); }}>
                          <PauseIcon className="size-3.5" /> Pause
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

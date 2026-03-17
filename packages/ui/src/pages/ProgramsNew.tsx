import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { PlusIcon, SearchIcon, MoreVerticalIcon, PlayIcon, PauseIcon, ClockIcon, CheckCircleIcon, Trash2Icon, PencilIcon } from "lucide-react";
import { usePrograms, useCreateProgram, useDeleteProgram, usePauseProgram, useResumeProgram } from "@/hooks";
import { parseApiDate } from "@/lib/datetime";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type Tab = "active" | "drafts" | "archived";
type Family = "general" | "work" | "travel" | "buying";

function statusBadge(status: string) {
  const s = status.toLowerCase();
  if (s === "active" || s === "running") return <Badge className={cn("bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-[10px]", s === "running" && "animate-pulse")}>● Active</Badge>;
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

const familyOptions: { value: Family; label: string; emoji: string }[] = [
  { value: "general", label: "General", emoji: "📋" },
  { value: "work", label: "Work", emoji: "💼" },
  { value: "travel", label: "Travel", emoji: "✈️" },
  { value: "buying", label: "Buying", emoji: "🛒" },
];

const cadenceOptions = [
  { value: 24, label: "Daily" },
  { value: 168, label: "Weekly" },
  { value: 720, label: "Monthly" },
];

export default function ProgramsNew() {
  const navigate = useNavigate();
  const { data: programs = [], isLoading } = usePrograms();
  const createMut = useCreateProgram();
  const deleteMut = useDeleteProgram();
  const pauseMut = usePauseProgram();
  const resumeMut = useResumeProgram();

  const [tab, setTab] = useState<Tab>("active");
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  // Create form state
  const [title, setTitle] = useState("");
  const [question, setQuestion] = useState("");
  const [family, setFamily] = useState<Family>("general");
  const [cadence, setCadence] = useState(24);

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

  const handleCreate = async () => {
    if (!title.trim() || !question.trim()) return;
    try {
      await createMut.mutateAsync({ title: title.trim(), question: question.trim(), family, intervalHours: cadence });
      toast.success("Program created");
      setShowCreate(false);
      setTitle(""); setQuestion(""); setFamily("general"); setCadence(24);
    } catch { toast.error("Failed to create program"); }
  };

  const handleDelete = async (id: string, name: string) => {
    setDeleteTarget({ id, name });
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try { await deleteMut.mutateAsync(deleteTarget.id); toast.success("Program deleted"); }
    catch { toast.error("Failed to delete"); }
    finally { setDeleteTarget(null); }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Header */}
      <header className="border-b border-border/40">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-base font-bold text-foreground">Programs</h1>
            <p className="text-xs text-muted-foreground">Recurring decision workflows</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <SearchIcon className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text" placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)}
                className="h-8 w-40 rounded-md border border-border/50 bg-muted/30 pl-8 pr-3 text-xs outline-none placeholder:text-muted-foreground focus:border-primary/50"
              />
            </div>
            <Button size="sm" className="gap-2 text-xs" onClick={() => setShowCreate(true)}>
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
              <button key={t} onClick={() => setTab(t)}
                className={cn("pb-2 text-xs font-medium capitalize transition-colors",
                  tab === t ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground")}>
                {t === "active" ? `Active (${counts.active})` : t === "drafts" ? `Drafts (${counts.drafts})` : `Archived (${counts.archived})`}
              </button>
            ))}
          </div>

          {/* Stats */}
          <div className="mb-6 grid grid-cols-3 gap-3">
            {[
              { label: "Active", value: counts.active },
              { label: "Due This Week", value: programs.filter(p => p.nextRunAt && (parseApiDate(p.nextRunAt).getTime() - Date.now()) > 0 && (parseApiDate(p.nextRunAt).getTime() - Date.now()) < 7 * 86400000).length },
              { label: "Open Actions", value: programs.reduce((s, p) => s + (p.actionSummary?.openCount ?? 0), 0) },
            ].map((stat) => (
              <div key={stat.label} className="rounded-lg border border-border/30 bg-card/40 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">{stat.label}</p>
                <p className="mt-1 text-xl font-bold text-foreground">{stat.value}</p>
              </div>
            ))}
          </div>

          {/* Table */}
          {isLoading ? (
            <div className="overflow-hidden rounded-lg border border-border/30">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="grid grid-cols-[2fr_1fr_1fr_1.5fr_auto] items-center gap-3 border-b border-border/10 px-4 py-3 last:border-b-0">
                  <div className="space-y-2"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-3 w-1/3" /></div>
                  <Skeleton className="h-5 w-16" />
                  <Skeleton className="h-4 w-14" />
                  <div className="space-y-2"><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-1/2" /></div>
                  <Skeleton className="h-4 w-4" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              {programs.length === 0 ? (
                <>
                  <p className="text-sm font-semibold text-foreground">Track an ongoing decision</p>
                  <p className="max-w-xs text-xs text-muted-foreground">Flight prices, product comparisons, job offers — anything you need monitored over time</p>
                  <Button size="sm" variant="outline" onClick={() => setShowCreate(true)} className="gap-2 text-xs">
                    <PlusIcon className="size-3.5" /> Create your first program
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">No programs match this filter</p>
                  <button onClick={() => { setSearch(""); setTab("active"); }} className="text-xs text-primary hover:underline">Clear filter</button>
                </>
              )}
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border/30">
              <div className="grid grid-cols-[2fr_1fr_1fr_1.5fr_auto] gap-3 border-b border-border/20 bg-card/20 px-4 py-2">
                {["Program", "Status", "Cadence", "Latest", ""].map((h) => (
                  <span key={h} className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">{h}</span>
                ))}
              </div>
              {filtered.map((program, i) => (
                <div key={program.id} onClick={() => navigate(`/programs?id=${program.id}`)}
                  className="grid cursor-pointer animate-in fade-in-0 duration-300 grid-cols-[2fr_1fr_1fr_1.5fr_auto] items-center gap-3 border-b border-border/10 px-4 py-3 transition-all hover:translate-x-0.5 hover:bg-card/30 last:border-b-0"
                  style={{ animationDelay: `${i * 50}ms` }}>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{program.title}</p>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground/40 capitalize">{program.family}</span>
                      {program.phase && <Badge variant="outline" className="h-3.5 px-1 text-[10px]">{program.phase}</Badge>}
                    </div>
                  </div>
                  <div>{statusBadge(program.status)}</div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <ClockIcon className="size-3" />{cadenceLabel(program.intervalHours)}
                  </div>
                  <div className="min-w-0">
                    {program.latestBriefSummary ? (
                      <>
                        <p className="truncate text-xs text-muted-foreground">{program.latestBriefSummary.recommendationSummary || "Brief generated"}</p>
                        <p className="text-[10px] text-muted-foreground/40">{timeUntil(program.nextRunAt)} until next</p>
                      </>
                    ) : <span className="text-xs text-muted-foreground/40">No briefs yet</span>}
                    {program.actionSummary && program.actionSummary.openCount > 0 && (
                      <div className="mt-1 flex items-center gap-1 text-[10px] text-amber-400">
                        <CheckCircleIcon className="size-3" />{program.actionSummary.openCount} open
                      </div>
                    )}
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button onClick={(e) => e.stopPropagation()} className="p-1 text-muted-foreground/40 hover:text-foreground">
                        <MoreVerticalIcon className="size-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-36">
                      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); navigate(`/programs?id=${program.id}`); }}>
                        <PencilIcon className="size-3.5" /> Edit
                      </DropdownMenuItem>
                      {program.status === "paused" ? (
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); resumeMut.mutate(program.id); }}>
                          <PlayIcon className="size-3.5" /> Resume
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); pauseMut.mutate(program.id); }}>
                          <PauseIcon className="size-3.5" /> Pause
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onClick={(e) => { e.stopPropagation(); handleDelete(program.id, program.title); }}>
                        <Trash2Icon className="size-3.5" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Create Program Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New Program</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Title</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Japan Trip October"
                className="w-full rounded-md border border-border/50 bg-muted/30 px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:border-primary/50" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">What should pai track?</label>
              <textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={3}
                placeholder="e.g. Monitor flight prices from SFO to Tokyo for Oct 12-24, nonstop preferred, under $1000"
                className="w-full rounded-md border border-border/50 bg-muted/30 px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:border-primary/50 resize-none" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Category</label>
                <div className="flex flex-wrap gap-2">
                  {familyOptions.map((f) => (
                    <button key={f.value} onClick={() => setFamily(f.value)}
                      className={cn("rounded-full border px-3 py-1 text-xs transition-colors",
                        family === f.value ? "border-primary/40 bg-primary/10 text-primary" : "border-border/50 text-muted-foreground hover:bg-accent")}>
                      {f.emoji} {f.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Check frequency</label>
                <div className="flex flex-wrap gap-2">
                  {cadenceOptions.map((c) => (
                    <button key={c.value} onClick={() => setCadence(c.value)}
                      className={cn("rounded-full border px-3 py-1 text-xs transition-colors",
                        cadence === c.value ? "border-primary/40 bg-primary/10 text-primary" : "border-border/50 text-muted-foreground hover:bg-accent")}>
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button size="sm" onClick={handleCreate} disabled={!title.trim() || !question.trim() || createMut.isPending}>
              {createMut.isPending ? "Creating..." : "Create Program"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Program</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Delete "{deleteTarget?.name}"? This cannot be undone.</p>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" size="sm" onClick={confirmDelete} disabled={deleteMut.isPending}>
              {deleteMut.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

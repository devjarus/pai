import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { useDigests, useDeleteDigest } from "@/hooks/use-digests";
import { useWatches } from "@/hooks/use-watches";
import { useTasks, useCompleteTask } from "@/hooks/use-tasks";
import { useLibraryStats, useQualityScore } from "@/hooks/use-library";
import { useJobs } from "@/hooks/use-jobs";
import { timeAgoCompact } from "@/lib/datetime";
import { cn, stripMarkdown } from "@/lib/utils";
import {
  CheckCircle2Icon,
  BrainIcon,
  FileTextIcon,
  FlaskConicalIcon,
  SearchIcon,
  AlertCircleIcon,
  LoaderIcon,
  Trash2Icon,
} from "lucide-react";
import { QueryError } from "@/components/QueryError";
import { ConfirmDialog } from "@/components/ConfirmDialog";

// ---------------------------------------------------------------------------
// Smart data extraction — handles garbage LLM output gracefully
// ---------------------------------------------------------------------------

/** Patterns that indicate LLM preamble or failure — not real content */
const JUNK_PATTERNS = [
  /^based on (my |the |available )?research/i,
  /^I (apologize|was unable|encountered|cannot)/i,
  /^(Let me|I'll now|I can now|Here('s| is))/i,
  /^This brief summarizes/i,
  /^A new research run completed/i,
  /^Unable to retrieve/i,
  /^\{/,
  /^research and compile/i,
];

function isJunkSummary(text: string): boolean {
  return JUNK_PATTERNS.some(p => p.test(text.trim()));
}

function isFailedDigest(sections: Record<string, unknown>): boolean {
  const rec = sections.recommendation as Record<string, unknown> | undefined;
  const summary = typeof rec === "object" ? String(rec?.summary ?? "") : "";
  return /unable|apologize|failed|unavailable|error/i.test(summary);
}

function cleanSummary(raw: string): string | null {
  let s = raw.trim();
  s = s.replace(/^(Based on[^,:.]+[,:.]\s*)/i, "");
  s = s.replace(/^(I'll now[^,:.]+[,:.]\s*)/i, "");
  s = s.replace(/^(Let me[^,:.]+[,:.]\s*)/i, "");
  s = s.replace(/^(Here('s| is)[^,:.]+[,:.]\s*)/i, "");
  s = s.replace(/^(A new research run[^,:.]+[,:.]\s*)/i, "");
  s = stripMarkdown(s);
  // If after cleaning we have less than 15 chars of real content, it's junk
  if (!s || s.length < 15) return null;
  // If it still starts with a junk pattern after cleaning, give up
  if (isJunkSummary(s)) return null;
  return s;
}

function extractSummary(sections: Record<string, unknown>): string | null {
  if (!sections) return null;
  const rec = sections.recommendation as Record<string, unknown> | string | undefined;

  // Try recommendation.summary
  if (typeof rec === "object" && rec?.summary) {
    const cleaned = cleanSummary(String(rec.summary));
    if (cleaned) return cleaned;
    // Try rationale
    const rCleaned = cleanSummary(String(rec.rationale ?? ""));
    if (rCleaned) return rCleaned;
  }
  if (typeof rec === "string") {
    const cleaned = cleanSummary(rec);
    if (cleaned) return cleaned;
  }

  // Try what_changed
  const changes = sections.what_changed as string[] | undefined;
  if (changes?.length) {
    for (const c of changes) {
      const cleaned = cleanSummary(c);
      if (cleaned) return cleaned;
    }
  }

  // Try evidence
  const evidence = sections.evidence as Array<{ detail?: string }> | undefined;
  if (evidence?.length) {
    const first = evidence.find(e => e.detail && e.detail.length > 15 && !isJunkSummary(e.detail));
    if (first?.detail) return first.detail.slice(0, 200);
  }

  return null;
}

function extractTitle(sections: Record<string, unknown>, fallbackType: string): string {
  let raw = sections.title ? String(sections.title) : "";

  // Strip common goal preambles to get to the actual topic
  raw = raw.replace(/^Keep watching this (conversation|topic) and brief me on meaningful changes:\s*/i, "");
  raw = raw.replace(/^Research and compile a brief (summary|report) (of |about )?/i, "");
  raw = raw.replace(/^Provide a deep-dive analysis of\s*/i, "");
  raw = raw.replace(/^Research\s+/i, "");
  raw = raw.replace(/^Track\s+/i, "Track ");
  raw = stripMarkdown(raw);

  // Capitalize first letter
  if (raw.length > 0) raw = raw.charAt(0).toUpperCase() + raw.slice(1);

  if (raw.length > 55) return raw.slice(0, 52) + "...";
  return raw || (fallbackType === "daily" ? "Daily Digest" : "Research Report");
}

/** Shorten watch title — extract the actual topic from verbose goal text */
function shortWatchTitle(title: string): string {
  // "Keep watching this conversation and brief me on meaningful changes: how is crypto doing now"
  // → "how is crypto doing now"
  const colonMatch = title.match(/:\s*(.{5,})/);
  if (colonMatch && title.length > 50) return colonMatch[1]!.slice(0, 40);
  if (title.startsWith("Research and compile")) return title.replace(/^Research and compile a brief ?(summary|report)? ?(of |about )?/i, "").slice(0, 40) || title.slice(0, 40);
  if (title.length > 45) return title.slice(0, 42) + "...";
  return title;
}

type DigestItem = { id: string; generatedAt: string; sections: Record<string, unknown>; status: string; type: string };

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Home() {
  const navigate = useNavigate();
  const [askQuery, setAskQuery] = useState("");

  useEffect(() => { document.title = "pai"; }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-4 py-6 md:px-6 md:py-10">

          {/* Greeting + Ask */}
          <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">{greeting()}</h1>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const q = askQuery.trim();
                navigate(q ? `/ask?q=${encodeURIComponent(q)}` : "/ask");
              }}
              className="flex w-full max-w-sm"
            >
              <div className="relative flex-1">
                <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/40" />
                <input
                  type="text"
                  value={askQuery}
                  onChange={(e) => setAskQuery(e.target.value)}
                  placeholder="Ask pai anything..."
                  className="w-full rounded-full border border-border/30 bg-muted/20 py-2 pl-9 pr-4 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none transition-all focus:border-primary/40 focus:bg-background focus:ring-1 focus:ring-primary/20"
                />
              </div>
            </form>
          </div>

          {/* Two-column */}
          <div className="flex flex-col gap-10 lg:flex-row">
            <div className="min-w-0 flex-1">
              <DigestFeed />
            </div>
            <aside className="flex w-full flex-col lg:w-64 lg:shrink-0 lg:border-l lg:border-border/15 lg:pl-8">
              <ActiveJobsBanner />
              <div className="flex flex-col gap-10">
                <WatchesPanel />
                <TodosPanel />
              </div>
              <div className="pt-2 mt-8">
                <LibraryPanel />
              </div>
              <div className="mt-6">
                <QualityPanel />
              </div>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Digest Feed
// ---------------------------------------------------------------------------

function DigestFeed() {
  const { data, isLoading, isError, refetch } = useDigests();
  const digests = data?.digests ?? [];
  const [showAll, setShowAll] = useState(false);
  const [deletingDigest, setDeletingDigest] = useState<DigestItem | null>(null);
  const deleteMut = useDeleteDigest();

  const handleConfirmDelete = async () => {
    if (!deletingDigest) return;
    const target = deletingDigest;
    setDeletingDigest(null);
    try {
      await deleteMut.mutateAsync(target.id);
      toast.success("Digest deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete digest");
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-36 w-full rounded-xl" />
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
      </div>
    );
  }

  if (isError) {
    return <QueryError message="Failed to load digests." onRetry={refetch} />;
  }

  if (digests.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="mb-3 text-4xl">📡</div>
        <p className="text-base font-medium text-foreground/80">Nothing yet</p>
        <p className="mt-1 text-sm text-muted-foreground/60">
          <Link to="/watches" className="text-primary hover:underline">Create a Watch</Link> and your first digest will appear here.
        </p>
      </div>
    );
  }

  // Separate good digests from failed ones
  const good: DigestItem[] = [];
  const failed: DigestItem[] = [];
  for (const d of digests) {
    if (isFailedDigest(d.sections as Record<string, unknown>)) failed.push(d);
    else good.push(d);
  }

  const hero = good[0];
  const rest = good.slice(1);
  const showRest = showAll ? rest : rest.slice(0, 7);

  return (
    <div>
      {/* Hero */}
      {hero && <HeroDigest digest={hero} onDelete={setDeletingDigest} />}

      {/* Feed */}
      {rest.length > 0 && (
        <div className="mt-6">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/40">Earlier</div>
          <div className="space-y-px">
            {showRest.map((d, i) => (
              <div key={d.id} className={i < 7 ? "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1" : ""} style={i < 7 ? { animationDelay: `${i * 40}ms`, animationFillMode: "both" } : undefined}>
                <CompactDigest digest={d} onDelete={setDeletingDigest} />
              </div>
            ))}
          </div>
          {!showAll && rest.length > 7 && (
            <button type="button" onClick={() => setShowAll(true)} className="mt-2 w-full py-2 text-center text-xs text-primary/60 hover:text-primary transition-colors">
              Show {rest.length - 7} more
            </button>
          )}
        </div>
      )}

      {/* Failed digests — collapsed, dimmed */}
      {failed.length > 0 && (
        <details className="mt-6">
          <summary className="cursor-pointer text-[11px] text-muted-foreground/40 hover:text-muted-foreground/60">
            <AlertCircleIcon className="mr-1 inline size-3" />{failed.length} incomplete digest{failed.length > 1 ? "s" : ""}
          </summary>
          <div className="mt-2 space-y-px opacity-50">
            {failed.slice(0, 5).map((d) => <CompactDigest key={d.id} digest={d} onDelete={setDeletingDigest} />)}
          </div>
        </details>
      )}

      <ConfirmDialog
        open={!!deletingDigest}
        onOpenChange={(open) => { if (!open) setDeletingDigest(null); }}
        title="Delete Digest"
        confirmLabel="Delete"
        onConfirm={handleConfirmDelete}
      >
        Delete{" "}
        <strong className="text-foreground/80">
          &quot;{deletingDigest ? extractTitle(deletingDigest.sections, deletingDigest.type) : ""}&quot;
        </strong>
        ? This cannot be undone.
      </ConfirmDialog>
    </div>
  );
}

function HeroDigest({ digest, onDelete }: { digest: DigestItem; onDelete: (d: DigestItem) => void }) {
  const sections = digest.sections as Record<string, unknown>;
  const summary = extractSummary(sections);
  const title = extractTitle(sections, digest.type);

  return (
    <div className="group relative">
      <Link
        to={`/digests/${digest.id}`}
        className={`block rounded-xl border bg-card/50 p-6 transition-all duration-200 hover:bg-card/70 hover:-translate-y-0.5 hover:shadow-lg ${
          digest.type === "research" ? "border-indigo-500/15 hover:border-indigo-500/30" : "border-amber-500/15 hover:border-amber-500/30"
        }`}
      >
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground/50">
          <span className={`h-1.5 w-1.5 rounded-full ${digest.type === "research" ? "bg-indigo-400" : "bg-amber-400"}`} />
          <span className="capitalize">{digest.type}</span>
          <span>·</span>
          <span>{timeAgoCompact(digest.generatedAt)}</span>
        </div>
        <h2 className="mt-3 text-lg font-semibold leading-snug text-foreground group-hover:text-primary transition-colors">
          {title}
        </h2>
        {summary && (
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground line-clamp-3">{summary}</p>
        )}
      </Link>
      <button
        type="button"
        aria-label="Delete digest"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(digest); }}
        className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/60 opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive focus:opacity-100 group-hover:opacity-100"
      >
        <Trash2Icon className="size-3.5" />
      </button>
    </div>
  );
}

function CompactDigest({ digest, onDelete }: { digest: DigestItem; onDelete: (d: DigestItem) => void }) {
  const sections = digest.sections as Record<string, unknown>;
  const summary = extractSummary(sections);
  const title = extractTitle(sections, digest.type);

  return (
    <div className="group relative">
      <Link
        to={`/digests/${digest.id}`}
        className="flex items-start gap-3 px-3 py-2.5 transition-colors hover:bg-muted/20"
      >
        <div className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${digest.type === "research" ? "bg-indigo-400/60" : "bg-amber-400/60"}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-foreground/85 group-hover:text-primary transition-colors truncate">{title}</span>
            <span className="shrink-0 pr-7 text-[10px] tabular-nums text-muted-foreground/40">{timeAgoCompact(digest.generatedAt)}</span>
          </div>
          {summary && <p className="mt-0.5 text-xs text-muted-foreground/55 line-clamp-1">{summary}</p>}
        </div>
      </Link>
      <button
        type="button"
        aria-label="Delete digest"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(digest); }}
        className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground/50 opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive focus:opacity-100 group-hover:opacity-100"
      >
        <Trash2Icon className="size-3" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

function ActiveJobsBanner() {
  const { data } = useJobs();
  const jobs = data?.jobs ?? [];
  const active = jobs.filter((j: { status: string }) => j.status === "running" || j.status === "pending");
  if (active.length === 0) return null;

  const running = active.filter((j: { status: string }) => j.status === "running").length;
  const pending = active.length - running;

  return (
    <Link to="/jobs" className="mb-6 flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-primary transition-colors hover:bg-primary/10">
      <LoaderIcon className="size-3.5 animate-spin" />
      <span>
        {running > 0 && `${running} running`}
        {running > 0 && pending > 0 && ", "}
        {pending > 0 && `${pending} queued`}
      </span>
    </Link>
  );
}

function WatchesPanel() {
  const { data: watches, isLoading } = useWatches();
  const items = (watches ?? []).slice(0, 6);

  return (
    <section>
      <SidebarTitle label="Watches" to="/watches" count={watches?.length} />
      {isLoading ? <SidebarSkeleton rows={3} /> : items.length === 0 ? (
        <p className="text-xs text-muted-foreground/50">
          No watches. <Link to="/watches" className="text-primary hover:underline">Create one</Link>
        </p>
      ) : (
        <ul className="space-y-0.5">
          {items.map((w) => (
            <li key={w.id}>
              <Link to="/watches" className="flex items-center gap-2 rounded px-1 py-1 text-[13px] transition-colors hover:bg-muted/30">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${w.status === "active" ? "bg-emerald-400" : "bg-amber-400/60"}`} />
                <span className="min-w-0 flex-1 truncate text-foreground/70">{shortWatchTitle(w.title)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TodosPanel() {
  const { data: tasks, isLoading } = useTasks({ status: "open" });
  const completeMut = useCompleteTask();
  const items = (tasks ?? []).slice(0, 5);

  return (
    <section>
      <SidebarTitle label="To-Dos" to="/tasks" count={tasks?.length} />
      {isLoading ? <SidebarSkeleton rows={2} /> : items.length === 0 ? (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground/50">
          <CheckCircle2Icon className="size-3 opacity-40" /> All clear
        </span>
      ) : (
        <ul className="space-y-0.5">
          {items.map((t) => (
            <li key={t.id} className="group/todo flex items-start gap-2 rounded px-1 py-1 text-[13px] hover:bg-muted/30">
              <button
                type="button"
                disabled={completeMut.isPending}
                onClick={() => completeMut.mutate(t.id)}
                className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border border-border/40 transition-all hover:border-emerald-400 hover:bg-emerald-400/20 active:scale-90"
              />
              <span className="min-w-0 flex-1 text-foreground/70 line-clamp-1 group-hover/todo:text-foreground/90">{t.title}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function LibraryPanel() {
  const { data: stats, isLoading } = useLibraryStats();

  return (
    <section>
      <SidebarTitle label="Library" to="/library" />
      {isLoading ? <SidebarSkeleton rows={1} /> : stats ? (
        <div className="flex gap-4 text-[12px]">
          {[
            { Icon: BrainIcon, v: stats.beliefs.active, l: "memories" },
            { Icon: FileTextIcon, v: stats.documentsCount, l: "docs" },
            { Icon: FlaskConicalIcon, v: stats.findingsCount, l: "findings" },
          ].map((s) => (
            <div key={s.l} className="flex items-center gap-1 text-muted-foreground/60">
              <s.Icon className="size-3" />
              <span className="font-semibold text-foreground/80">{s.v}</span>
              <span className="text-[10px]">{s.l}</span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function SidebarTitle({ label, to, count }: { label: string; to: string; count?: number }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <Link to={to} className="text-sm font-semibold text-foreground/80 hover:text-foreground">{label}</Link>
      {count != null && count > 0 && <span className="text-[10px] text-muted-foreground/35">{count}</span>}
    </div>
  );
}

function SidebarSkeleton({ rows }: { rows: number }) {
  return <div className="space-y-2">{Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}</div>;
}

// ---------------------------------------------------------------------------
// Tip
// ---------------------------------------------------------------------------

function QualityPanel() {
  const { data: quality } = useQualityScore();
  if (!quality) return null;

  const statusTone: Record<string, string> = {
    good: "text-emerald-400",
    warning: "text-amber-400",
    bad: "text-red-400",
    insufficient_data: "text-muted-foreground",
  };
  const domainEntries = [
    { key: "trust", domain: quality.domains.trust },
    { key: "loop-efficacy", domain: quality.domains.loopEfficacy },
    { key: "reliability", domain: quality.domains.reliability },
    { key: "user-value", domain: quality.domains.userValue },
  ] as const;
  const scoredDomainCount = domainEntries.filter(({ domain }) => domain.status !== "insufficient_data").length;
  const barColor = quality.status === "insufficient_data"
    ? "bg-muted-foreground/40"
    : quality.status === "good"
      ? "bg-emerald-500"
      : quality.status === "warning"
        ? "bg-amber-500"
        : "bg-red-500";

  function formatStatus(status: string): string {
    if (status === "insufficient_data") return "Insufficient data";
    return status.replace("_", " ");
  }

  return (
    <div className="space-y-2">
      <SidebarTitle
        label="Quality"
        to="/settings"
        count={quality.status === "insufficient_data" ? undefined : quality.score}
      />
      <div className="h-1.5 rounded-full bg-muted/30 overflow-hidden">
        <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${quality.score}%` }} />
      </div>
      <p className={cn("text-[10px]", statusTone[quality.status])}>
        {quality.status === "insufficient_data"
          ? `Insufficient data: ${scoredDomainCount}/${domainEntries.length} domains scored`
          : quality.blockingDomains.length > 0
            ? `Blocked by ${quality.blockingDomains.join(", ")}`
            : formatStatus(quality.status)}
      </p>
      <div className="grid grid-cols-2 gap-1.5 text-[10px]">
        {domainEntries.map(({ key, domain }) => (
          <div key={key} className="rounded-md border border-border/30 bg-muted/10 px-2 py-1.5">
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium text-foreground/80">{domain.label}</p>
              <p className={cn("font-semibold", statusTone[domain.status])}>{domain.score}%</p>
            </div>
            <p className={cn("mt-0.5 text-[9px]", statusTone[domain.status])}>
              {formatStatus(domain.status)}
              {domain.status === "insufficient_data" ? ` ${domain.sufficientMetricCount}/${domain.metricCount}` : ""}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

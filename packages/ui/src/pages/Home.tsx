import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useDigests } from "@/hooks/use-digests";
import { useWatches } from "@/hooks/use-watches";
import { useTasks, useCompleteTask } from "@/hooks/use-tasks";
import { useLibraryStats } from "@/hooks/use-library";
import { parseApiDate } from "@/lib/datetime";
import {
  ArrowRightIcon,
  CheckCircle2Icon,
  BrainIcon,
  FileTextIcon,
  FlaskConicalIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(dateStr: string): string {
  const d = parseApiDate(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const TYPE_COLORS: Record<string, string> = {
  research: "border-l-blue-500",
  daily: "border-l-emerald-500",
};

function extractSummary(sections: Record<string, unknown> | undefined): string | null {
  if (!sections) return null;
  const rec = sections.recommendation as Record<string, unknown> | string | undefined;
  if (typeof rec === "object") {
    const summary = String(rec.summary ?? "");
    if (summary.length > 10) return summary;
    const rationale = String(rec.rationale ?? "");
    if (rationale.length > 10) return rationale;
  }
  if (typeof rec === "string" && rec.length > 10) return rec;
  if (sections.title && String(sections.title).length > 5) return String(sections.title);
  const changes = sections.what_changed as string[] | undefined;
  if (changes?.length) return changes[0]!;
  return null;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Home() {
  const navigate = useNavigate();
  const [askQuery, setAskQuery] = useState("");

  useEffect(() => { document.title = "Home - pai"; }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Clean header — just brand + ask */}
      <header className="flex items-center gap-4 border-b border-border/30 px-4 py-3 md:px-6">
        <span className="text-base font-semibold text-foreground">pai</span>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const q = askQuery.trim();
            navigate(q ? `/ask?q=${encodeURIComponent(q)}` : "/ask");
          }}
          className="flex max-w-lg flex-1"
        >
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/50" />
            <input
              type="text"
              value={askQuery}
              onChange={(e) => setAskQuery(e.target.value)}
              placeholder="Ask pai anything..."
              className="w-full rounded-full border border-border/40 bg-muted/30 py-2 pl-9 pr-4 text-sm text-foreground placeholder:text-muted-foreground/60 outline-none transition-all focus:border-primary/40 focus:bg-background focus:shadow-sm"
            />
          </div>
        </form>
      </header>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-4 py-5 md:px-6 md:py-8">

          {/* Two-column layout */}
          <div className="flex flex-col gap-8 lg:flex-row">

            {/* PRIMARY: Digest feed */}
            <div className="min-w-0 flex-1">
              <DigestFeed />
            </div>

            {/* SIDEBAR */}
            <aside className="flex w-full flex-col gap-6 lg:w-64 lg:shrink-0">
              <WatchesPanel />
              <TodosPanel />
              <LibraryPanel />
              <TipBanner />
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
  const { data, isLoading } = useDigests();
  const digests = data?.digests ?? [];

  return (
    <section>
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-foreground">Your Digests</h2>
        {digests.length > 0 && (
          <span className="text-xs text-muted-foreground">{digests.length} total</span>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-lg border-l-4 border-l-border bg-card/30 p-4">
              <Skeleton className="mb-2 h-3 w-24" />
              <Skeleton className="mb-1 h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ))}
        </div>
      ) : digests.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/40 py-16 text-center">
          <p className="text-sm text-muted-foreground">No digests yet</p>
          <p className="mt-1 text-xs text-muted-foreground/60">
            Create a <Link to="/watches" className="text-primary hover:underline">Watch</Link> and digests will appear here as research runs.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {digests.slice(0, 10).map((d) => {
            const sections = d.sections as Record<string, unknown>;
            const summary = extractSummary(sections);
            const title = sections.title ? String(sections.title) : d.type;
            const borderColor = TYPE_COLORS[d.type] ?? "border-l-border";

            return (
              <Link
                key={d.id}
                to={`/digests/${d.id}`}
                className={`group block rounded-lg border-l-4 ${borderColor} bg-card/40 px-4 py-3 transition-colors hover:bg-card/70`}
              >
                {/* Top line: title + time */}
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                    {title}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground/60">
                    {timeAgo(d.generatedAt)}
                  </span>
                </div>

                {/* Summary */}
                {summary && (
                  <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground line-clamp-2">
                    {summary}
                  </p>
                )}

                {/* Type badge — subtle */}
                <div className="mt-2 flex items-center gap-2">
                  <Badge variant="secondary" className="text-[10px] font-normal capitalize">
                    {d.type}
                  </Badge>
                </div>
              </Link>
            );
          })}

          {digests.length > 10 && (
            <Link
              to="/digests"
              className="flex items-center justify-center gap-1 py-3 text-xs text-primary hover:text-primary/80"
            >
              View all {digests.length} digests <ArrowRightIcon className="size-3" />
            </Link>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Sidebar: Watches
// ---------------------------------------------------------------------------

function WatchesPanel() {
  const { data: watches, isLoading } = useWatches();
  const items = (watches ?? []).slice(0, 6);

  return (
    <section>
      <SidebarHeader label="Watches" to="/watches" count={watches?.length} />
      {isLoading ? (
        <SidebarSkeleton rows={3} />
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No watches yet. <Link to="/watches" className="text-primary hover:underline">Create one</Link>
        </p>
      ) : (
        <ul className="space-y-0.5">
          {items.map((w) => (
            <li key={w.id}>
              <Link
                to="/watches"
                className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] transition-colors hover:bg-muted/50"
              >
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${w.status === "active" ? "bg-emerald-500" : "bg-amber-500"}`} />
                <span className="min-w-0 flex-1 truncate text-foreground/80">{w.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Sidebar: To-Dos
// ---------------------------------------------------------------------------

function TodosPanel() {
  const { data: tasks, isLoading } = useTasks({ status: "open" });
  const completeMut = useCompleteTask();
  const items = (tasks ?? []).slice(0, 5);

  return (
    <section>
      <SidebarHeader label="To-Dos" to="/tasks" count={tasks?.length} />
      {isLoading ? (
        <SidebarSkeleton rows={3} />
      ) : items.length === 0 ? (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CheckCircle2Icon className="size-3 opacity-40" />
          All caught up
        </div>
      ) : (
        <ul className="space-y-0.5">
          {items.map((t) => (
            <li key={t.id} className="flex items-start gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors hover:bg-muted/50">
              <button
                type="button"
                disabled={completeMut.isPending}
                onClick={() => completeMut.mutate(t.id)}
                className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border border-border/50 transition-colors hover:border-primary hover:bg-primary/10"
              />
              <span className="min-w-0 flex-1 text-foreground/80 line-clamp-1">{t.title}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Sidebar: Library
// ---------------------------------------------------------------------------

function LibraryPanel() {
  const { data: stats, isLoading } = useLibraryStats();

  return (
    <section>
      <SidebarHeader label="Library" to="/library" />
      {isLoading ? (
        <SidebarSkeleton rows={1} />
      ) : stats ? (
        <div className="flex gap-4 text-[13px]">
          <StatPill icon={BrainIcon} value={stats.beliefs.active} label="memories" />
          <StatPill icon={FileTextIcon} value={stats.documentsCount} label="docs" />
          <StatPill icon={FlaskConicalIcon} value={stats.findingsCount} label="findings" />
        </div>
      ) : null}
    </section>
  );
}

function StatPill({ icon: Icon, value, label }: { icon: React.ElementType; value: number; label: string }) {
  return (
    <div className="flex items-center gap-1 text-muted-foreground">
      <Icon className="size-3" />
      <span className="font-medium text-foreground">{value}</span>
      <span className="text-[10px]">{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sidebar shared components
// ---------------------------------------------------------------------------

function SidebarHeader({ label, to, count }: { label: string; to: string; count?: number }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <h3 className="text-xs font-medium text-muted-foreground">{label}{count != null && count > 0 ? ` (${count})` : ""}</h3>
      <Link to={to} className="text-[10px] text-primary/70 hover:text-primary">View all</Link>
    </div>
  );
}

function SidebarSkeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-4 w-full" />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tip Banner — subtle, dismissible
// ---------------------------------------------------------------------------

const TIPS = [
  { text: "Say \"Keep me updated on GitHub trending AI repos\" to create a Watch with structured feeds.", tag: "Watches" },
  { text: "Rate digests with stars — low ratings improve future ones.", tag: "Digests" },
  { text: "Click the pencil on any memory assumption to correct it inline.", tag: "Library" },
  { text: "Create Watches from templates: Price, News, Competitor, Availability.", tag: "Watches" },
  { text: "Search across memories, documents, and findings in Library.", tag: "Library" },
  { text: "Digests suggest to-dos — check the bottom of each digest.", tag: "Tasks" },
  { text: "Connect via Telegram for digest push notifications.", tag: "Telegram" },
  { text: "Use pai as an MCP server with Claude Code or Cursor.", tag: "MCP" },
];

function TipBanner() {
  const [dismissed, setDismissed] = useState<Set<number>>(() => {
    try {
      const stored = localStorage.getItem("pai-dismissed-tips");
      return stored ? new Set(JSON.parse(stored) as number[]) : new Set();
    } catch { return new Set(); }
  });

  const visible = TIPS.map((t, i) => ({ ...t, i })).filter(t => !dismissed.has(t.i));
  const tip = visible.length > 0 ? visible[Math.floor(Date.now() / 86400000) % visible.length] : null;
  if (!tip) return null;

  const dismiss = () => {
    const next = new Set(dismissed);
    next.add(tip.i);
    setDismissed(next);
    localStorage.setItem("pai-dismissed-tips", JSON.stringify([...next]));
  };

  return (
    <div className="rounded-md border border-border/30 bg-muted/20 px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] leading-relaxed text-muted-foreground">{tip.text}</p>
        <button type="button" onClick={dismiss} className="shrink-0 text-muted-foreground/40 hover:text-muted-foreground">
          <XIcon className="size-3" />
        </button>
      </div>
    </div>
  );
}

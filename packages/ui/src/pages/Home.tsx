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

type DigestItem = { id: string; generatedAt: string; sections: Record<string, unknown>; status: string; type: string };

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Home() {
  const navigate = useNavigate();
  const [askQuery, setAskQuery] = useState("");

  useEffect(() => { document.title = "Home - pai"; }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <header className="flex items-center gap-4 border-b border-border/20 px-4 py-3 md:px-6">
        <span className="text-lg font-bold tracking-tight text-foreground">pai</span>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const q = askQuery.trim();
            navigate(q ? `/ask?q=${encodeURIComponent(q)}` : "/ask");
          }}
          className="ml-auto flex w-full max-w-sm"
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
      </header>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-10">
          <div className="flex flex-col gap-10 lg:flex-row">

            {/* PRIMARY — digest feed */}
            <div className="min-w-0 flex-1">
              <DigestFeed />
            </div>

            {/* SIDEBAR — separated with a thin border */}
            <aside className="flex w-full flex-col gap-8 lg:w-72 lg:shrink-0 lg:border-l lg:border-border/20 lg:pl-8">
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
// Digest Feed — hero first item, compact rest
// ---------------------------------------------------------------------------

function DigestFeed() {
  const { data, isLoading } = useDigests();
  const digests = data?.digests ?? [];

  if (isLoading) {
    return (
      <section>
        <Skeleton className="mb-6 h-7 w-48" />
        <div className="mb-8 space-y-3">
          <Skeleton className="h-32 w-full rounded-xl" />
        </div>
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      </section>
    );
  }

  if (digests.length === 0) {
    return (
      <section>
        <h1 className="mb-6 text-2xl font-bold tracking-tight text-foreground">Your Digests</h1>
        <div className="py-20 text-center">
          <p className="text-base text-muted-foreground">No digests yet</p>
          <p className="mt-2 text-sm text-muted-foreground/60">
            Create a <Link to="/watches" className="text-primary hover:underline">Watch</Link> to start receiving research digests.
          </p>
        </div>
      </section>
    );
  }

  const [hero, ...rest] = digests;

  return (
    <section>
      <h1 className="mb-6 text-2xl font-bold tracking-tight text-foreground">Your Digests</h1>

      {/* HERO — latest digest, bigger treatment */}
      {hero && <HeroDigest digest={hero} />}

      {/* REST — compact feed */}
      {rest.length > 0 && (
        <div className="mt-6">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Earlier</span>
            {digests.length > 10 && (
              <Link to="/digests" className="inline-flex items-center gap-1 text-[11px] text-primary/70 hover:text-primary">
                All {digests.length} <ArrowRightIcon className="size-3" />
              </Link>
            )}
          </div>
          <div className="space-y-1">
            {rest.slice(0, 9).map((d) => <CompactDigest key={d.id} digest={d} />)}
          </div>
        </div>
      )}
    </section>
  );
}

function HeroDigest({ digest }: { digest: DigestItem }) {
  const sections = digest.sections as Record<string, unknown>;
  const summary = extractSummary(sections);
  const title = sections.title ? String(sections.title) : digest.type;

  return (
    <Link
      to={`/digests/${digest.id}`}
      className="group block rounded-xl border border-border/30 bg-card/50 p-5 transition-all hover:border-border/50 hover:bg-card/70 hover:shadow-sm"
    >
      <div className="flex items-center gap-3 text-xs text-muted-foreground/60">
        <Badge variant="secondary" className="text-[10px] font-normal capitalize">{digest.type}</Badge>
        <span>{timeAgo(digest.generatedAt)}</span>
      </div>
      <h2 className="mt-2 text-xl font-semibold leading-snug text-foreground group-hover:text-primary transition-colors">
        {title}
      </h2>
      {summary && (
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground line-clamp-3">
          {summary}
        </p>
      )}
      <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary/70 group-hover:text-primary">
        Read digest <ArrowRightIcon className="size-3" />
      </span>
    </Link>
  );
}

function CompactDigest({ digest }: { digest: DigestItem }) {
  const sections = digest.sections as Record<string, unknown>;
  const summary = extractSummary(sections);
  const title = sections.title ? String(sections.title) : digest.type;

  return (
    <Link
      to={`/digests/${digest.id}`}
      className="group flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/30"
    >
      {/* Type indicator — thin colored bar */}
      <div className={`mt-1 h-8 w-1 shrink-0 rounded-full ${digest.type === "research" ? "bg-blue-500/60" : "bg-emerald-500/60"}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-foreground/90 group-hover:text-primary transition-colors truncate">
            {title}
          </span>
          <span className="shrink-0 text-[11px] text-muted-foreground/50">{timeAgo(digest.generatedAt)}</span>
        </div>
        {summary && (
          <p className="mt-0.5 text-xs text-muted-foreground/70 line-clamp-1">{summary}</p>
        )}
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Sidebar panels
// ---------------------------------------------------------------------------

function WatchesPanel() {
  const { data: watches, isLoading } = useWatches();
  const items = (watches ?? []).slice(0, 6);

  return (
    <section>
      <SidebarTitle label="Watches" to="/watches" count={watches?.length} />
      {isLoading ? <SidebarSkeleton rows={3} /> : items.length === 0 ? (
        <p className="text-xs text-muted-foreground/70">
          No watches. <Link to="/watches" className="text-primary hover:underline">Create one</Link>
        </p>
      ) : (
        <ul className="space-y-0.5">
          {items.map((w) => (
            <li key={w.id}>
              <Link to="/watches" className="flex items-center gap-2 rounded px-1 py-1 text-[13px] transition-colors hover:bg-muted/40">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${w.status === "active" ? "bg-emerald-500" : "bg-amber-400"}`} />
                <span className="min-w-0 flex-1 truncate text-foreground/75">{w.title}</span>
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
        <span className="flex items-center gap-1 text-xs text-muted-foreground/70">
          <CheckCircle2Icon className="size-3 opacity-40" /> All caught up
        </span>
      ) : (
        <ul className="space-y-0.5">
          {items.map((t) => (
            <li key={t.id} className="flex items-start gap-2 rounded px-1 py-1 text-[13px] hover:bg-muted/40">
              <button
                type="button"
                disabled={completeMut.isPending}
                onClick={() => completeMut.mutate(t.id)}
                className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border border-border/40 hover:border-primary hover:bg-primary/10"
              />
              <span className="min-w-0 flex-1 text-foreground/75 line-clamp-1">{t.title}</span>
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
        <div className="flex gap-5 text-[13px]">
          {[
            { Icon: BrainIcon, v: stats.beliefs.active, l: "memories" },
            { Icon: FileTextIcon, v: stats.documentsCount, l: "docs" },
            { Icon: FlaskConicalIcon, v: stats.findingsCount, l: "findings" },
          ].map((s) => (
            <div key={s.l} className="flex items-center gap-1 text-muted-foreground/70">
              <s.Icon className="size-3" />
              <span className="font-semibold text-foreground">{s.v}</span>
              <span className="text-[10px]">{s.l}</span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

function SidebarTitle({ label, to, count }: { label: string; to: string; count?: number }) {
  return (
    <div className="mb-2.5 flex items-center justify-between">
      <Link to={to} className="text-sm font-semibold text-foreground/90 hover:text-foreground">{label}</Link>
      {count != null && count > 0 && <span className="text-[10px] text-muted-foreground/50">{count}</span>}
    </div>
  );
}

function SidebarSkeleton({ rows }: { rows: number }) {
  return <div className="space-y-2">{Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}</div>;
}

// ---------------------------------------------------------------------------
// Tip
// ---------------------------------------------------------------------------

const TIPS = [
  "Say \"Keep me updated on GitHub trending AI repos\" to create a Watch with structured feeds.",
  "Rate digests with stars — low ratings improve future ones.",
  "Click the pencil on any memory assumption to correct it.",
  "Create Watches from templates: Price, News, Competitor, Availability.",
  "Digests suggest to-dos — check the bottom of each digest.",
  "Use pai as an MCP server with Claude Code or Cursor.",
];

function TipBanner() {
  const [dismissed, setDismissed] = useState<Set<number>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("pai-tips-d") ?? "[]") as number[]); } catch { return new Set(); }
  });

  const visible = TIPS.map((t, i) => ({ t, i })).filter(x => !dismissed.has(x.i));
  const tip = visible.length > 0 ? visible[Math.floor(Date.now() / 86400000) % visible.length] : null;
  if (!tip) return null;

  const dismiss = () => {
    const next = new Set(dismissed);
    next.add(tip.i);
    setDismissed(next);
    localStorage.setItem("pai-tips-d", JSON.stringify([...next]));
  };

  return (
    <div className="flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground/60">
      <span className="shrink-0">💡</span>
      <p className="flex-1">{tip.t}</p>
      <button type="button" onClick={dismiss} className="shrink-0 opacity-40 hover:opacity-100"><XIcon className="size-3" /></button>
    </div>
  );
}

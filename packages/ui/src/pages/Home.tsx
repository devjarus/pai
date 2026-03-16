import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useDigests } from "@/hooks/use-digests";
import { useWatches } from "@/hooks/use-watches";
import { useTasks, useCompleteTask } from "@/hooks/use-tasks";
import { useLibraryStats } from "@/hooks/use-library";
import { parseApiDate } from "@/lib/datetime";
import {
  ArrowRightIcon,
  EyeIcon,
  CheckCircle2Icon,
  BrainIcon,
  FileTextIcon,
  FlaskConicalIcon,
  SearchIcon,
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

function digestTypeIcon(type: string): string {
  switch (type.toLowerCase()) {
    case "news":
      return "\u{1F7E2}"; // green circle
    case "crypto":
    case "price":
      return "\u{1F535}"; // blue circle
    case "daily":
    case "general":
      return "\u{1F4CB}"; // clipboard
    case "competitor":
      return "\u{1F7E0}"; // orange circle
    default:
      return "\u{1F4E8}"; // incoming envelope
  }
}

function extractSummary(sections: Record<string, unknown> | undefined): string | null {
  if (!sections) return null;
  return (
    (sections.recommendation as string) ??
    (sections.summary as string) ??
    (sections.highlights as string) ??
    null
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Home() {
  const navigate = useNavigate();
  const [askQuery, setAskQuery] = useState("");

  useEffect(() => {
    document.title = "Home - pai";
  }, []);

  const handleAskSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = askQuery.trim();
    navigate(q ? `/ask?q=${encodeURIComponent(q)}` : "/ask");
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header bar */}
      <header className="flex items-center justify-between gap-3 border-b border-border/40 bg-background px-3 py-3 md:px-6 md:py-4">
        <span className="font-mono text-sm font-bold tracking-tighter text-primary">pai</span>
        <form
          onSubmit={handleAskSubmit}
          className="flex max-w-md flex-1 items-center gap-2"
        >
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={askQuery}
              onChange={(e) => setAskQuery(e.target.value)}
              placeholder="Ask something..."
              className="w-full rounded-lg border border-border/50 bg-background py-1.5 pl-8 pr-3 text-sm text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/25"
            />
          </div>
        </form>
      </header>

      {/* Scrollable body */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl p-4 md:p-6">
          {/* Main content: digests + sidebar */}
          <div className="flex flex-col gap-6 lg:flex-row">
            {/* Primary: Recent Digests */}
            <div className="min-w-0 flex-1">
              <RecentDigests />
            </div>

            {/* Sidebar */}
            <div className="flex w-full flex-col gap-5 lg:w-72 lg:shrink-0">
              <ActiveWatchesList />
              <OpenTodosList />
              <LibraryStats />
            </div>
          </div>

          {/* Tips at the bottom */}
          <div className="mt-6">
            <TipsCard />
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recent Digests (primary content)
// ---------------------------------------------------------------------------

function RecentDigests() {
  const { data, isLoading } = useDigests();

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Recent Digests</h2>
        <Link
          to="/digests"
          className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80"
        >
          View all <ArrowRightIcon className="size-3" />
        </Link>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border/40 p-4">
              <Skeleton className="mb-2 h-4 w-40" />
              <Skeleton className="mb-1 h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ))}
        </div>
      ) : (
        <DigestList digests={data?.digests ?? []} />
      )}
    </section>
  );
}

function DigestList({
  digests,
}: {
  digests: Array<{
    id: string;
    generatedAt: string;
    sections: Record<string, unknown>;
    status: string;
    type: string;
  }>;
}) {
  if (digests.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border/50 py-12 text-sm text-muted-foreground">
        <p>No digests yet.</p>
        <p className="mt-1 text-xs">Digests will appear here once your watches run.</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-border/40 rounded-lg border border-border/40">
      {digests.slice(0, 8).map((d) => {
        const summary = extractSummary(d.sections as Record<string, unknown>);
        return (
          <Link
            key={d.id}
            to={`/digests/${d.id}`}
            className="block px-4 py-3 transition-colors hover:bg-accent/40"
          >
            <div className="mb-1 flex items-center gap-2">
              <span className="text-sm leading-none">{digestTypeIcon(d.type)}</span>
              <Badge variant="outline" className="text-[10px] capitalize">
                {d.type}
              </Badge>
              <span className="text-[10px] text-muted-foreground">
                {timeAgo(d.generatedAt)}
              </span>
            </div>
            {summary ? (
              <p className="text-sm leading-relaxed text-foreground/80 line-clamp-2">
                {summary}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Digest available</p>
            )}
            <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary">
              Read more <ArrowRightIcon className="size-3" />
            </span>
          </Link>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Active Watches (sidebar)
// ---------------------------------------------------------------------------

function ActiveWatchesList() {
  const { data: watches, isLoading } = useWatches();

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Active Watches
        </h2>
        <Link
          to="/watches"
          className="text-[10px] text-primary hover:text-primary/80"
        >
          View all
        </Link>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2">
              <Skeleton className="h-3 w-3 rounded-full" />
              <Skeleton className="h-3 flex-1" />
            </div>
          ))}
        </div>
      ) : (watches ?? []).length === 0 ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <EyeIcon className="size-3.5 opacity-40" />
          <span>No watches yet.</span>
          <Link to="/watches" className="text-primary hover:text-primary/80">
            Create one
          </Link>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {(watches ?? []).slice(0, 5).map((w) => (
            <li key={w.id}>
              <Link
                to="/watches"
                className="flex items-center gap-2 rounded px-1 py-0.5 text-sm transition-colors hover:bg-accent/50"
              >
                <span
                  className={
                    w.status === "active"
                      ? "h-2 w-2 shrink-0 rounded-full bg-green-500"
                      : "h-2 w-2 shrink-0 rounded-full bg-amber-500"
                  }
                />
                <span className="min-w-0 flex-1 truncate text-foreground/80">
                  {w.title}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Open To-Dos (sidebar)
// ---------------------------------------------------------------------------

function OpenTodosList() {
  const { data: tasks, isLoading } = useTasks({ status: "open" });
  const completeMut = useCompleteTask();

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Open To-Dos
        </h2>
        <Link
          to="/tasks"
          className="text-[10px] text-primary hover:text-primary/80"
        >
          View all
        </Link>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2">
              <Skeleton className="h-3.5 w-3.5 rounded" />
              <Skeleton className="h-3 flex-1" />
            </div>
          ))}
        </div>
      ) : (tasks ?? []).length === 0 ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <CheckCircle2Icon className="size-3.5 opacity-40" />
          <span>All caught up!</span>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {(tasks ?? []).slice(0, 5).map((t) => (
            <li
              key={t.id}
              className="flex items-start gap-2 rounded px-1 py-0.5 text-sm transition-colors hover:bg-accent/50"
            >
              <button
                type="button"
                aria-label="Complete task"
                disabled={completeMut.isPending}
                onClick={() => completeMut.mutate(t.id)}
                className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border border-border/60 transition-colors hover:border-primary hover:bg-primary/10"
              />
              <span className="min-w-0 flex-1 text-foreground/80 line-clamp-1">
                {t.title}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Library Stats (sidebar)
// ---------------------------------------------------------------------------

function LibraryStats() {
  const { data: stats, isLoading } = useLibraryStats();

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Library
        </h2>
        <Link
          to="/library"
          className="text-[10px] text-primary hover:text-primary/80"
        >
          View all
        </Link>
      </div>

      {isLoading ? (
        <div className="flex gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-16" />
          ))}
        </div>
      ) : !stats ? null : (
        <div className="flex flex-wrap gap-4">
          {[
            { value: stats.beliefs.active, label: "memories", Icon: BrainIcon },
            { value: stats.documentsCount, label: "documents", Icon: FileTextIcon },
            { value: stats.findingsCount, label: "findings", Icon: FlaskConicalIcon },
          ].map((c) => (
            <Link
              key={c.label}
              to="/library"
              className="flex items-center gap-1.5 text-sm transition-colors hover:text-primary"
            >
              <c.Icon className="size-3.5 text-muted-foreground" />
              <span className="font-medium text-foreground">{c.value}</span>
              <span className="text-[10px] text-muted-foreground">{c.label}</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Tips (dismissible, at bottom)
// ---------------------------------------------------------------------------

const TIPS = [
  { text: "Try saying \"Keep me updated on GitHub trending AI repos\" \u2014 pai will automatically use structured feeds for better results.", tag: "Watches" },
  { text: "Rate your digests! Tap the stars on any digest \u2014 low ratings will improve future ones.", tag: "Digests" },
  { text: "Correct any memory from a digest \u2014 click the pencil icon on a memory assumption to fix it.", tag: "Library" },
  { text: "Create Watches from templates \u2014 Price, News, Competitor, Availability, or General monitoring.", tag: "Watches" },
  { text: "Your Library grows automatically \u2014 research findings, chat insights, and corrections all compound.", tag: "Library" },
  { text: "Search across everything in Library \u2014 memories, documents, and research findings in one search.", tag: "Library" },
  { text: "Digests suggest to-dos \u2014 look for the \"Suggested To-Dos\" section at the bottom of each digest.", tag: "Tasks" },
  { text: "Connect via Telegram \u2014 get digests pushed to your phone. Set up in Settings.", tag: "Telegram" },
  { text: "Use pai as an MCP server \u2014 connect it to Claude Code, Cursor, or any MCP-compatible tool.", tag: "MCP" },
  { text: "Watches get smarter each run \u2014 findings compound, and the agent focuses on what's new.", tag: "Watches" },
];

function TipsCard() {
  const [dismissed, setDismissed] = useState<Set<number>>(() => {
    try {
      const stored = localStorage.getItem("pai-dismissed-tips");
      return stored ? new Set(JSON.parse(stored) as number[]) : new Set();
    } catch { return new Set(); }
  });

  const visibleTips = TIPS.map((tip, i) => ({ ...tip, index: i })).filter(t => !dismissed.has(t.index));
  const tip = visibleTips.length > 0 ? visibleTips[Math.floor(Date.now() / 86400000) % visibleTips.length] : null;

  if (!tip) return null;

  const dismiss = () => {
    const next = new Set(dismissed);
    next.add(tip.index);
    setDismissed(next);
    localStorage.setItem("pai-dismissed-tips", JSON.stringify([...next]));
  };

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">Tip</span>
              <Badge variant="outline" className="text-[9px]">{tip.tag}</Badge>
            </div>
            <p className="text-sm text-foreground/80">{tip.text}</p>
          </div>
          <button
            type="button"
            onClick={dismiss}
            className="shrink-0 text-[10px] text-muted-foreground hover:text-foreground"
          >
            Dismiss
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

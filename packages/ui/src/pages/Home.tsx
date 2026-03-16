import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useDigests } from "@/hooks/use-digests";
import { useWatches } from "@/hooks/use-watches";
import { useTasks, useCompleteTask } from "@/hooks/use-tasks";
import { useLibraryStats } from "@/hooks/use-library";
import { formatWithTimezone, parseApiDate } from "@/lib/datetime";
import {
  ArrowRightIcon,
  EyeIcon,
  CheckCircle2Icon,
  BrainIcon,
  FileTextIcon,
  FlaskConicalIcon,
  MessageSquarePlusIcon,
} from "lucide-react";

function formatDate(dateStr: string): string {
  const d = parseApiDate(dateStr);
  return isNaN(d.getTime())
    ? dateStr
    : formatWithTimezone(d, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function Home() {
  useEffect(() => {
    document.title = "Home - pai";
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b border-border/40 bg-background px-3 py-3 md:px-6 md:py-4">
        <h1 className="font-mono text-sm font-semibold text-foreground">Home</h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-4 p-4 md:space-y-6 md:p-6">
          <LatestDigestCard />
          <div className="grid gap-4 md:grid-cols-2">
            <ActiveWatchesCard />
            <OpenTodosCard />
          </div>
          <LibraryStatsCard />
          <TipsCard />
          <QuickAskCard />
        </div>
      </div>
    </div>
  );
}

// ---- Latest Digest ----

function LatestDigestCard() {
  const { data, isLoading } = useDigests();

  if (isLoading) {
    return (
      <Card className="border-border/50 bg-card/50">
        <CardContent className="p-4 md:p-6">
          <Skeleton className="mb-3 h-5 w-32" />
          <Skeleton className="mb-2 h-4 w-full" />
          <Skeleton className="mb-2 h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </CardContent>
      </Card>
    );
  }

  const digests = data?.digests ?? [];
  const latest = digests[0];

  if (!latest) {
    return (
      <Card className="border-border/50 bg-card/50">
        <CardContent className="flex flex-col items-center justify-center p-6 text-sm text-muted-foreground">
          <p>No digests yet.</p>
          <p className="mt-1 text-xs">Digests will appear here once your watches run.</p>
        </CardContent>
      </Card>
    );
  }

  // Try to extract a summary from sections
  const sections = latest.sections as Record<string, unknown> | undefined;
  const summary =
    (sections?.recommendation as string) ??
    (sections?.summary as string) ??
    (sections?.highlights as string) ??
    null;

  return (
    <Card className="border-border/50 bg-card/50 transition-colors hover:border-border/80">
      <CardContent className="p-4 md:p-6">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">Latest Digest</h2>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px] capitalize">
              {latest.type}
            </Badge>
            <span className="text-[10px] text-muted-foreground">
              {formatDate(latest.generatedAt)}
            </span>
          </div>
        </div>
        {summary ? (
          <p className="mb-3 text-sm leading-relaxed text-foreground/80 line-clamp-3">
            {summary}
          </p>
        ) : (
          <p className="mb-3 text-sm text-muted-foreground">Digest available</p>
        )}
        <Link
          to={`/digests/${latest.id}`}
          className="inline-flex items-center gap-1 text-xs font-medium text-primary transition-colors hover:text-primary/80"
        >
          Read full
          <ArrowRightIcon className="size-3" />
        </Link>
      </CardContent>
    </Card>
  );
}

// ---- Active Watches ----

function ActiveWatchesCard() {
  const { data: watches, isLoading } = useWatches();

  if (isLoading) {
    return (
      <Card className="border-border/50 bg-card/50">
        <CardContent className="p-4">
          <Skeleton className="mb-3 h-5 w-28" />
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="mb-2 flex items-center gap-2">
              <Skeleton className="h-4 w-4 rounded-full" />
              <Skeleton className="h-4 flex-1" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  const items = watches ?? [];

  if (items.length === 0) {
    return (
      <Card className="border-border/50 bg-card/50">
        <CardContent className="flex flex-col items-center justify-center p-6 text-sm text-muted-foreground">
          <EyeIcon className="mb-2 size-8 opacity-20" />
          <p>No watches yet.</p>
          <Link to="/watches" className="mt-1 text-xs text-primary hover:text-primary/80">
            Create a watch
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50 bg-card/50">
      <CardContent className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Active Watches</h2>
          <Link to="/watches" className="text-[10px] text-primary hover:text-primary/80">
            View all
          </Link>
        </div>
        <div className="space-y-2">
          {items.slice(0, 5).map((w) => (
            <Link
              key={w.id}
              to="/watches"
              className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm transition-colors hover:bg-accent/50"
            >
              <span
                className={
                  w.status === "active"
                    ? "h-2 w-2 shrink-0 rounded-full bg-green-500"
                    : "h-2 w-2 shrink-0 rounded-full bg-amber-500"
                }
              />
              <span className="min-w-0 flex-1 truncate text-foreground/80">{w.title}</span>
              <Badge
                variant="outline"
                className="shrink-0 text-[9px] capitalize"
              >
                {w.status}
              </Badge>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ---- Open To-Dos ----

function OpenTodosCard() {
  const { data: tasks, isLoading } = useTasks({ status: "open" });
  const completeMut = useCompleteTask();

  if (isLoading) {
    return (
      <Card className="border-border/50 bg-card/50">
        <CardContent className="p-4">
          <Skeleton className="mb-3 h-5 w-24" />
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="mb-2 flex items-center gap-2">
              <Skeleton className="h-4 w-4 rounded" />
              <Skeleton className="h-4 flex-1" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  const items = (tasks ?? []).slice(0, 5);

  if (items.length === 0) {
    return (
      <Card className="border-border/50 bg-card/50">
        <CardContent className="flex flex-col items-center justify-center p-6 text-sm text-muted-foreground">
          <CheckCircle2Icon className="mb-2 size-8 opacity-20" />
          <p>All caught up!</p>
          <p className="mt-1 text-xs">No open to-dos right now.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50 bg-card/50">
      <CardContent className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Open To-Dos</h2>
          <Link to="/tasks" className="text-[10px] text-primary hover:text-primary/80">
            View all
          </Link>
        </div>
        <div className="space-y-2">
          {items.map((t) => (
            <div
              key={t.id}
              className="flex items-start gap-2 rounded-md px-1.5 py-1 text-sm transition-colors hover:bg-accent/50"
            >
              <button
                type="button"
                aria-label="Complete task"
                disabled={completeMut.isPending}
                onClick={() => completeMut.mutate(t.id)}
                className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border border-border/60 transition-colors hover:border-primary hover:bg-primary/10"
              >
                {/* empty checkbox */}
              </button>
              <span className="min-w-0 flex-1 text-foreground/80 line-clamp-1">{t.title}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ---- Library Stats ----

function LibraryStatsCard() {
  const { data: stats, isLoading } = useLibraryStats();

  if (isLoading) {
    return (
      <Card className="border-border/50 bg-card/50">
        <CardContent className="flex gap-6 p-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-1">
              <Skeleton className="h-6 w-10" />
              <Skeleton className="h-3 w-16" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  if (!stats) return null;

  const counters = [
    { value: stats.beliefs.active, label: "memories", icon: BrainIcon },
    { value: stats.documentsCount, label: "documents", icon: FileTextIcon },
    { value: stats.findingsCount, label: "findings", icon: FlaskConicalIcon },
  ];

  return (
    <Card className="border-border/50 bg-card/50">
      <CardContent className="p-4">
        <h2 className="mb-3 text-sm font-semibold text-foreground">Library</h2>
        <div className="flex flex-wrap gap-6">
          {counters.map((c) => (
            <Link
              key={c.label}
              to="/library"
              className="flex items-center gap-2 transition-colors hover:text-primary"
            >
              <c.icon className="size-4 text-muted-foreground" />
              <div>
                <div className="text-lg font-semibold leading-none text-foreground">{c.value}</div>
                <div className="text-[10px] text-muted-foreground">{c.label}</div>
              </div>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ---- Quick Ask ----

function QuickAskCard() {
  const navigate = useNavigate();
  const [question, setQuestion] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    navigate("/ask");
  };

  return (
    <Card className="border-border/50 bg-card/50">
      <CardContent className="p-4">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="What's on your mind?"
            className="flex-1 rounded-lg border border-border/50 bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/25"
          />
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <MessageSquarePlusIcon className="size-3.5" />
            Ask
          </button>
        </form>
      </CardContent>
    </Card>
  );
}

// ---- Tips / What's New ----

const TIPS = [
  { text: "Try saying \"Keep me updated on GitHub trending AI repos\" — pai will automatically use structured feeds for better results.", tag: "Watches" },
  { text: "Rate your digests! Tap the stars on any digest — low ratings will improve future ones.", tag: "Digests" },
  { text: "Correct any memory from a digest — click the pencil icon on a memory assumption to fix it.", tag: "Library" },
  { text: "Create Watches from templates — Price, News, Competitor, Availability, or General monitoring.", tag: "Watches" },
  { text: "Your Library grows automatically — research findings, chat insights, and corrections all compound.", tag: "Library" },
  { text: "Search across everything in Library — memories, documents, and research findings in one search.", tag: "Library" },
  { text: "Digests suggest to-dos — look for the \"Suggested To-Dos\" section at the bottom of each digest.", tag: "Tasks" },
  { text: "Connect via Telegram — get digests pushed to your phone. Set up in Settings.", tag: "Telegram" },
  { text: "Use pai as an MCP server — connect it to Claude Code, Cursor, or any MCP-compatible tool.", tag: "MCP" },
  { text: "Watches get smarter each run — findings compound, and the agent focuses on what's new.", tag: "Watches" },
];

function TipsCard() {
  const [dismissed, setDismissed] = useState<Set<number>>(() => {
    try {
      const stored = localStorage.getItem("pai-dismissed-tips");
      return stored ? new Set(JSON.parse(stored) as number[]) : new Set();
    } catch { return new Set(); }
  });

  const visibleTips = TIPS.map((tip, i) => ({ ...tip, index: i })).filter(t => !dismissed.has(t.index));
  // Show one random tip from the non-dismissed set
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

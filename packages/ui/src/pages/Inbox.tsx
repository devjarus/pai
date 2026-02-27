import { useState, useEffect, useCallback, useRef, useMemo, createContext, useContext } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { useInboxAll, useInboxBriefing, useRefreshInbox, useClearInbox, useCreateThread } from "@/hooks";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import MarkdownContent from "@/components/MarkdownContent";
import {
  RefreshCwIcon,
  CheckCircle2Icon,
  BrainIcon,
  LightbulbIcon,
  ArrowRightIcon,
  ArrowLeftIcon,
  SparklesIcon,
  Trash2Icon,
  SearchIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  LoaderIcon,
  MessageSquarePlusIcon,
} from "lucide-react";

const STORAGE_KEY = "pai-inbox-read";

function loadReadIds(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function persistReadIds(ids: Set<string>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
}

const ReadContext = createContext<{
  readIds: Set<string>;
  markRead: (id: string) => void;
}>({ readIds: new Set(), markRead: () => {} });

const priorityStyles: Record<string, string> = {
  high: "bg-red-500/15 text-red-400 border-red-500/20",
  medium: "bg-yellow-500/15 text-yellow-400 border-yellow-500/20",
  low: "bg-muted text-muted-foreground border-border/40",
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

interface InboxItem {
  id: string;
  generatedAt: string;
  sections: Record<string, unknown>;
  status: string;
  type: string;
}

export default function Inbox() {
  const { id } = useParams<{ id: string }>();
  const [readIds, setReadIds] = useState<Set<string>>(loadReadIds);

  const markRead = useCallback((itemId: string) => {
    setReadIds((prev) => {
      if (prev.has(itemId)) return prev;
      const next = new Set(prev);
      next.add(itemId);
      persistReadIds(next);
      return next;
    });
  }, []);

  if (id) {
    return (
      <ReadContext.Provider value={{ readIds, markRead }}>
        <InboxDetail id={id} />
      </ReadContext.Provider>
    );
  }
  return (
    <ReadContext.Provider value={{ readIds, markRead }}>
      <InboxFeed />
    </ReadContext.Provider>
  );
}

// ---- Detail View ----

function InboxDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const { markRead } = useContext(ReadContext);
  const createThreadMut = useCreateThread();

  const { data: briefingData, isLoading: loading } = useInboxBriefing(id);

  const item: InboxItem | null = useMemo(() => {
    if (!briefingData) return null;
    const b = briefingData.briefing;
    return {
      id: b.id,
      generatedAt: b.generatedAt,
      sections: b.sections as unknown as Record<string, unknown>,
      status: b.status,
      type: (b as unknown as { type?: string }).type ?? "daily",
    };
  }, [briefingData]);

  useEffect(() => {
    markRead(id);
  }, [id, markRead]);

  useEffect(() => {
    if (briefingData === undefined && !loading) {
      // query finished but no data (error case handled by react-query)
    }
  }, [briefingData, loading]);

  const handleStartChat = async () => {
    if (!item) return;
    setCreating(true);
    try {
      const sections = item.sections as { goal?: string; report?: string; greeting?: string };
      const title = item.type === "research"
        ? `Research: ${sections.goal ?? "Report"}`
        : sections.greeting?.slice(0, 60) ?? "Briefing Discussion";
      const thread = await createThreadMut.mutateAsync({ title });
      const context = item.type === "research"
        ? `I'd like to discuss this research report:\n\n**Goal:** ${sections.goal}\n\n${sections.report ?? ""}`
        : `I'd like to discuss today's briefing.`;
      sessionStorage.setItem("pai-chat-auto-send", JSON.stringify({ threadId: thread.id, message: context }));
      navigate(`/chat?thread=${thread.id}`);
    } catch {
      toast.error("Failed to create chat thread");
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-4 p-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-96 w-full rounded-lg" />
        </div>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
        <p className="text-sm text-muted-foreground">Briefing not found</p>
        <Button variant="ghost" onClick={() => navigate("/")} className="gap-2">
          <ArrowLeftIcon className="h-4 w-4" /> Back to Inbox
        </Button>
      </div>
    );
  }

  const sections = item.sections as { goal?: string; report?: string; greeting?: string };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl p-6">
        <div className="mb-6 flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={() => navigate("/")} className="gap-2 text-muted-foreground hover:text-foreground">
            <ArrowLeftIcon className="h-4 w-4" /> Inbox
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleStartChat}
              disabled={creating}
              className="gap-2"
            >
              <MessageSquarePlusIcon className="h-4 w-4" />
              {creating ? "Creating..." : "Start Chat"}
            </Button>
          </div>
        </div>

        <div className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            {item.type === "research" ? (
              <Badge variant="outline" className="text-[10px] border-blue-500/20 bg-blue-500/10 text-blue-400">Research Report</Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] border-primary/20 bg-primary/10 text-primary">Daily Briefing</Badge>
            )}
            <span className="text-[10px] text-muted-foreground">{timeAgo(item.generatedAt)}</span>
          </div>
          <h1 className="text-xl font-semibold text-foreground">
            {item.type === "research" ? (sections.goal ?? "Research Report") : (sections.greeting ?? "Daily Briefing")}
          </h1>
        </div>

        <Separator className="mb-6 opacity-30" />

        {item.type === "research" && sections.report ? (
          <div className="rounded-lg border border-border/20 bg-card/40 p-6">
            <MarkdownContent content={sections.report} />
          </div>
        ) : item.type === "daily" ? (
          <DailyBriefingDetail sections={item.sections} navigate={navigate} />
        ) : (
          <div className="rounded-lg border border-border/20 bg-card/40 p-6">
            <MarkdownContent content={JSON.stringify(item.sections, null, 2)} />
          </div>
        )}

        <div className="h-12" />
      </div>
    </div>
  );
}

function DailyBriefingDetail({ sections: raw, navigate }: { sections: Record<string, unknown>; navigate: ReturnType<typeof useNavigate> }) {
  const sections = raw as {
    taskFocus?: { summary: string; items: Array<{ id: string; title: string; priority: string; insight: string }> };
    memoryInsights?: { summary: string; highlights: Array<{ statement: string; type: string; detail: string }> };
    suggestions?: Array<{ title: string; reason: string; action?: string }>;
  };

  return (
    <div className="space-y-6">
      {(sections.taskFocus?.items?.length ?? 0) > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <CheckCircle2Icon className="h-4 w-4 text-primary" />
            <span className="font-mono text-sm font-semibold text-foreground">Task Focus</span>
          </div>
          <p className="text-sm text-muted-foreground">{sections.taskFocus!.summary}</p>
          {sections.taskFocus!.items.map((t, i) => (
            <div
              key={t.id || i}
              className="cursor-pointer rounded-md border border-border/20 bg-card/40 p-4 transition-colors hover:border-border/40"
              onClick={() => navigate("/tasks")}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">{t.title}</span>
                <Badge variant="outline" className={`text-[9px] ${priorityStyles[t.priority] ?? priorityStyles.low}`}>{t.priority}</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{t.insight}</p>
            </div>
          ))}
        </div>
      )}

      {(sections.memoryInsights?.highlights?.length ?? 0) > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <BrainIcon className="h-4 w-4 text-violet-400" />
            <span className="font-mono text-sm font-semibold text-foreground">Memory Insights</span>
          </div>
          <p className="text-sm text-muted-foreground">{sections.memoryInsights!.summary}</p>
          {sections.memoryInsights!.highlights.map((h, i) => (
            <div
              key={i}
              className="cursor-pointer rounded-md border border-border/20 bg-card/40 p-4 transition-colors hover:border-violet-500/30"
              onClick={() => navigate("/memory")}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">{h.statement}</span>
                <Badge variant="outline" className="text-[9px] border-violet-500/20 bg-violet-500/10 text-violet-400">{h.type}</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{h.detail}</p>
            </div>
          ))}
        </div>
      )}

      {(sections.suggestions?.length ?? 0) > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <LightbulbIcon className="h-4 w-4 text-amber-400" />
            <span className="font-mono text-sm font-semibold text-foreground">Suggestions</span>
          </div>
          {sections.suggestions!.map((s, i) => (
            <div key={i} className="flex items-start justify-between gap-2 rounded-md border border-border/20 bg-card/40 p-4">
              <div className="min-w-0 flex-1">
                <span className="text-sm font-medium text-foreground">{s.title}</span>
                <p className="mt-1 text-xs text-muted-foreground">{s.reason}</p>
              </div>
              {s.action && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-xs text-amber-400 hover:bg-amber-500/10 hover:text-amber-300"
                  onClick={() => {
                    if (s.action === "recall") navigate("/memory");
                    else if (s.action === "task") navigate("/tasks");
                    else if (s.action === "learn") navigate("/knowledge");
                  }}
                >
                  {s.action === "recall" ? "Recall" : s.action === "task" ? "Tasks" : s.action === "learn" ? "Learn" : s.action}
                  <ArrowRightIcon className="ml-1 h-3 w-3" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Feed View ----

function InboxFeed() {
  const [generating, setGenerating] = useState(false);
  const navigate = useNavigate();
  const prevGeneratingRef = useRef(false);
  const { readIds, markRead } = useContext(ReadContext);

  const { data: inboxData, isLoading: loading } = useInboxAll({
    refetchInterval: generating ? 3000 : false,
  });
  const items: InboxItem[] = inboxData?.briefings ?? [];

  // Track generating state transitions via query data
  useEffect(() => {
    if (inboxData?.generating && !generating) {
      setGenerating(true);
    }
    if (prevGeneratingRef.current && !inboxData?.generating) {
      setGenerating(false);
      toast.success("Briefing updated!");
    }
    prevGeneratingRef.current = !!inboxData?.generating;
  }, [inboxData?.generating]); // eslint-disable-line react-hooks/exhaustive-deps

  // Store last seen briefing ID
  useEffect(() => {
    if (items.length > 0) {
      localStorage.setItem("pai-last-seen-briefing-id", items[0].id);
    }
  }, [items]);

  const unreadCount = useMemo(
    () => items.filter((i) => !readIds.has(i.id)).length,
    [items, readIds],
  );

  const handleCardClick = useCallback(
    (itemId: string) => {
      markRead(itemId);
      navigate(`/inbox/${itemId}`);
    },
    [markRead, navigate],
  );

  const refreshInboxMut = useRefreshInbox();
  const clearInboxMut = useClearInbox();

  const handleRefresh = async () => {
    setGenerating(true);
    try {
      await refreshInboxMut.mutateAsync();
      toast.success("Generating new briefing...");
    } catch {
      setGenerating(false);
      toast.error("Failed to start briefing refresh");
    }
  };

  const handleClear = async () => {
    try {
      const result = await clearInboxMut.mutateAsync();
      toast.success(`Cleared ${result.cleared} item${result.cleared !== 1 ? "s" : ""}`);
    } catch {
      toast.error("Failed to clear inbox");
    }
  };

  if (loading) return <InboxSkeleton />;

  if (items.length === 0 && !generating) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-6 p-6">
        <div className="inbox-fade-in flex flex-col items-center gap-3 text-center">
          <SparklesIcon className="h-10 w-10 text-primary/60" />
          <h2 className="font-mono text-lg font-semibold text-foreground">Your Inbox</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            Your personal AI briefings, research reports, and notifications will appear here.
          </p>
          <Button
            onClick={handleRefresh}
            disabled={generating}
            className="mt-2 gap-2"
          >
            <RefreshCwIcon className="h-4 w-4" />
            Generate Briefing
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl space-y-4 p-6">
        <div className="inbox-fade-in flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="font-mono text-lg font-semibold text-foreground">Inbox</h1>
            <Badge variant="outline" className="text-[10px]">
              {items.length}
            </Badge>
            {unreadCount > 0 && (
              <Badge className="text-[10px] bg-blue-500 text-white hover:bg-blue-600">
                {unreadCount} unread
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleRefresh}
              disabled={generating}
              className="text-muted-foreground hover:text-foreground"
            >
              <RefreshCwIcon className={`h-4 w-4 ${generating ? "animate-spin" : ""}`} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleClear}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2Icon className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {generating && (
          <div className="inbox-fade-in flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
            <LoaderIcon className="h-4 w-4 animate-spin text-primary" />
            <span className="text-sm text-primary">Generating new briefing...</span>
          </div>
        )}

        <Separator className="opacity-30" />

        {items.map((item, idx) => (
          <div
            key={item.id}
            className={`inbox-fade-in ${readIds.has(item.id) ? "opacity-80" : ""}`}
            style={{ animationDelay: `${idx * 80}ms` }}
          >
            {item.type === "daily" ? (
              <DailyBriefingCard item={item} onCardClick={handleCardClick} isRead={readIds.has(item.id)} />
            ) : item.type === "research" ? (
              <ResearchReportCard item={item} onCardClick={handleCardClick} isRead={readIds.has(item.id)} />
            ) : (
              <GenericBriefingCard item={item} />
            )}
          </div>
        ))}

        <div className="h-8" />
      </div>
    </div>
  );
}

function DailyBriefingCard({ item, onCardClick, isRead }: { item: InboxItem; onCardClick: (id: string) => void; isRead: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const navigate = useNavigate();
  const sections = item.sections as {
    greeting?: string;
    taskFocus?: { summary: string; items: Array<{ id: string; title: string; priority: string; insight: string }> };
    memoryInsights?: { summary: string; highlights: Array<{ statement: string; type: string; detail: string }> };
    suggestions?: Array<{ title: string; reason: string; action?: string }>;
  };

  const counts: string[] = [];
  if ((sections.taskFocus?.items?.length ?? 0) > 0) {
    const n = sections.taskFocus!.items.length;
    counts.push(`${n} task${n !== 1 ? "s" : ""}`);
  }
  if ((sections.memoryInsights?.highlights?.length ?? 0) > 0) {
    const n = sections.memoryInsights!.highlights.length;
    counts.push(`${n} insight${n !== 1 ? "s" : ""}`);
  }
  if ((sections.suggestions?.length ?? 0) > 0) {
    const n = sections.suggestions!.length;
    counts.push(`${n} suggestion${n !== 1 ? "s" : ""}`);
  }

  return (
    <Card className="relative border-border/30 bg-card/40 transition-all duration-200">
      {!isRead && (
        <span className="absolute right-3 top-3 h-2.5 w-2.5 rounded-full bg-blue-500" />
      )}
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div
            className="min-w-0 flex-1 cursor-pointer"
            onClick={() => onCardClick(item.id)}
          >
            <div className="flex items-center gap-2">
              <SparklesIcon className="h-4 w-4 shrink-0 text-primary" />
              <Badge variant="outline" className="text-[10px] border-primary/20 bg-primary/10 text-primary">
                Daily Briefing
              </Badge>
              <span className="text-[10px] text-muted-foreground">{timeAgo(item.generatedAt)}</span>
            </div>
            <p className="mt-2 text-sm font-medium text-foreground leading-relaxed">
              {sections.greeting ?? "Daily briefing"}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setExpanded(!expanded)}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            {expanded ? <ChevronUpIcon className="h-4 w-4" /> : <ChevronDownIcon className="h-4 w-4" />}
          </Button>
        </div>

        {!expanded && counts.length > 0 && (
          <div className="mt-2 text-[10px] text-muted-foreground">
            {counts.join(" \u00B7 ")}
          </div>
        )}

        {expanded && (
          <div className="mt-4 space-y-4">
            {(sections.taskFocus?.items?.length ?? 0) > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <CheckCircle2Icon className="h-3.5 w-3.5 text-primary" />
                  <span className="font-mono text-xs font-semibold text-foreground">Task Focus</span>
                </div>
                <p className="text-xs text-muted-foreground">{sections.taskFocus!.summary}</p>
                {sections.taskFocus!.items.map((t, i) => (
                  <div
                    key={t.id || i}
                    className="cursor-pointer rounded-md border border-border/20 bg-background/40 p-3 transition-colors hover:border-border/40"
                    onClick={() => navigate("/tasks")}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-foreground">{t.title}</span>
                      <Badge
                        variant="outline"
                        className={`text-[9px] ${priorityStyles[t.priority] ?? priorityStyles.low}`}
                      >
                        {t.priority}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{t.insight}</p>
                  </div>
                ))}
              </div>
            )}

            {(sections.memoryInsights?.highlights?.length ?? 0) > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <BrainIcon className="h-3.5 w-3.5 text-violet-400" />
                  <span className="font-mono text-xs font-semibold text-foreground">Memory Insights</span>
                </div>
                <p className="text-xs text-muted-foreground">{sections.memoryInsights!.summary}</p>
                {sections.memoryInsights!.highlights.map((h, i) => (
                  <div
                    key={i}
                    className="cursor-pointer rounded-md border border-border/20 bg-background/40 p-3 transition-colors hover:border-violet-500/30"
                    onClick={() => navigate("/memory")}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-foreground">{h.statement}</span>
                      <Badge variant="outline" className="text-[9px] border-violet-500/20 bg-violet-500/10 text-violet-400">
                        {h.type}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{h.detail}</p>
                  </div>
                ))}
              </div>
            )}

            {(sections.suggestions?.length ?? 0) > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <LightbulbIcon className="h-3.5 w-3.5 text-amber-400" />
                  <span className="font-mono text-xs font-semibold text-foreground">Suggestions</span>
                </div>
                {sections.suggestions!.map((s, i) => (
                  <div key={i} className="flex items-start justify-between gap-2 rounded-md border border-border/20 bg-background/40 p-3">
                    <div className="min-w-0 flex-1">
                      <span className="text-xs font-medium text-foreground">{s.title}</span>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{s.reason}</p>
                    </div>
                    {s.action && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="shrink-0 text-[10px] text-amber-400 hover:bg-amber-500/10 hover:text-amber-300"
                        onClick={() => {
                          if (s.action === "recall") navigate("/memory");
                          else if (s.action === "task") navigate("/tasks");
                          else if (s.action === "learn") navigate("/knowledge");
                        }}
                      >
                        {s.action === "recall" ? "Recall" : s.action === "task" ? "Tasks" : s.action === "learn" ? "Learn" : s.action}
                        <ArrowRightIcon className="ml-1 h-2.5 w-2.5" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ResearchReportCard({ item, onCardClick, isRead }: { item: InboxItem; onCardClick: (id: string) => void; isRead: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const navigate = useNavigate();
  const sections = item.sections as { report?: string; goal?: string };

  return (
    <Card className="relative border-border/30 bg-card/40 transition-all duration-200">
      {!isRead && (
        <span className="absolute right-3 top-3 h-2.5 w-2.5 rounded-full bg-blue-500" />
      )}
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div
            className="min-w-0 flex-1 cursor-pointer"
            onClick={() => onCardClick(item.id)}
          >
            <div className="flex items-center gap-2">
              <SearchIcon className="h-4 w-4 shrink-0 text-blue-400" />
              <Badge variant="outline" className="text-[10px] border-blue-500/20 bg-blue-500/10 text-blue-400">
                Research Report
              </Badge>
              <span className="text-[10px] text-muted-foreground">{timeAgo(item.generatedAt)}</span>
            </div>
            <p className="mt-2 text-sm font-medium text-foreground">
              {sections.goal ?? "Research report"}
            </p>
            {!expanded && sections.report && (
              <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                {sections.report.slice(0, 200)}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setExpanded(!expanded)}
              className="text-muted-foreground hover:text-foreground"
            >
              {expanded ? <ChevronUpIcon className="h-4 w-4" /> : <ChevronDownIcon className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {expanded && sections.report && (
          <div className="mt-4 rounded-md border border-border/20 bg-background/40 p-4">
            <MarkdownContent content={sections.report} />
            <div className="mt-4 flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate(`/inbox/${item.id}`)}
                className="gap-2 text-xs"
              >
                Open Full View
                <ArrowRightIcon className="h-3 w-3" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function GenericBriefingCard({ item }: { item: InboxItem }) {
  return (
    <Card className="border-border/30 bg-card/40">
      <CardContent className="p-4">
        <div className="flex items-center gap-2">
          <SparklesIcon className="h-4 w-4 text-muted-foreground" />
          <Badge variant="outline" className="text-[10px]">{item.type}</Badge>
          <span className="text-[10px] text-muted-foreground">{timeAgo(item.generatedAt)}</span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {JSON.stringify(item.sections).slice(0, 200)}
        </p>
      </CardContent>
    </Card>
  );
}

function InboxSkeleton() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl space-y-4 p-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-6 w-24" />
          <div className="flex gap-1">
            <Skeleton className="h-8 w-8 rounded-lg" />
            <Skeleton className="h-8 w-8 rounded-lg" />
          </div>
        </div>
        <Separator className="opacity-30" />
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}

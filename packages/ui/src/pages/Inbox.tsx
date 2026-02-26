import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { getInbox, refreshInbox, clearInbox } from "../api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  RefreshCwIcon,
  CheckCircle2Icon,
  BrainIcon,
  LightbulbIcon,
  ArrowRightIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react";
import type { Briefing } from "../types";

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

export default function Inbox() {
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const navigate = useNavigate();

  const fetchBriefing = useCallback(async () => {
    try {
      const data = await getInbox();
      setBriefing(data.briefing);
    } catch (err) {
      console.error("Failed to load briefing:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBriefing();
  }, [fetchBriefing]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshInbox();
      toast.success("Generating new briefing...");
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        try {
          const data = await getInbox();
          if (data.briefing && data.briefing.id !== briefing?.id) {
            setBriefing(data.briefing);
            setRefreshing(false);
            clearInterval(poll);
            toast.success("Briefing updated!");
          }
        } catch { /* ignore polling errors */ }
        if (attempts > 40) {
          setRefreshing(false);
          clearInterval(poll);
          toast.error("Briefing is taking longer than expected. Check back soon.");
        }
      }, 3000);
    } catch {
      setRefreshing(false);
      toast.error("Failed to start briefing refresh");
    }
  };

  const handleClear = async () => {
    try {
      const result = await clearInbox();
      setBriefing(null);
      toast.success(`Cleared ${result.cleared} briefing${result.cleared !== 1 ? "s" : ""}`);
    } catch {
      toast.error("Failed to clear inbox");
    }
  };

  if (loading) return <InboxSkeleton />;

  if (!briefing) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-6 p-6">
        <div className="inbox-fade-in flex flex-col items-center gap-3 text-center">
          <SparklesIcon className="h-10 w-10 text-primary/60" />
          <h2 className="font-mono text-lg font-semibold text-foreground">Your Inbox</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            Your personal AI briefing will appear here. Tap below to generate your first one.
          </p>
          <Button
            onClick={handleRefresh}
            disabled={refreshing}
            className="mt-2 gap-2"
          >
            <RefreshCwIcon className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Generating..." : "Generate Briefing"}
          </Button>
        </div>
      </div>
    );
  }

  const { sections } = briefing;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl space-y-6 p-6">
        {/* Greeting */}
        <div className="inbox-fade-in" style={{ animationDelay: "0ms" }}>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-lg font-medium text-foreground leading-relaxed">
                {sections.greeting}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Generated {timeAgo(briefing.generatedAt)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={handleRefresh}
                disabled={refreshing}
                className="text-muted-foreground hover:text-foreground"
              >
                <RefreshCwIcon className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
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
          <Separator className="mt-4 opacity-30" />
        </div>

        {/* Task Focus */}
        {sections.taskFocus.items.length > 0 && (
          <div className="inbox-fade-in space-y-3" style={{ animationDelay: "100ms" }}>
            <div className="flex items-center gap-2">
              <CheckCircle2Icon className="h-4 w-4 text-primary" />
              <h3 className="font-mono text-sm font-semibold text-foreground">Task Focus</h3>
            </div>
            <p className="text-sm text-muted-foreground">{sections.taskFocus.summary}</p>
            <div className="space-y-2">
              {sections.taskFocus.items.map((item, i) => (
                <Card
                  key={item.id || i}
                  className="inbox-card cursor-pointer border-border/30 bg-card/40 transition-all duration-200 hover:-translate-y-0.5 hover:border-border/60 hover:shadow-lg hover:shadow-primary/5"
                  onClick={() => navigate("/tasks")}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground">{item.title}</span>
                          <Badge
                            variant="outline"
                            className={`text-[10px] ${priorityStyles[item.priority] ?? priorityStyles.low} ${item.priority === "high" ? "animate-pulse" : ""}`}
                          >
                            {item.priority}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{item.insight}</p>
                      </div>
                      <ArrowRightIcon className="h-4 w-4 shrink-0 text-muted-foreground/50" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Memory Insights */}
        {sections.memoryInsights.highlights.length > 0 && (
          <div className="inbox-fade-in space-y-3" style={{ animationDelay: "200ms" }}>
            <div className="flex items-center gap-2">
              <BrainIcon className="h-4 w-4 text-violet-400" />
              <h3 className="font-mono text-sm font-semibold text-foreground">Memory Insights</h3>
            </div>
            <p className="text-sm text-muted-foreground">{sections.memoryInsights.summary}</p>
            <div className="space-y-2">
              {sections.memoryInsights.highlights.map((h, i) => (
                <Card
                  key={i}
                  className="inbox-card cursor-pointer border-border/30 bg-card/40 transition-all duration-200 hover:-translate-y-0.5 hover:border-violet-500/30 hover:shadow-lg hover:shadow-violet-500/5"
                  onClick={() => navigate("/memory")}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground">{h.statement}</span>
                          <Badge variant="outline" className="text-[10px] border-violet-500/20 bg-violet-500/10 text-violet-400">
                            {h.type}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{h.detail}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Suggestions */}
        {sections.suggestions.length > 0 && (
          <div className="inbox-fade-in space-y-3" style={{ animationDelay: "300ms" }}>
            <div className="flex items-center gap-2">
              <LightbulbIcon className="h-4 w-4 text-amber-400" />
              <h3 className="font-mono text-sm font-semibold text-foreground">Suggestions</h3>
            </div>
            <div className="space-y-2">
              {sections.suggestions.map((s, i) => (
                <Card
                  key={i}
                  className="inbox-card border-border/30 bg-card/40 transition-all duration-200 hover:-translate-y-0.5 hover:border-amber-500/30 hover:shadow-lg hover:shadow-amber-500/5"
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
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
                          {s.action === "recall" ? "Recall" : s.action === "task" ? "View Tasks" : s.action === "learn" ? "Learn" : s.action}
                          <ArrowRightIcon className="ml-1 h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        <div className="h-8" />
      </div>
    </div>
  );
}

function InboxSkeleton() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl space-y-6 p-6">
        <div className="space-y-2">
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-4 w-1/4" />
        </div>
        <Separator className="opacity-30" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="space-y-3">
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-20 w-full rounded-lg" />
            <Skeleton className="h-20 w-full rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  RefreshCwIcon,
  LoaderIcon,
  CheckCircle2Icon,
  AlertCircleIcon,
  ClockIcon,
  SearchIcon,
  GlobeIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import type { BackgroundJobInfo } from "../api";
import { useJobs, useJobDetail, useClearJobs } from "@/hooks";
import ReactMarkdown from "react-markdown";

const statusStyles: Record<string, string> = {
  running: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  pending: "bg-yellow-500/15 text-yellow-400 border-yellow-500/20",
  done: "bg-green-500/15 text-green-400 border-green-500/20",
  error: "bg-red-500/15 text-red-400 border-red-500/20",
  failed: "bg-red-500/15 text-red-400 border-red-500/20",
};

const statusIcons: Record<string, typeof LoaderIcon> = {
  running: LoaderIcon,
  pending: ClockIcon,
  done: CheckCircle2Icon,
  error: AlertCircleIcon,
  failed: AlertCircleIcon,
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

export default function Jobs() {
  const { data: jobsData, isLoading, isRefetching, refetch } = useJobs();
  const jobs = jobsData?.jobs ?? [];

  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const { data: jobDetailData, isLoading: detailLoading } = useJobDetail(selectedJobId);
  const selectedJob = jobDetailData?.job ?? null;

  const clearJobsMutation = useClearJobs();

  useEffect(() => {
    document.title = "Jobs - pai";
  }, []);

  const handleSelectJob = (job: BackgroundJobInfo) => {
    if (job.type !== "research") return;
    setSelectedJobId(job.id);
  };

  if (isLoading) return <JobsSkeleton />;

  const runningCount = jobs.filter((j) => j.status === "running" || j.status === "pending").length;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Main list */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl space-y-6 p-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h1 className="font-mono text-lg font-semibold text-foreground">Background Jobs</h1>
              {runningCount > 0 && (
                <Badge variant="outline" className="text-[10px] border-blue-500/20 bg-blue-500/10 text-blue-400 animate-pulse">
                  {runningCount} running
                </Badge>
              )}
              {jobs.length > 0 && (
                <Badge variant="outline" className="text-[10px]">
                  {jobs.length} total
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => refetch()}
                disabled={isRefetching}
                className="text-muted-foreground hover:text-foreground"
              >
                <RefreshCwIcon className={`h-4 w-4 ${isRefetching ? "animate-spin" : ""}`} />
              </Button>
              {jobs.some((j) => j.status === "done" || j.status === "error" || j.status === "failed") && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    clearJobsMutation.mutate(undefined, {
                      onSuccess: (result) => {
                        toast.success(`Cleared ${result.cleared} job${result.cleared !== 1 ? "s" : ""}`);
                      },
                      onError: () => {
                        toast.error("Failed to clear jobs");
                      },
                    });
                  }}
                  className="text-xs text-muted-foreground hover:text-destructive"
                >
                  <XIcon className="mr-1 h-3 w-3" />
                  Clear done
                </Button>
              )}
            </div>
          </div>

          <Separator className="opacity-30" />

          {/* Empty state */}
          {jobs.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <SearchIcon className="h-10 w-10 text-muted-foreground/30" />
              <h2 className="font-mono text-sm font-semibold text-muted-foreground">No background jobs</h2>
              <p className="max-w-sm text-xs text-muted-foreground/60">
                Background jobs appear here when you ask the assistant to research a topic or crawl web pages.
              </p>
            </div>
          )}

          {/* Job list */}
          <div className="space-y-2">
            {jobs.map((job) => {
              const StatusIcon = statusIcons[job.status] ?? ClockIcon;
              const isResearch = job.type === "research";
              const isRunning = job.status === "running";

              return (
                <Card
                  key={job.id}
                  className={`border-border/30 bg-card/40 transition-all duration-200 hover:-translate-y-0.5 hover:border-border/60 hover:shadow-lg ${isResearch ? "cursor-pointer" : ""}`}
                  onClick={() => handleSelectJob(job)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          {job.type === "crawl" ? (
                            <GlobeIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          ) : (
                            <SearchIcon className="h-3.5 w-3.5 shrink-0 text-blue-400" />
                          )}
                          <span className="truncate text-sm font-medium text-foreground">
                            {job.label}
                          </span>
                        </div>
                        <div className="mt-1.5 flex items-center gap-2">
                          <Badge
                            variant="outline"
                            className={`text-[10px] ${statusStyles[job.status] ?? statusStyles.pending}`}
                          >
                            <StatusIcon className={`mr-1 h-2.5 w-2.5 ${isRunning ? "animate-spin" : ""}`} />
                            {job.status}
                          </Badge>
                          {job.resultType && job.resultType !== "general" && (
                            <Badge variant="outline" className="text-[9px] px-1.5 py-0">
                              {job.resultType === "flight" ? "✈ flight" : "📊 stock"}
                            </Badge>
                          )}
                          <span className="text-[10px] text-muted-foreground">{job.progress}</span>
                          <span className="text-[10px] text-muted-foreground/60">{timeAgo(job.startedAt)}</span>
                        </div>
                        {job.error && (
                          <p className="mt-1 text-xs text-red-400">{job.error}</p>
                        )}
                        {job.result && job.status === "done" && (
                          <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{job.result}</p>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </div>

      {/* Detail sidebar for research jobs */}
      {selectedJob && (
        <>
          <div
            className="fixed inset-0 z-30 bg-black/60 md:hidden"
            onClick={() => setSelectedJobId(null)}
          />
          <div className="fixed right-0 top-0 z-40 h-full w-full overflow-y-auto border-l border-border/40 bg-[#0f0f0f] md:static md:w-[480px]">
            <div className="p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-mono text-sm font-semibold text-foreground">Research Report</h2>
                  <p className="mt-1 text-xs text-muted-foreground">{selectedJob.goal}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setSelectedJobId(null)}
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                >
                  <XIcon className="h-4 w-4" />
                </Button>
              </div>

              <Separator className="my-4 opacity-30" />

              {/* Stats */}
              <div className="mb-4 flex gap-4 text-xs text-muted-foreground">
                <span>Searches: {selectedJob.searchesUsed}/{selectedJob.budgetMaxSearches}</span>
                <span>Pages: {selectedJob.pagesLearned}/{selectedJob.budgetMaxPages}</span>
                <span>Status: {selectedJob.status}</span>
              </div>

              {/* Report */}
              {detailLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              ) : selectedJob.report ? (
                <div className="prose prose-sm prose-invert max-w-none text-sm text-foreground/90">
                  <ReactMarkdown>{selectedJob.report}</ReactMarkdown>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No report available yet.</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function JobsSkeleton() {
  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-8 w-8 rounded-lg" />
      </div>
      <Separator className="opacity-30" />
      {[1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-20 w-full rounded-lg" />
      ))}
    </div>
  );
}

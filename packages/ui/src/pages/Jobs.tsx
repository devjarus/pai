import { useState, useEffect, useMemo } from "react";
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
  NetworkIcon,
  XIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  MessageSquareIcon,
  HelpCircleIcon,
  LightbulbIcon,
  FileTextIcon,
} from "lucide-react";
import { toast } from "sonner";
import type { BackgroundJobInfo, BlackboardEntry } from "../api";
import { useJobs, useJobDetail, useJobBlackboard, useClearJobs } from "@/hooks";
import { ResultRenderer } from "@/components/results/ResultRenderer";

const statusStyles: Record<string, string> = {
  running: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  pending: "bg-yellow-500/15 text-yellow-400 border-yellow-500/20",
  planning: "bg-purple-500/15 text-purple-400 border-purple-500/20",
  synthesizing: "bg-indigo-500/15 text-indigo-400 border-indigo-500/20",
  done: "bg-green-500/15 text-green-400 border-green-500/20",
  error: "bg-red-500/15 text-red-400 border-red-500/20",
  failed: "bg-red-500/15 text-red-400 border-red-500/20",
};

const statusIcons: Record<string, typeof LoaderIcon> = {
  running: LoaderIcon,
  pending: ClockIcon,
  planning: LoaderIcon,
  synthesizing: LoaderIcon,
  done: CheckCircle2Icon,
  error: AlertCircleIcon,
  failed: AlertCircleIcon,
};

const resultTypeBadges: Record<string, string> = {
  flight: "\u2708 flight",
  stock: "\ud83d\udcca stock",
  crypto: "\ud83e\ude99 crypto",
  news: "\ud83d\udcf0 news",
  comparison: "\u2696 comparison",
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

/**
 * Extract a json-render spec from markdown text (looks for ```jsonrender fences).
 * Returns the parsed spec object or undefined.
 */
function extractRenderSpec(text: string | null | undefined): unknown | undefined {
  if (!text) return undefined;
  const match = text.match(/```jsonrender\s*([\s\S]*?)```/);
  if (match?.[1]) {
    try {
      return JSON.parse(match[1].trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Strip jsonrender and json code fences from markdown for cleaner fallback display.
 */
function stripCodeFences(text: string | null | undefined): string | undefined {
  if (!text) return undefined;
  return text
    .replace(/```jsonrender\s*[\s\S]*?```/g, "")
    .replace(/```json\s*[\s\S]*?```/g, "")
    .trim() || undefined;
}

const blackboardTypeIcons: Record<string, typeof LightbulbIcon> = {
  finding: LightbulbIcon,
  question: HelpCircleIcon,
  answer: MessageSquareIcon,
  artifact: FileTextIcon,
};

const blackboardTypeStyles: Record<string, string> = {
  finding: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  question: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  answer: "bg-green-500/15 text-green-400 border-green-500/20",
  artifact: "bg-purple-500/15 text-purple-400 border-purple-500/20",
};

export default function Jobs() {
  const { data: jobsData, isLoading, isRefetching, refetch } = useJobs();
  const jobs = jobsData?.jobs ?? [];

  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const { data: jobDetailData, isLoading: detailLoading } = useJobDetail(selectedJobId);
  const selectedJob = jobDetailData?.job ?? null;

  const isSwarm = !!(selectedJob?.plan);
  const { data: blackboardData } = useJobBlackboard(selectedJobId, isSwarm);
  const blackboard = blackboardData?.entries ?? [];

  const [blackboardOpen, setBlackboardOpen] = useState(false);

  const clearJobsMutation = useClearJobs();

  useEffect(() => {
    document.title = "Jobs - pai";
  }, []);

  const handleSelectJob = (job: BackgroundJobInfo) => {
    if (job.type !== "research" && job.type !== "swarm") return;
    setSelectedJobId(job.id);
    setBlackboardOpen(false);
  };

  // Extract renderSpec from the report/synthesis text
  const reportText = selectedJob?.report || selectedJob?.synthesis;
  const renderSpec = useMemo(() => extractRenderSpec(reportText), [reportText]);
  const cleanMarkdown = useMemo(() => renderSpec ? stripCodeFences(reportText) : (reportText ?? undefined), [reportText, renderSpec]);

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
              const isDetailable = job.type === "research" || job.type === "swarm";
              const isRunning = job.status === "running" || job.status === "planning" || job.status === "synthesizing";

              return (
                <Card
                  key={job.id}
                  className={`border-border/30 bg-card/40 transition-all duration-200 hover:-translate-y-0.5 hover:border-border/60 hover:shadow-lg ${isDetailable ? "cursor-pointer" : ""}`}
                  onClick={() => handleSelectJob(job)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          {job.type === "crawl" ? (
                            <GlobeIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          ) : job.type === "swarm" ? (
                            <NetworkIcon className="h-3.5 w-3.5 shrink-0 text-purple-400" />
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
                          {job.resultType && job.resultType !== "general" && resultTypeBadges[job.resultType] && (
                            <Badge variant="outline" className="text-[9px] px-1.5 py-0">
                              {resultTypeBadges[job.resultType]}
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

      {/* Detail sidebar for research/swarm jobs */}
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
                  <h2 className="font-mono text-sm font-semibold text-foreground">
                    {selectedJob.plan ? "Swarm Report" : "Research Report"}
                  </h2>
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
              <div className="mb-4 flex flex-wrap gap-4 text-xs text-muted-foreground">
                {selectedJob.searchesUsed != null && (
                  <span>Searches: {selectedJob.searchesUsed}/{selectedJob.budgetMaxSearches}</span>
                )}
                {selectedJob.pagesLearned != null && (
                  <span>Pages: {selectedJob.pagesLearned}/{selectedJob.budgetMaxPages}</span>
                )}
                {selectedJob.agentCount != null && (
                  <span>Agents: {selectedJob.agentsDone ?? 0}/{selectedJob.agentCount}</span>
                )}
                <span>Status: {selectedJob.status}</span>
              </div>

              {/* Report / Synthesis via ResultRenderer */}
              {detailLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              ) : (reportText) ? (
                <div className="rounded-lg border border-border/20 bg-card/40 p-4">
                  <ResultRenderer
                    spec={renderSpec}
                    markdown={cleanMarkdown}
                    resultType={selectedJob.resultType}
                    debug={false}
                  />
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No report available yet.</p>
              )}

              {/* Blackboard entries for swarm jobs */}
              {isSwarm && blackboard.length > 0 && (
                <div className="mt-6">
                  <button
                    onClick={() => setBlackboardOpen(!blackboardOpen)}
                    className="flex w-full items-center gap-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {blackboardOpen ? (
                      <ChevronDownIcon className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronRightIcon className="h-3.5 w-3.5" />
                    )}
                    Blackboard ({blackboard.length} entries)
                  </button>

                  {blackboardOpen && (
                    <div className="mt-3 space-y-2">
                      {blackboard.map((entry: BlackboardEntry) => {
                        const TypeIcon = blackboardTypeIcons[entry.type] ?? LightbulbIcon;
                        return (
                          <div
                            key={entry.id}
                            className="rounded-lg border border-border/20 bg-card/30 p-3"
                          >
                            <div className="flex items-center gap-2 mb-1.5">
                              <TypeIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
                              <Badge
                                variant="outline"
                                className={`text-[9px] px-1.5 py-0 ${blackboardTypeStyles[entry.type] ?? ""}`}
                              >
                                {entry.type}
                              </Badge>
                              <span className="text-[10px] text-muted-foreground/60 truncate">
                                agent: {entry.agentId.slice(0, 8)}
                              </span>
                              <span className="text-[10px] text-muted-foreground/40 ml-auto shrink-0">
                                {timeAgo(entry.createdAt)}
                              </span>
                            </div>
                            <p className="text-xs text-foreground/80 whitespace-pre-wrap">
                              {entry.content}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
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

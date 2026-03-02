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
  ImageIcon,
  TableIcon,
  BracesIcon,
  FileIcon,
  DownloadIcon,
  UserIcon,
  CodeIcon,
  WrenchIcon,
  BanIcon,
} from "lucide-react";
import { toast } from "sonner";
import type { BackgroundJobInfo, BlackboardEntry } from "../api";
import type { SwarmAgent, ArtifactMeta } from "../types";
import { useJobs, useJobDetail, useJobBlackboard, useJobAgents, useJobArtifacts, useCancelJob, useClearJobs, useConfig } from "@/hooks";
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

const roleStyles: Record<string, string> = {
  researcher: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  flight_researcher: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  stock_researcher: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  crypto_researcher: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  news_researcher: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  coder: "bg-purple-500/15 text-purple-400 border-purple-500/20",
  chart_generator: "bg-purple-500/15 text-purple-400 border-purple-500/20",
  analyst: "bg-green-500/15 text-green-400 border-green-500/20",
  comparator: "bg-green-500/15 text-green-400 border-green-500/20",
  fact_checker: "bg-green-500/15 text-green-400 border-green-500/20",
  market_analyst: "bg-green-500/15 text-green-400 border-green-500/20",
  price_analyst: "bg-green-500/15 text-green-400 border-green-500/20",
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

function formatDuration(start: string, end: string | null): string {
  if (!end) return "running...";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  return `${mins}m ${remainSecs}s`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getArtifactIcon(mimeType: string) {
  if (mimeType.startsWith("image/")) return ImageIcon;
  if (mimeType === "text/csv") return TableIcon;
  if (mimeType === "application/json") return BracesIcon;
  return FileIcon;
}

/**
 * Extract a json-render spec from markdown text (looks for ```jsonrender fences).
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

/** Parse [code_execution] blackboard entries into structured data */
function parseCodeExecution(content: string) {
  const headerMatch = content.match(/\[code_execution\] Language: (\w+) \| Exit: (\d+)/);
  if (!headerMatch) return null;
  const language = headerMatch[1]!;
  const exitCode = parseInt(headerMatch[2]!, 10);
  const codeMatch = content.match(/Code:\n```\w+\n([\s\S]*?)```/);
  const code = codeMatch?.[1]?.trim() ?? "";
  const stdoutMatch = content.match(/Stdout: ([\s\S]*?)(?=\nStderr:|$)/);
  const stdout = stdoutMatch?.[1]?.trim() ?? "";
  const stderrMatch = content.match(/Stderr: ([\s\S]*?)(?=\nFiles:|$)/);
  const stderr = stderrMatch?.[1]?.trim() ?? "";
  const filesMatch = content.match(/Files: (.+)$/m);
  const artifacts: Array<{ name: string; id: string }> = [];
  if (filesMatch?.[1]) {
    const fileRe = /(\S+?) \(artifact:(\S+?)\)/g;
    let m;
    while ((m = fileRe.exec(filesMatch[1])) !== null) {
      artifacts.push({ name: m[1]!, id: m[2]! });
    }
  }
  return { language, exitCode, code, stdout, stderr, artifacts };
}

/** Sort agents: running first, then done, then failed, then pending */
function sortAgents(agents: SwarmAgent[]): SwarmAgent[] {
  const order: Record<string, number> = { running: 0, done: 1, failed: 2, pending: 3 };
  return [...agents].sort((a, b) => (order[a.status] ?? 4) - (order[b.status] ?? 4));
}

export default function Jobs() {
  const { data: configData } = useConfig();
  const { data: jobsData, isLoading, isRefetching, refetch } = useJobs();
  const jobs = jobsData?.jobs ?? [];

  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const { data: jobDetailData, isLoading: detailLoading } = useJobDetail(selectedJobId);
  const selectedJob = jobDetailData?.job ?? null;

  const isSwarm = !!(selectedJob?.plan);
  const { data: blackboardData } = useJobBlackboard(selectedJobId, isSwarm);
  const blackboard = blackboardData?.entries ?? [];

  const { data: agentsData } = useJobAgents(selectedJobId, isSwarm);
  const agents = useMemo(() => sortAgents(agentsData?.agents ?? []), [agentsData]);

  const { data: artifactsData } = useJobArtifacts(selectedJobId, isSwarm);
  const artifacts: ArtifactMeta[] = artifactsData ?? [];

  const [blackboardOpen, setBlackboardOpen] = useState(false);
  const [agentsOpen, setAgentsOpen] = useState(true);
  const [artifactsOpen, setArtifactsOpen] = useState(true);
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
  const [expandedBlackboard, setExpandedBlackboard] = useState<Set<string>>(new Set());

  const cancelJobMutation = useCancelJob();
  const clearJobsMutation = useClearJobs();

  useEffect(() => {
    document.title = "Jobs - pai";
  }, []);

  const handleSelectJob = (job: BackgroundJobInfo) => {
    if (job.type !== "research" && job.type !== "swarm") return;
    setSelectedJobId(job.id);
    setBlackboardOpen(false);
    setAgentsOpen(true);
    setArtifactsOpen(true);
    setExpandedAgents(new Set());
    setExpandedBlackboard(new Set());
  };

  const toggleExpandedAgent = (id: string) => {
    setExpandedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleExpandedBlackboard = (id: string) => {
    setExpandedBlackboard((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
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
                <div className="flex items-center gap-1 shrink-0">
                  {(selectedJob.status === "running" || selectedJob.status === "pending" || selectedJob.status === "planning" || selectedJob.status === "synthesizing") && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        cancelJobMutation.mutate(selectedJobId!, {
                          onSuccess: () => {
                            toast.success("Job cancelled");
                          },
                          onError: () => {
                            toast.error("Failed to cancel job");
                          },
                        });
                      }}
                      disabled={cancelJobMutation.isPending}
                      className="text-xs text-muted-foreground hover:text-destructive"
                    >
                      <BanIcon className="mr-1 h-3 w-3" />
                      Cancel
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setSelectedJobId(null)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <XIcon className="h-4 w-4" />
                  </Button>
                </div>
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

              {/* Agents section for swarm jobs */}
              {isSwarm && agents.length > 0 && (
                <div className="mb-4">
                  <button
                    onClick={() => setAgentsOpen(!agentsOpen)}
                    className="flex w-full items-center gap-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {agentsOpen ? (
                      <ChevronDownIcon className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronRightIcon className="h-3.5 w-3.5" />
                    )}
                    <UserIcon className="h-3.5 w-3.5" />
                    Agents ({agents.length})
                  </button>

                  {agentsOpen && (
                    <div className="mt-3 space-y-2">
                      {agents.map((agent: SwarmAgent) => {
                        const AgentStatusIcon = statusIcons[agent.status] ?? ClockIcon;
                        const isAgentRunning = agent.status === "running";
                        const isExpanded = expandedAgents.has(agent.id);
                        const taskPreview = agent.task.length > 200 ? agent.task.slice(0, 200) + "..." : agent.task;
                        const resultPreview = agent.result && agent.result.length > 300 ? agent.result.slice(0, 300) + "..." : agent.result;

                        return (
                          <div
                            key={agent.id}
                            className="rounded-lg border border-border/20 bg-card/30 p-3"
                          >
                            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                              <Badge
                                variant="outline"
                                className={`text-[9px] px-1.5 py-0 ${roleStyles[agent.role] ?? "bg-gray-500/15 text-gray-400 border-gray-500/20"}`}
                              >
                                {agent.role}
                              </Badge>
                              <Badge
                                variant="outline"
                                className={`text-[9px] px-1.5 py-0 ${statusStyles[agent.status] ?? statusStyles.pending}`}
                              >
                                <AgentStatusIcon className={`mr-0.5 h-2 w-2 ${isAgentRunning ? "animate-spin" : ""}`} />
                                {agent.status}
                              </Badge>
                              <span className="text-[10px] text-muted-foreground/60">
                                {agent.stepsUsed} steps
                              </span>
                              <span className="text-[10px] text-muted-foreground/40 ml-auto">
                                {formatDuration(agent.createdAt, agent.completedAt)}
                              </span>
                            </div>

                            {/* Task */}
                            <p
                              className="text-xs text-foreground/70 mb-1.5 cursor-pointer"
                              onClick={() => toggleExpandedAgent(agent.id)}
                            >
                              {isExpanded ? agent.task : taskPreview}
                            </p>

                            {/* Tools */}
                            {agent.tools.length > 0 && (
                              <div className="flex flex-wrap gap-1 mb-1.5">
                                {agent.tools.map((t) => (
                                  <span key={t} className="inline-flex items-center gap-0.5 rounded bg-muted/30 px-1 py-0.5 text-[9px] text-muted-foreground">
                                    <WrenchIcon className="h-2 w-2" />
                                    {t}
                                  </span>
                                ))}
                              </div>
                            )}

                            {/* Result (collapsible) */}
                            {agent.result && (
                              <div className="mt-1.5">
                                <button
                                  onClick={() => toggleExpandedAgent(agent.id)}
                                  className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                                >
                                  {isExpanded ? "Show less" : "Show result"}
                                </button>
                                {isExpanded && (
                                  <p className="mt-1 text-xs text-foreground/60 whitespace-pre-wrap break-words">
                                    {agent.result}
                                  </p>
                                )}
                                {!isExpanded && resultPreview && (
                                  <p className="mt-1 text-xs text-foreground/60 line-clamp-2">
                                    {resultPreview}
                                  </p>
                                )}
                              </div>
                            )}

                            {/* Error */}
                            {agent.error && (
                              <p className="mt-1.5 text-xs text-red-400 bg-red-500/10 rounded p-2">
                                {agent.error}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

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
                    debug={configData?.debugResearch ?? false}
                  />
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No report available yet.</p>
              )}

              {/* Artifacts section */}
              {artifacts.length > 0 && (
                <div className="mt-6">
                  <button
                    onClick={() => setArtifactsOpen(!artifactsOpen)}
                    className="flex w-full items-center gap-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {artifactsOpen ? (
                      <ChevronDownIcon className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronRightIcon className="h-3.5 w-3.5" />
                    )}
                    <FileIcon className="h-3.5 w-3.5" />
                    Artifacts ({artifacts.length})
                  </button>

                  {artifactsOpen && (
                    <div className="mt-3 space-y-2">
                      {artifacts.map((artifact: ArtifactMeta) => {
                        const ArtIcon = getArtifactIcon(artifact.mimeType);
                        const isImage = artifact.mimeType.startsWith("image/");
                        return (
                          <div
                            key={artifact.id}
                            className="rounded-lg border border-border/20 bg-card/30 p-3"
                          >
                            <div className="flex items-center gap-2">
                              <ArtIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              <span className="text-xs text-foreground/80 truncate flex-1">{artifact.name}</span>
                              <span className="text-[10px] text-muted-foreground/60">{formatSize(artifact.size)}</span>
                              <a
                                href={`/api/artifacts/${artifact.id}`}
                                download={artifact.name}
                                className="text-muted-foreground hover:text-foreground transition-colors"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <DownloadIcon className="h-3 w-3" />
                              </a>
                            </div>
                            {isImage && (
                              <img
                                src={`/api/artifacts/${artifact.id}`}
                                alt={artifact.name}
                                className="mt-2 max-h-48 rounded border border-border/20 object-contain"
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
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
                        const codeExec = parseCodeExecution(entry.content);
                        const TypeIcon = blackboardTypeIcons[entry.type] ?? LightbulbIcon;
                        const isExpanded = expandedBlackboard.has(entry.id);

                        if (codeExec) {
                          return (
                            <div
                              key={entry.id}
                              className="rounded-lg border border-border/20 bg-card/30 p-3"
                            >
                              <div className="flex items-center gap-2 mb-1.5">
                                <CodeIcon className="h-3 w-3 shrink-0 text-purple-400" />
                                <Badge variant="outline" className="text-[9px] px-1.5 py-0 bg-purple-500/15 text-purple-400 border-purple-500/20">
                                  {codeExec.language}
                                </Badge>
                                <Badge
                                  variant="outline"
                                  className={`text-[9px] px-1.5 py-0 ${codeExec.exitCode === 0 ? "bg-green-500/15 text-green-400 border-green-500/20" : "bg-red-500/15 text-red-400 border-red-500/20"}`}
                                >
                                  exit: {codeExec.exitCode}
                                </Badge>
                                <span className="text-[10px] text-muted-foreground/60 truncate">
                                  agent: {entry.agentId.slice(0, 8)}
                                </span>
                                <span className="text-[10px] text-muted-foreground/40 ml-auto shrink-0">
                                  {timeAgo(entry.createdAt)}
                                </span>
                              </div>

                              {/* Code block */}
                              {codeExec.code && (
                                <pre className="mt-1.5 text-[11px] text-foreground/70 bg-black/30 rounded p-2 overflow-x-auto max-h-32">
                                  <code>{codeExec.code}</code>
                                </pre>
                              )}

                              {/* stdout/stderr collapsible */}
                              {(codeExec.stdout !== "(none)" || codeExec.stderr !== "(none)") && (
                                <button
                                  onClick={() => toggleExpandedBlackboard(entry.id)}
                                  className="mt-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                                >
                                  {isExpanded ? "Hide output" : "Show output"}
                                </button>
                              )}
                              {isExpanded && (
                                <div className="mt-1.5 space-y-1">
                                  {codeExec.stdout !== "(none)" && (
                                    <div>
                                      <span className="text-[10px] text-muted-foreground">stdout:</span>
                                      <pre className="text-[11px] text-foreground/60 bg-black/20 rounded p-1.5 overflow-x-auto max-h-24">{codeExec.stdout}</pre>
                                    </div>
                                  )}
                                  {codeExec.stderr !== "(none)" && (
                                    <div>
                                      <span className="text-[10px] text-red-400">stderr:</span>
                                      <pre className="text-[11px] text-red-400/70 bg-red-500/5 rounded p-1.5 overflow-x-auto max-h-24">{codeExec.stderr}</pre>
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Artifact links */}
                              {codeExec.artifacts.length > 0 && (
                                <div className="mt-1.5 flex flex-wrap gap-1.5">
                                  {codeExec.artifacts.map((a) => {
                                    const isImg = /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(a.name);
                                    return (
                                      <a
                                        key={a.id}
                                        href={`/api/artifacts/${a.id}`}
                                        download={a.name}
                                        className="inline-flex items-center gap-1 rounded bg-muted/30 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                                      >
                                        {isImg ? <ImageIcon className="h-2.5 w-2.5" /> : <FileIcon className="h-2.5 w-2.5" />}
                                        {a.name}
                                      </a>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        }

                        // Default blackboard entry rendering
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

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  useJobs,
  useObservabilityJob,
  useObservabilityOverview,
  useObservabilityProcesses,
  useObservabilityRecentErrors,
  useObservabilityThread,
  useObservabilityTrace,
  useThreads,
} from "@/hooks";
import type { JobDiagnostics, ObservabilityRange, TelemetrySpan, ThreadMessageUsage } from "@/types";
import { formatWithTimezone, parseApiDate } from "@/lib/datetime";
import { ActivityIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react";

function formatNumber(value: number | null | undefined): string {
  if (value == null) return "-";
  return Intl.NumberFormat().format(value);
}

function formatDuration(value: number | null | undefined): string {
  if (value == null) return "-";
  if (value >= 1000) return `${(value / 1000).toFixed(1)}s`;
  return `${Math.round(value)}ms`;
}

function formatDate(value: string, timezone?: string): string {
  return formatWithTimezone(parseApiDate(value), {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }, timezone);
}

function getQueueWait(span: TelemetrySpan): number | null {
  const value = span.metadata?.queueWaitMs;
  return typeof value === "number" ? value : null;
}

function getTraceDepth(spans: TelemetrySpan[], span: TelemetrySpan): number {
  let depth = 0;
  let current = span;
  while (current.parentSpanId) {
    const parent = spans.find((candidate) => candidate.id === current.parentSpanId);
    if (!parent) break;
    current = parent;
    depth += 1;
  }
  return depth;
}

function UsageBadge({ usage }: { usage: ThreadMessageUsage | null }) {
  if (!usage) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
      <Badge variant="secondary" className="text-[10px]">tokens {formatNumber(usage.totalTokens ?? null)}</Badge>
      <Badge variant="secondary" className="text-[10px]">time {formatDuration(usage.durationMs ?? null)}</Badge>
      <Badge variant="secondary" className="text-[10px]">steps {formatNumber(usage.stepCount ?? null)}</Badge>
      <Badge variant="secondary" className="text-[10px]">tools {formatNumber(usage.toolCallCount ?? null)}</Badge>
    </div>
  );
}

function TraceViewer({ traceId, timezone }: { traceId: string | null; timezone?: string }) {
  const { data, isLoading } = useObservabilityTrace(traceId, !!traceId);

  if (!traceId) {
    return <div className="rounded-lg border border-dashed border-border/50 px-4 py-3 text-xs text-muted-foreground">Select a trace to inspect span details.</div>;
  }

  if (isLoading) {
    return <Skeleton className="h-32 w-full" />;
  }

  const spans = data?.spans ?? [];
  if (spans.length === 0) {
    return <div className="rounded-lg border border-dashed border-border/50 px-4 py-3 text-xs text-muted-foreground">No spans recorded for this trace.</div>;
  }

  return (
    <div className="rounded-lg border border-border/40">
      {spans.map((span) => {
        const depth = getTraceDepth(spans, span);
        return (
          <div
            key={span.id}
            className="border-t border-border/30 px-4 py-3 first:border-t-0"
            style={{ paddingLeft: `${16 + depth * 18}px` }}
          >
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant={span.status === "error" ? "destructive" : "secondary"} className="text-[10px]">
                {span.status}
              </Badge>
              <span className="font-medium text-foreground">{span.process}</span>
              <span className="text-muted-foreground">{span.spanType}</span>
              {span.toolName ? <span className="text-muted-foreground">tool {span.toolName}</span> : null}
              <span className="text-muted-foreground">{formatDuration(span.durationMs)}</span>
              <span className="text-muted-foreground">{formatNumber(span.totalTokens)} tokens</span>
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              {formatDate(span.startedAt, timezone)}
              {getQueueWait(span) != null ? ` • queue ${formatDuration(getQueueWait(span))}` : ""}
              {span.errorMessage ? ` • ${span.errorMessage}` : ""}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function JobBreakdown({ diagnostics }: { diagnostics: JobDiagnostics }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label="Calls" value={formatNumber(diagnostics.totals.calls)} />
        <StatCard label="Tokens" value={formatNumber(diagnostics.totals.totalTokens)} />
        <StatCard label="Avg Time" value={formatDuration(diagnostics.totals.avgDurationMs)} />
        <StatCard label="Errors" value={formatNumber(diagnostics.totals.errors)} />
      </div>
      <div className="rounded-lg border border-border/40">
        {diagnostics.processBreakdown.map((process) => (
          <div key={process.process} className="flex items-center justify-between border-t border-border/30 px-4 py-3 text-xs first:border-t-0">
            <span className="font-medium text-foreground">{process.process}</span>
            <div className="flex gap-4 text-muted-foreground">
              <span>{formatNumber(process.totalTokens)} tokens</span>
              <span>{formatDuration(process.avgDurationMs)}</span>
              <span>{formatNumber(process.calls)} calls</span>
            </div>
          </div>
        ))}
      </div>
      {diagnostics.agentBreakdown.length > 0 ? (
        <div className="rounded-lg border border-border/40">
          {diagnostics.agentBreakdown.map((agent) => (
            <div key={agent.agentName} className="flex items-center justify-between border-t border-border/30 px-4 py-3 text-xs first:border-t-0">
              <span className="font-medium text-foreground">{agent.agentName}</span>
              <div className="flex gap-4 text-muted-foreground">
                <span>{formatNumber(agent.totalTokens)} tokens</span>
                <span>{formatDuration(agent.avgDurationMs)}</span>
                <span>{formatNumber(agent.calls)} calls</span>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/40 bg-background/50 px-4 py-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-semibold text-foreground">{value}</div>
    </div>
  );
}

export function DiagnosticsPanel({ timezone }: { timezone?: string }) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  const [range, setRange] = useState<ObservabilityRange>("24h");
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [threadQuery, setThreadQuery] = useState("");
  const [jobQuery, setJobQuery] = useState("");

  const { data: overview, isLoading: overviewLoading } = useObservabilityOverview(range, open);
  const { data: processes } = useObservabilityProcesses(range, open);
  const { data: errors } = useObservabilityRecentErrors(range, open);
  const threadTabActive = open && activeTab === "threads";
  const jobTabActive = open && activeTab === "jobs";
  const { data: threads } = useThreads(threadTabActive);
  const { data: jobsData } = useJobs(jobTabActive);

  const filteredThreads = (threads ?? []).filter((thread) =>
    thread.title.toLowerCase().includes(threadQuery.toLowerCase()),
  );
  const filteredJobs = (jobsData?.jobs ?? []).filter((job) =>
    `${job.label} ${job.type}`.toLowerCase().includes(jobQuery.toLowerCase()),
  );

  useEffect(() => {
    if (!threadTabActive) return;
    if (filteredThreads.length === 0) {
      setSelectedThreadId(null);
      return;
    }
    if (!selectedThreadId || !filteredThreads.some((thread) => thread.id === selectedThreadId)) {
      setSelectedThreadId(filteredThreads[0]!.id);
    }
  }, [filteredThreads, selectedThreadId, threadTabActive]);

  useEffect(() => {
    if (!jobTabActive) return;
    if (filteredJobs.length === 0) {
      setSelectedJobId(null);
      return;
    }
    if (!selectedJobId || !filteredJobs.some((job) => job.id === selectedJobId)) {
      setSelectedJobId(filteredJobs[0]!.id);
    }
  }, [filteredJobs, selectedJobId, jobTabActive]);

  const { data: threadDiagnostics, isLoading: threadLoading } = useObservabilityThread(selectedThreadId, threadTabActive);
  const { data: jobDiagnostics, isLoading: jobLoading } = useObservabilityJob(selectedJobId, jobTabActive);

  return (
    <Card className="gap-0 overflow-hidden border-border/50 bg-card/50 py-0">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CardHeader className="px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <ActivityIcon className="size-3.5" />
              Diagnostics
            </CardTitle>
            <div className="flex items-center gap-2">
              <select
                value={range}
                onChange={(event) => setRange(event.target.value as ObservabilityRange)}
                className="rounded-md border border-border/50 bg-background px-2 py-1 text-xs text-foreground outline-none"
              >
                <option value="24h">Last 24h</option>
                <option value="7d">Last 7d</option>
                <option value="30d">Last 30d</option>
              </select>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
                  {open ? <ChevronUpIcon className="size-3.5" /> : <ChevronDownIcon className="size-3.5" />}
                  {open ? "Hide" : "Show"}
                </Button>
              </CollapsibleTrigger>
            </div>
          </div>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="border-t border-border/30 px-5 py-5">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="gap-4">
              <TabsList variant="line" className="w-full justify-start">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="processes">Processes</TabsTrigger>
                <TabsTrigger value="threads">Threads</TabsTrigger>
                <TabsTrigger value="jobs">Jobs</TabsTrigger>
                <TabsTrigger value="errors">Errors</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-4">
                {overviewLoading || !overview ? (
                  <Skeleton className="h-40 w-full" />
                ) : (
                  <>
                    <div className="grid gap-3 sm:grid-cols-4">
                      <StatCard label="Calls" value={formatNumber(overview.totals.calls)} />
                      <StatCard label="Tokens" value={formatNumber(overview.totals.totalTokens)} />
                      <StatCard label="Avg Time" value={formatDuration(overview.totals.avgDurationMs)} />
                      <StatCard label="P95 Time" value={formatDuration(overview.totals.p95DurationMs)} />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-4">
                      <StatCard label="Active LLM" value={formatNumber(overview.live?.activeRequests ?? 0)} />
                      <StatCard label="Queued LLM" value={formatNumber(overview.live?.queuedRequests ?? 0)} />
                      <StatCard label="Avg Queue" value={formatDuration(overview.queue.avgWaitMs)} />
                      <StatCard label="P95 Queue" value={formatDuration(overview.queue.p95WaitMs)} />
                    </div>
                    <div className="grid gap-3 lg:grid-cols-3">
                      {(["interactive", "deferred", "background"] as const).map((lane) => (
                        <div key={lane} className="rounded-lg border border-border/40 bg-background/40 px-4 py-3">
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{lane}</div>
                          <div className="mt-2 flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">active</span>
                            <span className="font-medium text-foreground">{formatNumber(overview.live?.lanes[lane].active ?? 0)}</span>
                          </div>
                          <div className="mt-1 flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">queued</span>
                            <span className="font-medium text-foreground">{formatNumber(overview.live?.lanes[lane].queued ?? 0)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                      <span>pending background jobs {formatNumber(overview.live?.pendingBackgroundJobs ?? 0)}</span>
                      {overview.live?.backgroundActiveKind ? <span>active background {overview.live.backgroundActiveKind}</span> : null}
                      {overview.live?.startupDelayUntil ? <span>startup delay until {formatDate(overview.live.startupDelayUntil, timezone)}</span> : null}
                    </div>
                    <div className="rounded-lg border border-border/40">
                      <div className="border-b border-border/30 px-4 py-3 text-xs font-medium text-foreground">Queue Wait By Process</div>
                      {overview.queue.byProcess.length > 0 ? overview.queue.byProcess.map((process) => (
                        <div key={process.process} className="grid grid-cols-[minmax(0,1.8fr)_repeat(3,minmax(0,1fr))] items-center gap-3 border-t border-border/30 px-4 py-3 text-xs first:border-t-0">
                          <span className="truncate font-medium text-foreground">{process.process}</span>
                          <span className="text-muted-foreground">{formatDuration(process.avgQueueWaitMs)}</span>
                          <span className="text-muted-foreground">{formatDuration(process.p95QueueWaitMs)}</span>
                          <span className="text-muted-foreground">{formatNumber(process.calls)}</span>
                        </div>
                      )) : (
                        <div className="px-4 py-3 text-xs text-muted-foreground">No queue waits recorded in this range.</div>
                      )}
                    </div>
                    <div className="grid gap-4 lg:grid-cols-2">
                      <div className="rounded-lg border border-border/40">
                        <div className="border-b border-border/30 px-4 py-3 text-xs font-medium text-foreground">Top Processes</div>
                        {overview.topProcesses.map((process) => (
                          <div key={process.process} className="flex items-center justify-between border-t border-border/30 px-4 py-3 text-xs first:border-t-0">
                            <span className="font-medium text-foreground">{process.process}</span>
                            <div className="flex gap-4 text-muted-foreground">
                              <span>{formatNumber(process.totalTokens)} tokens</span>
                              <span>{formatDuration(process.avgDurationMs)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="rounded-lg border border-border/40">
                        <div className="border-b border-border/30 px-4 py-3 text-xs font-medium text-foreground">Top Models</div>
                        {overview.topModels.map((model) => (
                          <div key={`${model.provider ?? "unknown"}-${model.model ?? "unknown"}`} className="flex items-center justify-between border-t border-border/30 px-4 py-3 text-xs first:border-t-0">
                            <span className="font-medium text-foreground">{model.provider ?? "unknown"} / {model.model ?? "unknown"}</span>
                            <div className="flex gap-4 text-muted-foreground">
                              <span>{formatNumber(model.totalTokens)} tokens</span>
                              <span>{formatDuration(model.avgDurationMs)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </TabsContent>

              <TabsContent value="processes" className="space-y-3">
                <div className="rounded-lg border border-border/40">
                  {(processes?.processes ?? []).map((process) => (
                    <div key={process.process} className="grid grid-cols-[minmax(0,1.8fr)_repeat(7,minmax(0,1fr))] items-center gap-3 border-t border-border/30 px-4 py-3 text-xs first:border-t-0">
                      <span className="truncate font-medium text-foreground">{process.process}</span>
                      <span className="text-muted-foreground">{formatNumber(process.totalTokens)}</span>
                      <span className="text-muted-foreground">{formatDuration(process.avgDurationMs)}</span>
                      <span className="text-muted-foreground">{formatDuration(process.p95DurationMs)}</span>
                      <span className="text-muted-foreground">{formatDuration(process.avgQueueWaitMs)}</span>
                      <span className="text-muted-foreground">{formatDuration(process.p95QueueWaitMs)}</span>
                      <span className="text-muted-foreground">{formatNumber(process.calls)}</span>
                      <span className="text-muted-foreground">{formatNumber(process.errors)}</span>
                    </div>
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="threads" className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
                <div className="space-y-3">
                  <input
                    value={threadQuery}
                    onChange={(event) => setThreadQuery(event.target.value)}
                    placeholder="Filter threads"
                    className="w-full rounded-md border border-border/50 bg-background px-3 py-2 text-sm outline-none"
                  />
                  <div className="rounded-lg border border-border/40">
                    {filteredThreads.map((thread) => (
                      <button
                        key={thread.id}
                        type="button"
                        onClick={() => setSelectedThreadId(thread.id)}
                        className={`flex w-full items-center justify-between border-t border-border/30 px-4 py-3 text-left first:border-t-0 ${selectedThreadId === thread.id ? "bg-muted/40" : ""}`}
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-foreground">{thread.title}</div>
                          <div className="text-[11px] text-muted-foreground">{thread.messageCount} messages</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-4">
                  {threadLoading || !threadDiagnostics ? (
                    <Skeleton className="h-56 w-full" />
                  ) : (
                    <>
                      <div className="grid gap-3 sm:grid-cols-4">
                        <StatCard label="Calls" value={formatNumber(threadDiagnostics.totals.calls)} />
                        <StatCard label="Tokens" value={formatNumber(threadDiagnostics.totals.totalTokens)} />
                        <StatCard label="Avg Time" value={formatDuration(threadDiagnostics.totals.avgDurationMs)} />
                        <StatCard label="Errors" value={formatNumber(threadDiagnostics.totals.errors)} />
                      </div>
                      <div className="rounded-lg border border-border/40">
                        {threadDiagnostics.messages.map((message) => (
                          <div key={message.id} className="border-t border-border/30 px-4 py-3 first:border-t-0">
                            <div className="flex items-center justify-between gap-3 text-xs">
                              <span className="font-medium text-foreground">{message.role}</span>
                              <div className="flex items-center gap-2">
                                <span className="text-muted-foreground">{formatDate(message.createdAt, timezone)}</span>
                                {message.usage?.traceId ? (
                                  <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => setSelectedTraceId(message.usage?.traceId ?? null)}>
                                    Trace
                                  </Button>
                                ) : null}
                              </div>
                            </div>
                            <div className="mt-2 whitespace-pre-wrap text-sm text-foreground">{message.content}</div>
                            <UsageBadge usage={message.usage} />
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                  <TraceViewer traceId={selectedTraceId} timezone={timezone} />
                </div>
              </TabsContent>

              <TabsContent value="jobs" className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
                <div className="space-y-3">
                  <input
                    value={jobQuery}
                    onChange={(event) => setJobQuery(event.target.value)}
                    placeholder="Filter jobs"
                    className="w-full rounded-md border border-border/50 bg-background px-3 py-2 text-sm outline-none"
                  />
                  <div className="rounded-lg border border-border/40">
                    {filteredJobs.map((job) => (
                      <button
                        key={job.id}
                        type="button"
                        onClick={() => setSelectedJobId(job.id)}
                        className={`flex w-full items-center justify-between border-t border-border/30 px-4 py-3 text-left first:border-t-0 ${selectedJobId === job.id ? "bg-muted/40" : ""}`}
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-foreground">{job.label}</div>
                          <div className="text-[11px] text-muted-foreground">{job.type} • {job.status}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-4">
                  {jobLoading || !jobDiagnostics ? <Skeleton className="h-56 w-full" /> : <JobBreakdown diagnostics={jobDiagnostics} />}
                  <div className="rounded-lg border border-border/40">
                    {(jobDiagnostics?.recentSpans ?? []).map((span) => (
                      <div key={span.id} className="flex items-center justify-between gap-3 border-t border-border/30 px-4 py-3 text-xs first:border-t-0">
                        <div className="min-w-0">
                          <div className="truncate font-medium text-foreground">{span.process}</div>
                          <div className="truncate text-muted-foreground">{span.agentName ?? span.toolName ?? span.model ?? "span"}</div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-muted-foreground">{formatNumber(span.totalTokens)} tokens</span>
                          <span className="text-muted-foreground">{formatDuration(span.durationMs)}</span>
                          <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => setSelectedTraceId(span.traceId)}>
                            Trace
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <TraceViewer traceId={selectedTraceId} timezone={timezone} />
                </div>
              </TabsContent>

              <TabsContent value="errors" className="space-y-4">
                <div className="rounded-lg border border-border/40">
                  {(errors?.errors ?? []).map((error) => (
                    <div key={error.id} className="border-t border-border/30 px-4 py-3 first:border-t-0">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium text-foreground">{error.process}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {formatDate(error.startedAt, timezone)}
                            {error.route ? ` • ${error.route}` : ""}
                            {error.jobId ? ` • job ${error.jobId}` : ""}
                            {error.threadId ? ` • thread ${error.threadId}` : ""}
                          </div>
                        </div>
                        <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => setSelectedTraceId(error.traceId)}>
                          Trace
                        </Button>
                      </div>
                      <div className="mt-2 text-xs text-red-400">{error.errorMessage ?? "Unknown error"}</div>
                    </div>
                  ))}
                </div>
                <TraceViewer traceId={selectedTraceId} timezone={timezone} />
              </TabsContent>
            </Tabs>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

import { useQuery } from "@tanstack/react-query";
import {
  getObservabilityOverview,
  getObservabilityProcesses,
  getObservabilityRecentErrors,
  getObservabilityThread,
  getObservabilityJob,
  getObservabilityTrace,
} from "../api";
import type { ObservabilityRange } from "../types";

export const observabilityKeys = {
  all: ["observability"] as const,
  overview: (range: ObservabilityRange) => ["observability", "overview", range] as const,
  processes: (range: ObservabilityRange) => ["observability", "processes", range] as const,
  errors: (range: ObservabilityRange) => ["observability", "errors", range] as const,
  thread: (threadId: string) => ["observability", "thread", threadId] as const,
  job: (jobId: string) => ["observability", "job", jobId] as const,
  trace: (traceId: string) => ["observability", "trace", traceId] as const,
};

export function useObservabilityOverview(range: ObservabilityRange, enabled = true) {
  return useQuery({
    queryKey: observabilityKeys.overview(range),
    queryFn: () => getObservabilityOverview(range),
    enabled,
    refetchInterval: 30_000,
  });
}

export function useObservabilityProcesses(range: ObservabilityRange, enabled = true) {
  return useQuery({
    queryKey: observabilityKeys.processes(range),
    queryFn: () => getObservabilityProcesses(range),
    enabled,
    refetchInterval: 30_000,
  });
}

export function useObservabilityRecentErrors(range: ObservabilityRange, enabled = true) {
  return useQuery({
    queryKey: observabilityKeys.errors(range),
    queryFn: () => getObservabilityRecentErrors(range),
    enabled,
    refetchInterval: 30_000,
  });
}

export function useObservabilityThread(threadId: string | null, enabled = true) {
  return useQuery({
    queryKey: observabilityKeys.thread(threadId!),
    queryFn: () => getObservabilityThread(threadId!),
    enabled: enabled && !!threadId,
  });
}

export function useObservabilityJob(jobId: string | null, enabled = true) {
  return useQuery({
    queryKey: observabilityKeys.job(jobId!),
    queryFn: () => getObservabilityJob(jobId!),
    enabled: enabled && !!jobId,
    refetchInterval: 10_000,
  });
}

export function useObservabilityTrace(traceId: string | null, enabled = true) {
  return useQuery({
    queryKey: observabilityKeys.trace(traceId!),
    queryFn: () => getObservabilityTrace(traceId!),
    enabled: enabled && !!traceId,
  });
}

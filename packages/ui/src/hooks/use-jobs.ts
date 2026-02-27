import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getJobs, getJobDetail, clearJobs } from "../api";

export const jobKeys = {
  all: ["jobs"] as const,
  list: () => ["jobs", "list"] as const,
  detail: (id: string) => ["jobs", "detail", id] as const,
};

export function useJobs() {
  return useQuery({
    queryKey: jobKeys.list(),
    queryFn: () => getJobs(),
    refetchInterval: 10_000,
  });
}

export function useJobDetail(id: string | null) {
  return useQuery({
    queryKey: jobKeys.detail(id!),
    queryFn: () => getJobDetail(id!),
    enabled: !!id,
  });
}

export function useClearJobs() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => clearJobs(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: jobKeys.all });
    },
  });
}

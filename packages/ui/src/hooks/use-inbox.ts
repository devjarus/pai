import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getInboxAll,
  getInboxBriefing,
  refreshInbox,
  clearInbox,
  getResearchBriefings,
} from "../api";

export const inboxKeys = {
  all: ["inbox"] as const,
  list: () => ["inbox", "list"] as const,
  detail: (id: string) => ["inbox", "detail", id] as const,
  research: () => ["inbox", "research"] as const,
};

export function useInboxAll(options?: { refetchInterval?: number | false }) {
  return useQuery({
    queryKey: inboxKeys.list(),
    queryFn: () => getInboxAll(),
    refetchInterval: options?.refetchInterval,
  });
}

export function useInboxBriefing(id: string | null) {
  return useQuery({
    queryKey: inboxKeys.detail(id!),
    queryFn: () => getInboxBriefing(id!),
    enabled: !!id,
  });
}

export function useResearchBriefings() {
  return useQuery({
    queryKey: inboxKeys.research(),
    queryFn: () => getResearchBriefings(),
  });
}

export function useRefreshInbox() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => refreshInbox(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inboxKeys.all });
    },
  });
}

export function useClearInbox() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => clearInbox(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inboxKeys.all });
    },
  });
}
